"use client";

import { useState, useMemo, useEffect, useCallback, useDeferredValue } from 'react';
import { TickerData } from '@/lib/types';
import { usePageVisibility } from '@/hooks/usePageVisibility';
import { usePersistentSWR } from '@/hooks/usePersistentSWR';
import Dashboard from '@/components/Dashboard';
import StrategyCenter from '@/components/StrategyCenter';
import SimulatedTrading from '@/components/SimulatedTrading';
import LongShortPanel from '@/components/LongShortPanel';
import TabNavigation from '@/components/TabNavigation';
import ChartDrawer from '@/components/ChartDrawer';
import { useStrategyScanner } from '@/hooks/useStrategyScanner';
import { formatPrice } from '@/lib/risk/priceUtils';

type MultiFrameDataMap = Record<string, { o15m: number; o1h: number; o4h: number }>;
type RsrsDataMap = Record<string, {
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
}>;
type TimedPayload<T> = {
  data: T;
  fetchedAt: number;
  cacheAgeSeconds?: number;
  dataSource?: string;
};

const MAX_STRATEGY_MARKET_DATA_AGE_MS = 5 * 60 * 1000;
const MAX_STRATEGY_FRAME_DATA_AGE_SECONDS = 20 * 60;
const MAX_STRATEGY_RSRS_DATA_AGE_SECONDS = 6 * 60 * 60;

function parseOptionalSeconds(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getLatestCloseTime(data: TickerData[] | undefined): number | undefined {
  if (!data || data.length === 0) {
    return undefined;
  }

  let latestCloseTime = 0;
  data.forEach((ticker) => {
    if (Number.isFinite(ticker.closeTime) && ticker.closeTime > latestCloseTime) {
      latestCloseTime = ticker.closeTime;
    }
  });

  return latestCloseTime > 0 ? latestCloseTime : undefined;
}

function isTimedPayloadFresh(payload: TimedPayload<unknown> | undefined, maxAgeSeconds: number): boolean {
  if (!payload) {
    return false;
  }

  if (payload.cacheAgeSeconds !== undefined) {
    return payload.cacheAgeSeconds <= maxAgeSeconds;
  }

  return (Date.now() - payload.fetchedAt) <= maxAgeSeconds * 1000;
}

function isHeavyMarketPayloadFresh(payload: TimedPayload<TickerData[]> | undefined): boolean {
  if (!payload || !Array.isArray(payload.data) || payload.data.length === 0) {
    return false;
  }

  if (payload.cacheAgeSeconds !== undefined && payload.cacheAgeSeconds > MAX_STRATEGY_MARKET_DATA_AGE_MS / 1000) {
    return false;
  }

  const latestCloseTime = getLatestCloseTime(payload.data);
  if (latestCloseTime !== undefined) {
    return (Date.now() - latestCloseTime) <= MAX_STRATEGY_MARKET_DATA_AGE_MS;
  }

  return (Date.now() - payload.fetchedAt) <= MAX_STRATEGY_MARKET_DATA_AGE_MS;
}

function enrichTickerWithDeferredData(
  ticker: TickerData,
  frameData?: MultiFrameDataMap,
  rsrsData?: RsrsDataMap
): TickerData {
  const nextTicker = { ...ticker };
  const valuationPrice = parseFloat(ticker.markPrice || ticker.lastPrice);
  const price = parseFloat(ticker.lastPrice);

  if (!Number.isFinite(price)) {
    return nextTicker;
  }

  if ((!nextTicker.openInterestValue || nextTicker.openInterestValue === '0') && nextTicker.openInterest && Number.isFinite(valuationPrice)) {
    nextTicker.openInterestValue = (parseFloat(nextTicker.openInterest) * valuationPrice).toString();
  }

  if (frameData) {
    const frame = frameData[ticker.symbol];
    if (frame) {
      nextTicker.change15m = frame.o15m ? ((price - frame.o15m) / frame.o15m) * 100 : 0;
      nextTicker.change1h = frame.o1h ? ((price - frame.o1h) / frame.o1h) * 100 : 0;
      nextTicker.change4h = frame.o4h ? ((price - frame.o4h) / frame.o4h) * 100 : 0;
    }
  }

  if (rsrsData && rsrsData[ticker.symbol]) {
    const rsrs = rsrsData[ticker.symbol];
    nextTicker.rsrs = rsrs.beta;
    nextTicker.rsrsZScore = rsrs.zScore;
    nextTicker.rsrsFinal = rsrs.rsrsFinal;
    nextTicker.rsrsR2 = rsrs.r2;
    nextTicker.rsrsDynamicLongThreshold = rsrs.dynamicLongThreshold;
    nextTicker.rsrsDynamicShortThreshold = rsrs.dynamicShortThreshold;
    nextTicker.bollingerUpper = rsrs.bollingerUpper;
    nextTicker.bollingerMid = rsrs.bollingerMid;
    nextTicker.bollingerLower = rsrs.bollingerLower;
    nextTicker.volumeMA = rsrs.volumeMA;
    nextTicker.rsrsROC = rsrs.rsrsROC;
    nextTicker.rsrsAcceleration = rsrs.rsrsAcceleration;
    nextTicker.rsrsAdaptiveWindow = rsrs.adaptiveWindow;
    nextTicker.rsrsMethod = rsrs.method;
  }

  return nextTicker;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Failed to fetch data: ' + res.status);
  }
  return res.json();
};

