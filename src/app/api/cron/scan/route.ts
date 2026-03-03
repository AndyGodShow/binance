import { NextResponse } from 'next/server';
import { strategyRegistry } from '@/strategies/registry';
import { sendTelegramMessage } from '@/lib/services/telegram';

// Vercel Cron will send a GET request
export async function GET(request: Request) {
    // 1. Authenticate the cron request (Vercel uses a special auth header)
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        // Only enforce in production when CRON_SECRET is set
        if (process.env.NODE_ENV === 'production') {
            return new Response('Unauthorized', { status: 401 });
        }
    }

    try {
        console.log('[Cron] Starting strategy scan...');
        const startTime = Date.now();

        // 2. Fetch all required data concurrently
        const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';

        const [marketRes, frameRes, oiRes, rsrsRes] = await Promise.all([
            fetch(`${baseUrl}/api/market`),
            fetch(`${baseUrl}/api/market/multiframe`),
            fetch(`${baseUrl}/api/oi/all`),
            fetch(`${baseUrl}/api/rsrs`)
        ]);

        const rawData = await marketRes.json();
        const frameData = await frameRes.json();
        const oiData = await oiRes.json();
        const rsrsData = await rsrsRes.json();

        if (!rawData || !Array.isArray(rawData)) {
            throw new Error('Failed to fetch market data');
        }

        // Filter and process data
        const processedData = rawData
            .filter(t => t.symbol.endsWith('USDT'))
            .filter(t => (Date.now() - t.closeTime) < 24 * 60 * 60 * 1000)
            .filter(t => parseFloat(t.quoteVolume) > 100000)
            .map(t => {
                const newData = { ...t };
                const price = parseFloat(t.lastPrice);

                // Add MultiFrame
                if (frameData && frameData[t.symbol]) {
                    const f = frameData[t.symbol];
                    newData.change15m = f.o15m ? ((price - f.o15m) / f.o15m) * 100 : 0;
                    newData.change1h = f.o1h ? ((price - f.o1h) / f.o1h) * 100 : 0;
                    newData.change4h = f.o4h ? ((price - f.o4h) / f.o4h) * 100 : 0;
                }

                // Add OI
                if (oiData && oiData[t.symbol]) {
                    newData.openInterest = oiData[t.symbol];
                    newData.openInterestValue = (parseFloat(oiData[t.symbol]) * price).toString();
                }

                // Add RSRS
                if (rsrsData && rsrsData[t.symbol]) {
                    const rsrs = rsrsData[t.symbol];
                    newData.rsrsFinal = rsrs.rsrsFinal;
                    newData.rsrsZScore = rsrs.zScore;
                    newData.rsrsDynamicLongThreshold = rsrs.dynamicLongThreshold;
                    newData.rsrsDynamicShortThreshold = rsrs.dynamicShortThreshold;
                }

                return newData;
            });

        // 3. Execute Strategies
        let newSignalsCount = 0;
        let telegramMessagesSent = 0;
        const enabledStrategies = strategyRegistry.getEnabled();

        for (const data of processedData) {
            for (const strategy of enabledStrategies) {
                const signal = strategy.detect(data);

                // Filter: we only want to push high confidence signals to Telegram
                if (signal && signal.confidence !== undefined && signal.confidence >= 80) {
                    newSignalsCount++;

                    const directionIcon = signal.direction === 'long' ? '🟢 做多' : '🔴 做空';
                    const symbolClean = signal.symbol.replace('USDT', '');
                    const priceFormatted = signal.price !== undefined ? parseFloat(String(signal.price)).toFixed(4) : (signal.metrics?.entryPrice ? parseFloat(String(signal.metrics.entryPrice)).toFixed(4) : 'N/A');

                    const message = `
<b>🔔 战术雷达报警 | ${symbolClean}</b>
 
<b>策略:</b> ${signal.strategyName}
<b>方向:</b> ${directionIcon} (置信度 ${Math.round(signal.confidence)}分)
<b>触发价格:</b> $${priceFormatted}
 
<b>📝 诊断:</b>
${signal.reason}
                     `;

                    const sent = await sendTelegramMessage(message);
                    if (sent) telegramMessagesSent++;
                }
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[Cron] Scan completed in ${duration}s. Found ${newSignalsCount} high-conf signals. Sent ${telegramMessagesSent} TG messages.`);

        return NextResponse.json({
            success: true,
            scannedTokens: processedData.length,
            signalsFound: newSignalsCount,
            messagesSent: telegramMessagesSent,
            durationSeconds: duration
        });

    } catch (error) {
        console.error('[Cron] Error executing scan:', error);
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
