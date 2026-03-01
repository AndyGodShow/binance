"use client";

import { useState, useMemo, useEffect, useCallback } from 'react';
import useSWR from 'swr';
import { TickerData } from '@/lib/types';
import { usePageVisibility } from '@/hooks/usePageVisibility';
import { useKlineWebSocket } from '@/hooks/useKlineWebSocket';
import Dashboard from '@/components/Dashboard';
import StrategyCenter from '@/components/StrategyCenter';
import SimulatedTrading from '@/components/SimulatedTrading';
import LongShortPanel from '@/components/LongShortPanel';
import TabNavigation from '@/components/TabNavigation';
import ChartDrawer from '@/components/ChartDrawer';
import { useStrategyScanner } from '@/hooks/useStrategyScanner';
import DataManager from '@/components/DataManager';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function Home() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'longshort' | 'strategies' | 'trading'>('dashboard');
  const isPageVisible = usePageVisibility();

  // Smart refresh: slower when page is hidden to save resources
  const marketRefreshInterval = isPageVisible ? 3000 : 30000;
  const oiRefreshInterval = isPageVisible ? 15000 : 60000;

  // Data fetching (shared between Dashboard and StrategyCenter)
  const { data: rawData } = useSWR<TickerData[]>('/api/market', fetcher, {
    refreshInterval: marketRefreshInterval,
  });

  const { data: oiData } = useSWR<Record<string, string>>('/api/oi/all', fetcher, {
    refreshInterval: oiRefreshInterval,
  });

  // Get symbol list for WebSocket subscription
  const symbols = useMemo(() => {
    return rawData?.map(t => t.symbol.toLowerCase()) || [];
  }, [rawData]);

  // Use WebSocket for multi-timeframe data (replaces REST API)
  const { data: frameData } = useKlineWebSocket(symbols);

  const { data: rsrsData } = useSWR<Record<string, {
    beta: number;
    zScore: number;
    r2: number;
    rsrsFinal: number;
    dynamicLongThreshold: number;
    dynamicShortThreshold: number;
    bollingerUpper: number;
    bollingerMid: number;
    bollingerLower: number;
    volumeMA: number;
    rsrsROC: number;
    rsrsAcceleration: number;
    adaptiveWindow: number;
    method: string;
  }>>('/api/rsrs', fetcher, {
    refreshInterval: 60 * 60 * 1000, // Refresh every hour
  });

  // Process and merge all data
  const processedData = useMemo(() => {
    if (!rawData) return [];

    // 1. Filter only USDT pairs (Standard Futures)
    let result = rawData.filter(t => t.symbol.endsWith('USDT'));

    // 2. Filter out stale data
    const now = Date.now();
    result = result.filter(t => (now - t.closeTime) < 24 * 60 * 60 * 1000);

    // 3. Filter out low-volume coins (test/alpha/delisted coins)
    result = result.filter(t => parseFloat(t.quoteVolume) > 100000);

    // 4. Merge all data in one pass
    result = result.map(t => {
      const newData = { ...t };
      const price = parseFloat(t.lastPrice);

      // Add OI data
      if (oiData) {
        newData.openInterest = oiData[t.symbol] || '0';
        newData.openInterestValue = (parseFloat(oiData[t.symbol] || '0') * price).toString();
      }

      // Add multi-frame data
      if (frameData) {
        const f = frameData[t.symbol.toLowerCase()];
        if (f) {
          newData.change15m = f.o15m ? ((price - f.o15m) / f.o15m) * 100 : 0;
          newData.change1h = f.o1h ? ((price - f.o1h) / f.o1h) * 100 : 0;
          newData.change4h = f.o4h ? ((price - f.o4h) / f.o4h) * 100 : 0;
        }
      }

      // Add RSRS data
      if (rsrsData && rsrsData[t.symbol]) {
        const rsrs = rsrsData[t.symbol];
        newData.rsrs = rsrs.beta;
        newData.rsrsZScore = rsrs.zScore;
        newData.rsrsFinal = rsrs.rsrsFinal;
        newData.rsrsR2 = rsrs.r2;
        newData.rsrsDynamicLongThreshold = rsrs.dynamicLongThreshold;
        newData.rsrsDynamicShortThreshold = rsrs.dynamicShortThreshold;
        newData.bollingerUpper = rsrs.bollingerUpper;
        newData.bollingerMid = rsrs.bollingerMid;
        newData.bollingerLower = rsrs.bollingerLower;
        newData.volumeMA = rsrs.volumeMA;
        newData.rsrsROC = rsrs.rsrsROC;
        newData.rsrsAcceleration = rsrs.rsrsAcceleration;
        newData.rsrsAdaptiveWindow = rsrs.adaptiveWindow;
        newData.rsrsMethod = rsrs.method;
      }

      return newData;
    });

    return result;
  }, [rawData, oiData, frameData, rsrsData]);

  // Run strategy scanner
  const { signals, dismissSignal, clearAll: clearAllSignals } = useStrategyScanner(processedData);

  // 🔧 Shared state for chart drawer (shared between Dashboard and StrategyCenter)
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  // 使用useCallback优化回调函数
  const handleSymbolClick = useCallback((symbol: string) => {
    setSelectedSymbol(prev => prev === symbol ? null : symbol);
  }, []);

  const handleCloseChart = useCallback(() => {
    setSelectedSymbol(null);
  }, []);

  // Dynamic title update when there are active signals
  useEffect(() => {
    if (signals.length > 0) {
      const topSignal = signals[0];
      const cleanSymbol = topSignal.symbol.replace('USDT', '');

      // Find current price from processedData
      const ticker = processedData.find(t => t.symbol === topSignal.symbol);
      const price = ticker ? parseFloat(ticker.lastPrice) : 0;
      const priceStr = price < 1 ? price.toFixed(4) : price.toFixed(2);

      document.title = `🔔 ${cleanSymbol} $${priceStr} | 币安数据面板`;

      // Blink effect
      let blinkCount = 0;
      const blinkInterval = setInterval(() => {
        document.title = blinkCount % 2 === 0
          ? `🔴 ${cleanSymbol} $${priceStr} | 币安数据面板`
          : `🔔 ${cleanSymbol} $${priceStr} | 币安数据面板`;
        blinkCount++;
        if (blinkCount >= 6) clearInterval(blinkInterval);
      }, 500);

      return () => clearInterval(blinkInterval);
    } else {
      document.title = 'Binance Data Dashboard';
    }
  }, [signals, processedData]);

  return (
    <main className="container">
      <TabNavigation activeTab={activeTab} onChange={setActiveTab} />

      <div style={{ display: activeTab === 'dashboard' ? 'block' : 'none' }}>
        <Dashboard processedData={processedData} onSymbolClick={handleSymbolClick} />
      </div>
      <div style={{ display: activeTab === 'longshort' ? 'block' : 'none' }}>
        <LongShortPanel />
      </div>
      <div style={{ display: activeTab === 'strategies' ? 'block' : 'none' }}>
        <StrategyCenter
          data={processedData}
          signals={signals}
          dismissSignal={dismissSignal}
          clearAllSignals={clearAllSignals}
          onSymbolClick={handleSymbolClick}
        />
      </div>
      <div style={{ display: activeTab === 'trading' ? 'block' : 'none' }}>
        <SimulatedTrading />
        <div className="mt-8 border-t border-gray-800 pt-8">
          <DataManager />
        </div>
      </div>

      {/* Shared ChartDrawer for all tabs */}
      {selectedSymbol && (
        <ChartDrawer symbol={selectedSymbol} onClose={handleCloseChart} />
      )}
    </main>
  );
}