async function fetcherWithMeta<T>(url: string): Promise<TimedPayload<T>> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Failed to fetch data: ' + res.status);
  }

  return {
    data: await res.json() as T,
    fetchedAt: Date.now(),
    cacheAgeSeconds: parseOptionalSeconds(res.headers.get('X-Cache-Age-Seconds')),
    dataSource: res.headers.get('X-Data-Source') || undefined,
  };
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'longshort' | 'strategies' | 'trading'>('dashboard');
  const isPageVisible = usePageVisibility();
  const [enableHeavyMarket, setEnableHeavyMarket] = useState(false);
  const [enableDeferredIndicators, setEnableDeferredIndicators] = useState(false);

  // Smart refresh: slower when page is hidden to save resources
  const fastMarketRefreshInterval = isPageVisible ? 3000 : 30000;
  const heavyMarketRefreshInterval = isPageVisible ? 30000 : 300000;
  const multiframeRefreshInterval = isPageVisible ? 30000 : 300000;

  const { data: lightMarketData, error: marketError, isLoading: marketLoading } = usePersistentSWR<TickerData[]>('/api/market/light', fetcher, {
    refreshInterval: fastMarketRefreshInterval,
    revalidateOnFocus: false,
    dedupingInterval: 2000,
    storageTtlMs: 10 * 60 * 1000,
    persistIntervalMs: 20 * 1000,
  });

  const { data: openInterestData } = usePersistentSWR<Record<string, string>>('/api/oi/all', fetcher, {
    refreshInterval: isPageVisible ? 30000 : 300000,
    revalidateOnFocus: false,
    dedupingInterval: 15000,
    storageTtlMs: 10 * 60 * 1000,
    persistIntervalMs: 60 * 1000,
  });

  const { data: heavyMarketPayload } = usePersistentSWR<TimedPayload<TickerData[]>>(
    enableHeavyMarket ? '/api/market' : null,
    enableHeavyMarket ? ((url: string) => fetcherWithMeta<TickerData[]>(url)) : null,
    {
      refreshInterval: heavyMarketRefreshInterval,
      revalidateOnFocus: false,
      dedupingInterval: 15000,
      storageTtlMs: 15 * 60 * 1000,
      persistIntervalMs: 60 * 1000,
      storageKey: 'persistent-swr:v2:/api/market',
    }
  );

  const { data: framePayload, error: frameError } = usePersistentSWR<TimedPayload<MultiFrameDataMap>>(
    enableDeferredIndicators ? '/api/market/multiframe' : null,
    enableDeferredIndicators ? ((url: string) => fetcherWithMeta<MultiFrameDataMap>(url)) : null,
    {
    refreshInterval: multiframeRefreshInterval,
    revalidateOnFocus: false,
    dedupingInterval: 15000,
    storageTtlMs: 30 * 60 * 1000,
    persistIntervalMs: 5 * 60 * 1000,
    storageKey: 'persistent-swr:v2:/api/market/multiframe',
    }
  );

  const { data: rsrsPayload, error: rsrsError } = usePersistentSWR<TimedPayload<RsrsDataMap>>(
    enableDeferredIndicators ? '/api/rsrs' : null,
    enableDeferredIndicators ? ((url: string) => fetcherWithMeta<RsrsDataMap>(url)) : null,
    {
    refreshInterval: 60 * 60 * 1000, // Refresh every hour
    revalidateOnFocus: false,
    dedupingInterval: 5 * 60 * 1000,
    storageTtlMs: 6 * 60 * 60 * 1000,
    persistIntervalMs: 30 * 60 * 1000,
    storageKey: 'persistent-swr:v2:/api/rsrs',
    }
  );

  const heavyMarketData = heavyMarketPayload?.data;
  const frameData = framePayload?.data;
  const rsrsData = rsrsPayload?.data;

  useEffect(() => {
    if (!lightMarketData || lightMarketData.length === 0 || (enableHeavyMarket && enableDeferredIndicators)) {
      return;
    }

    const timer = window.setTimeout(() => {
      setEnableHeavyMarket(true);
      setEnableDeferredIndicators(true);
    }, 150);

    return () => window.clearTimeout(timer);
  }, [enableDeferredIndicators, enableHeavyMarket, lightMarketData]);

  const baseMarketData = useMemo(() => {
    if (!lightMarketData || lightMarketData.length === 0) {
      return undefined;
    }

    return lightMarketData.map((ticker) => {
      const openInterest = openInterestData?.[ticker.symbol];
      if (!openInterest) {
        return ticker;
      }

      const valuationPrice = parseFloat(ticker.markPrice || ticker.lastPrice);
      const numericOpenInterest = parseFloat(openInterest);
      const openInterestValue = Number.isFinite(valuationPrice) && Number.isFinite(numericOpenInterest)
        ? (numericOpenInterest * valuationPrice).toString()
        : undefined;

      return {
        ...ticker,
        openInterest,
        openInterestValue,
      };
    });
  }, [lightMarketData, openInterestData]);

  const rawData = useMemo(() => {
    if (!baseMarketData || baseMarketData.length === 0) {
      return heavyMarketData;
    }

    if (!heavyMarketData || heavyMarketData.length === 0) {
      return baseMarketData;
    }

    const heavyMap = new Map(heavyMarketData.map((ticker) => [ticker.symbol, ticker]));
    return baseMarketData.map((ticker) => {
      const heavyTicker = heavyMap.get(ticker.symbol);

      return {
        ...ticker,
        ...(heavyTicker || {}),
        lastPrice: ticker.lastPrice,
        priceChange: ticker.priceChange,
        priceChangePercent: ticker.priceChangePercent,
        weightedAvgPrice: ticker.weightedAvgPrice,
        prevClosePrice: ticker.prevClosePrice,
        highPrice: ticker.highPrice,
        lowPrice: ticker.lowPrice,
        volume: ticker.volume,
        quoteVolume: ticker.quoteVolume,
        openTime: ticker.openTime,
        closeTime: ticker.closeTime,
        markPrice: ticker.markPrice || heavyTicker?.markPrice,
        fundingRate: ticker.fundingRate || heavyTicker?.fundingRate,
        openInterest: ticker.openInterest || heavyTicker?.openInterest,
        openInterestValue: ticker.openInterestValue || heavyTicker?.openInterestValue,
      };
    });
  }, [baseMarketData, heavyMarketData]);

  // Process and merge all data
  const processedData = useMemo(() => {
    if (!rawData || !Array.isArray(rawData)) return [];

    // 1. Filter invalid rows and keep only USDT pairs
    let result = rawData.filter((t): t is TickerData => {
      if (!t || typeof t.symbol !== 'string') return false;
      if (typeof t.lastPrice !== 'string' || typeof t.quoteVolume !== 'string') return false;
      return t.symbol.endsWith('USDT');
    });

    // 2. Filter out stale data
    const now = Date.now();
    result = result.filter(t => Number.isFinite(t.closeTime) && (now - t.closeTime) < 24 * 60 * 60 * 1000);

    // 3. Filter out low-volume coins (test/alpha/delisted coins)
    result = result.filter(t => Number.isFinite(parseFloat(t.quoteVolume)) && parseFloat(t.quoteVolume) > 100000);

    // 4. Merge all data in one pass
    result = result.map((ticker) => enrichTickerWithDeferredData(ticker, frameData, rsrsData));

    return result;
  }, [rawData, frameData, rsrsData]);

  const isHeavyMarketFreshEnough = isHeavyMarketPayloadFresh(heavyMarketPayload);
  const isFrameDataFreshEnough = isTimedPayloadFresh(framePayload, MAX_STRATEGY_FRAME_DATA_AGE_SECONDS);
  const isRsrsDataFreshEnough = isTimedPayloadFresh(rsrsPayload, MAX_STRATEGY_RSRS_DATA_AGE_SECONDS);
  const strategyFrameData = isFrameDataFreshEnough ? frameData : undefined;
  const strategyRsrsData = isRsrsDataFreshEnough ? rsrsData : undefined;

  const strategyMarketData = useMemo(() => {
    if (!isHeavyMarketFreshEnough || !heavyMarketData || !Array.isArray(heavyMarketData)) {
      return [];
    }

    let result = heavyMarketData.filter((ticker): ticker is TickerData => {
      if (!ticker || typeof ticker.symbol !== 'string') return false;
      if (typeof ticker.lastPrice !== 'string' || typeof ticker.quoteVolume !== 'string') return false;
      return ticker.symbol.endsWith('USDT');
    });

    const now = Date.now();
    result = result.filter((ticker) => Number.isFinite(ticker.closeTime) && (now - ticker.closeTime) < 24 * 60 * 60 * 1000);
    result = result.filter((ticker) => Number.isFinite(parseFloat(ticker.quoteVolume)) && parseFloat(ticker.quoteVolume) > 100000);

    return result.map((ticker) => enrichTickerWithDeferredData(ticker, strategyFrameData, strategyRsrsData));
  }, [heavyMarketData, isHeavyMarketFreshEnough, strategyFrameData, strategyRsrsData]);

  const deferredStrategyMarketData = useDeferredValue(strategyMarketData);
  const isStrategyScannerReady = isHeavyMarketFreshEnough;
  const strategyScanData = useMemo(
    () => isStrategyScannerReady ? deferredStrategyMarketData : [],
    [deferredStrategyMarketData, isStrategyScannerReady]
  );

  // Run strategy scanner
  const { signals, dismissSignal, clearAll: clearAllSignals } = useStrategyScanner(strategyScanData);
  // Keep the latest known signals visible even if a deferred data source is temporarily stale.
  const visibleSignals = signals;

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
  // 🔥 Fixed infinite loop: only depend on signals and raw price extraction, not the entire processedData object
  useEffect(() => {
    if (visibleSignals.length > 0) {
      const topSignal = visibleSignals[0];
      const cleanSymbol = topSignal.symbol.replace('USDT', '');

      // Get current price
      const price = topSignal.price || 0; // Use the price snapshotted at signal time (or could lookup from rawData)
      const priceStr = formatPrice(price);

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
  }, [visibleSignals]);

  return (
    <main className="container">
      <TabNavigation activeTab={activeTab} onChange={setActiveTab} />
      {(marketError || frameError || rsrsError) && (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid rgba(246, 70, 93, 0.4)',
            background: 'rgba(246, 70, 93, 0.1)',
            color: '#fca5a5',
            fontSize: 13,
          }}
        >
          数据服务连接失败：请检查网络或代理是否可访问 Binance Futures（fapi.binance.com）。
        </div>
      )}
      {!marketLoading && !marketError && processedData.length === 0 && (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid rgba(245, 158, 11, 0.4)',
            background: 'rgba(245, 158, 11, 0.1)',
            color: '#fcd34d',
            fontSize: 13,
          }}
        >
          当前未获取到有效行情数据，请稍后重试。
        </div>
      )}

      {activeTab === 'dashboard' && (
        <Dashboard processedData={processedData} onSymbolClick={handleSymbolClick} />
      )}
      {activeTab === 'longshort' && (
        <LongShortPanel />
      )}
      {activeTab === 'strategies' && (
        <StrategyCenter
          signals={visibleSignals}
          dismissSignal={dismissSignal}
          clearAllSignals={clearAllSignals}
          onSymbolClick={handleSymbolClick}
        />
      )}
      {activeTab === 'trading' && (
        <SimulatedTrading />
      )}

      {/* Shared ChartDrawer for all tabs */}
      {selectedSymbol && (
        <ChartDrawer symbol={selectedSymbol} onClose={handleCloseChart} />
      )}
    </main>
  );
}
