"use client";

import { useState, useMemo, useEffect, useCallback, useDeferredValue } from 'react';
import { TickerData } from '@/lib/types';
import { usePageVisibility } from '@/hooks/usePageVisibility';
import { usePersistentSWR } from '@/hooks/usePersistentSWR';
import { useProgressiveTimedPayload } from '@/hooks/useProgressiveTimedPayload';
import Dashboard from '@/components/Dashboard';
import StrategyCenter from '@/components/StrategyCenter';
import SimulatedTrading from '@/components/SimulatedTrading';
import LongShortPanel from '@/components/LongShortPanel';
import OnchainTracker from '@/components/OnchainTracker';
import MacroView from '@/components/MacroView';
import TabNavigation from '@/components/TabNavigation';
import ChartDrawer from '@/components/ChartDrawer';
import WatchlistsPanel from '@/components/WatchlistsPanel';
import LeaderboardView from '@/components/LeaderboardView';
import { useStrategyScanner } from '@/hooks/useStrategyScanner';
import { useWatchlists } from '@/hooks/useWatchlists';
import { formatPrice } from '@/lib/risk/priceUtils';
import { StrategySignal } from '@/lib/strategyTypes';
import type { DeepPartial, StrategyParameterConfigMap } from '@/lib/strategyParameters';
import {
  isHeavyMarketPayloadFresh,
  isStrategyScanCandidate,
  isTimedPayloadFresh,
  mergeBaseAndHeavyMarketData,
  mergeLightMarketOpenInterest,
  mergeOpenInterestFramesToTickers,
  normalizeTickerUniverse,
  parseOptionalSeconds,
  selectFullCoverageFuturesIndicatorSymbols,
  selectOpenInterestCoverageSymbols,
  type MultiFrameDataMap,
  type OpenInterestFrameDataMap,
  type RsrsDataMap,
  type TimedPayload,
} from '@/lib/liveMarketData';
import { buildMarketDataStatus } from '@/lib/strategyScannerDiagnostics';
import { summarizeTimedPayloadQuality } from '@/lib/dataQualityStatus';
import {
  shouldShowMarketConnectionAlert,
  shouldShowOpenInterestUnavailableAlert,
} from '@/lib/dashboardAlerts';

type AppTab = 'dashboard' | 'leaderboard' | 'macro' | 'watchlists' | 'longshort' | 'onchain' | 'strategies' | 'trading';

const APP_TABS: AppTab[] = ['dashboard', 'leaderboard', 'macro', 'watchlists', 'longshort', 'onchain', 'strategies', 'trading'];

function isAppTab(value: string | null): value is AppTab {
  return value !== null && APP_TABS.includes(value as AppTab);
}

function createDemoSignals(now: number): StrategySignal[] {
  return [
    {
      symbol: 'BTCUSDT',
      strategyId: 'demo-breakout',
      strategyName: '演示突破信号',
      direction: 'long',
      confidence: 96,
      reason: '15m / 1h / 4h 同步转强，量能放大，作为演示信号注入。',
      metrics: { momentum: 2.8, volumeRatio: 1.9 },
      timestamp: now - 3 * 60 * 1000,
      price: 108250,
      status: 'active',
      stackCount: 3,
      stackedStrategies: ['演示突破信号', '量能共振', '短周期动量'],
      comboBonus: 20,
    },
    {
      symbol: 'ETHUSDT',
      strategyId: 'demo-funding',
      strategyName: '演示费率反转',
      direction: 'short',
      confidence: 89,
      reason: '费率偏热且价格背离，作为演示做空信号展示。',
      metrics: { fundingRate: 0.0009, divergence: 1.4 },
      timestamp: now - 15 * 60 * 1000,
      price: 5120,
      status: 'snapshot',
    },
    {
      symbol: 'SOLUSDT',
      strategyId: 'demo-squeeze',
      strategyName: '演示挤压释放',
      direction: 'long',
      confidence: 91,
      reason: '波动挤压刚释放，信号已回落但保留供演示查看。',
      metrics: { squeezeStrength: 0.82, adx: 27 },
      timestamp: now - 45 * 60 * 1000,
      lastSeenAt: now - 8 * 60 * 1000,
      price: 228,
      status: 'cooling',
    },
  ];
}

const MAX_STRATEGY_MARKET_DATA_AGE_MS = 5 * 60 * 1000;
const MAX_STRATEGY_FRAME_DATA_AGE_SECONDS = 20 * 60;
const MULTIFRAME_BATCH_SIZE = 20;
const MULTIFRAME_BATCH_DELAY_MS = 100;
const OI_MULTIFRAME_BATCH_SIZE = 10;
const OI_MULTIFRAME_BATCH_DELAY_MS = 150;
const DEFERRED_INDICATOR_INITIAL_SYMBOL_LIMIT = 80;
const DEFERRED_INDICATOR_SYMBOL_LIMIT = 160;
const DEFERRED_INDICATOR_EXPAND_DELAY_MS = 12_000;
const DEFERRED_INDICATOR_FULL_COVERAGE_DELAY_MS = 45_000;
const DEMO_BASE_TIME = Date.UTC(2026, 3, 10, 10, 30, 0);

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  return readSuccessfulJson(res);
}

async function readSuccessfulJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error('Failed to fetch data: ' + res.status);
  }

  return res.json() as Promise<T>;
}

async function fetcherWithMeta<T>(url: string): Promise<TimedPayload<T>> {
  const res = await fetch(url);
  const body = await readSuccessfulJson<T>(res);
  const bodyRecord = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
  const qualitySummary = summarizeTimedPayloadQuality({
    dataQuality: res.headers.get('X-Data-Quality') || undefined,
    buildState: res.headers.get('X-Build-State') || undefined,
    dataSource: res.headers.get('X-Data-Source') || undefined,
    isStale: res.headers.get('X-Is-Stale') ? res.headers.get('X-Is-Stale') === '1' : undefined,
    isFallback: res.headers.get('X-Is-Fallback') ? res.headers.get('X-Is-Fallback') === '1' : undefined,
    errorKind: res.headers.get('X-Error-Kind') || undefined,
    body: bodyRecord,
  });

  return {
    data: body,
    fetchedAt: Date.now(),
    cacheAgeSeconds: parseOptionalSeconds(res.headers.get('X-Cache-Age-Seconds')),
    dataSource: qualitySummary.dataSource,
    dataQuality: qualitySummary.dataQuality,
    buildState: qualitySummary.buildState,
    isStale: qualitySummary.isStale,
    isFallback: qualitySummary.isFallback,
    errorKind: qualitySummary.errorKind,
  };
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [dashboardWatchlistId, setDashboardWatchlistId] = useState('all');
  const isPageVisible = usePageVisibility();
  const [enableHeavyMarket, setEnableHeavyMarket] = useState(false);
  const [enableDeferredIndicators, setEnableDeferredIndicators] = useState(false);
  const [deferredIndicatorsExpanded, setDeferredIndicatorsExpanded] = useState(false);
  const [deferredIndicatorsFullCoverage, setDeferredIndicatorsFullCoverage] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [strategyParameterOverrides, setStrategyParameterOverrides] = useState<DeepPartial<StrategyParameterConfigMap>>({});
  const {
    watchlists,
    activeWatchlist,
    addWatchlist,
    updateWatchlistName,
    removeWatchlist,
    setActiveWatchlist,
    addSymbol,
    removeSymbol,
  } = useWatchlists();

  useEffect(() => {
    if (dashboardWatchlistId === 'all') {
      return;
    }

    const exists = watchlists.some((watchlist) => watchlist.id === dashboardWatchlistId);
    if (!exists) {
      setDashboardWatchlistId('all');
    }
  }, [dashboardWatchlistId, watchlists]);

  // Smart refresh: slower when page is hidden to save resources
  const fastMarketRefreshInterval = isPageVisible ? 3000 : 30000;
  const heavyMarketRefreshInterval = isPageVisible ? 30000 : 300000;
  const multiframeRefreshInterval = isPageVisible ? 30000 : 300000;
  const oiMultiframeRefreshInterval = isPageVisible ? 60000 : 300000;
  const shouldRunLiveMarketRequests = activeTab !== 'trading';
  const shouldRunDeferredIndicatorRequests = shouldRunLiveMarketRequests && activeTab !== 'strategies';
  const shouldRunLeaderboardRequests = activeTab === 'dashboard' || activeTab === 'leaderboard';
  const shouldRunHeavyMarketRequests = shouldRunLiveMarketRequests;
  const heavyMarketEndpoint = activeTab === 'strategies' ? '/api/market/strategy' : '/api/market';

  const { data: lightMarketData, error: marketError, isLoading: marketLoading } = usePersistentSWR<TickerData[]>(
    shouldRunLiveMarketRequests ? '/api/market/light' : null,
    shouldRunLiveMarketRequests ? ((url: string) => fetcher<TickerData[]>(url)) : null,
    {
    refreshInterval: fastMarketRefreshInterval,
    revalidateOnFocus: false,
    dedupingInterval: 2000,
    storageTtlMs: 10 * 60 * 1000,
    persistIntervalMs: 20 * 1000,
    }
  );
  const liveMarketSymbolCount = lightMarketData?.length ?? 0;

  const openInterestData: Record<string, unknown> | undefined = undefined;

  const { data: heavyMarketPayload } = usePersistentSWR<TimedPayload<TickerData[]>>(
    shouldRunLiveMarketRequests && shouldRunHeavyMarketRequests && enableHeavyMarket ? heavyMarketEndpoint : null,
    shouldRunLiveMarketRequests && shouldRunHeavyMarketRequests && enableHeavyMarket ? ((url: string) => fetcherWithMeta<TickerData[]>(url)) : null,
    {
      refreshInterval: heavyMarketRefreshInterval,
      revalidateOnFocus: false,
      dedupingInterval: 15000,
      storageTtlMs: 15 * 60 * 1000,
      persistIntervalMs: 60 * 1000,
      storageKey: `persistent-swr:v2:${heavyMarketEndpoint}`,
    }
  );

  const { data: rsrsPayload, error: rsrsError } = usePersistentSWR<TimedPayload<RsrsDataMap>>(
    shouldRunDeferredIndicatorRequests && enableDeferredIndicators ? '/api/rsrs' : null,
    shouldRunDeferredIndicatorRequests && enableDeferredIndicators ? ((url: string) => fetcherWithMeta<RsrsDataMap>(url)) : null,
    {
    refreshInterval: 60 * 60 * 1000, // Refresh every hour
    revalidateOnFocus: false,
    dedupingInterval: 5 * 60 * 1000,
    storageTtlMs: 6 * 60 * 60 * 1000,
    persistIntervalMs: 30 * 60 * 1000,
    storageKey: 'persistent-swr:v2:/api/rsrs',
    }
  );

  const multiframeSymbols = useMemo(() => {
    if (!shouldRunDeferredIndicatorRequests || !lightMarketData || lightMarketData.length === 0) {
      return [];
    }

    return selectFullCoverageFuturesIndicatorSymbols(lightMarketData, {
      expanded: deferredIndicatorsExpanded,
      fullCoverage: deferredIndicatorsFullCoverage,
      initialLimit: DEFERRED_INDICATOR_INITIAL_SYMBOL_LIMIT,
      expandedLimit: DEFERRED_INDICATOR_SYMBOL_LIMIT,
    });
  }, [deferredIndicatorsExpanded, deferredIndicatorsFullCoverage, lightMarketData, shouldRunDeferredIndicatorRequests]);

  const multiframeSignature = useMemo(
    () => [...multiframeSymbols].sort().join(','),
    [multiframeSymbols]
  );

  const oiMultiframeSymbols = useMemo(() => {
    if (!lightMarketData || lightMarketData.length === 0) {
      return [];
    }

    return selectOpenInterestCoverageSymbols(lightMarketData);
  }, [lightMarketData]);

  const oiMultiframeSignature = useMemo(
    () => [...oiMultiframeSymbols].sort().join(','),
    [oiMultiframeSymbols]
  );

  const fetchMultiframeBatch = useCallback(
    (symbols: string[]) => fetcherWithMeta<MultiFrameDataMap>(
      `/api/market/multiframe?symbols=${encodeURIComponent(symbols.join(','))}`
    ),
    []
  );

  const buildMultiframeError = useCallback(
    (error: unknown) => error instanceof Error ? error : new Error('Failed to fetch multiframe batch'),
    []
  );

  const fetchOiMultiframeBatch = useCallback(
    (symbols: string[]) => fetcherWithMeta<OpenInterestFrameDataMap>(
      `/api/oi/multiframe?symbols=${encodeURIComponent(symbols.join(','))}`
    ),
    []
  );

  const buildOiMultiframeError = useCallback(
    (error: unknown) => error instanceof Error ? error : new Error('Failed to fetch OI multiframe batch'),
    []
  );

  const {
    payload: framePayload,
    error: frameError,
    setError: setFrameError,
  } = useProgressiveTimedPayload({
    enabled: shouldRunDeferredIndicatorRequests && enableDeferredIndicators && Boolean(multiframeSignature),
    symbols: multiframeSymbols,
    batchSize: MULTIFRAME_BATCH_SIZE,
    batchDelayMs: MULTIFRAME_BATCH_DELAY_MS,
    refreshIntervalMs: multiframeRefreshInterval,
    fetchBatch: fetchMultiframeBatch,
    buildError: buildMultiframeError,
    maxBatchAttempts: 3,
  });

  const {
    payload: oiFramePayload,
    error: oiFrameError,
    setError: setOiFrameError,
  } = useProgressiveTimedPayload({
    enabled: shouldRunLeaderboardRequests && Boolean(oiMultiframeSignature),
    symbols: oiMultiframeSymbols,
    batchSize: OI_MULTIFRAME_BATCH_SIZE,
    batchDelayMs: OI_MULTIFRAME_BATCH_DELAY_MS,
    refreshIntervalMs: oiMultiframeRefreshInterval,
    fetchBatch: fetchOiMultiframeBatch,
    buildError: buildOiMultiframeError,
    maxBatchAttempts: 3,
  });

  const heavyMarketData = heavyMarketPayload?.data;
  const frameData = framePayload?.data;
  const oiFrameData = oiFramePayload?.data;
  const rsrsData = rsrsPayload?.data;

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    setIsDemoMode(params.get('demo') === '1');
    const requestedTab = params.get('tab');
    if (isAppTab(requestedTab)) {
      setActiveTab(requestedTab);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const url = new URL(window.location.href);
    if (activeTab === 'dashboard') {
      url.searchParams.delete('tab');
    } else {
      url.searchParams.set('tab', activeTab);
    }

    window.history.replaceState({}, '', url.toString());
  }, [activeTab]);

  useEffect(() => {
    if (
      !shouldRunLiveMarketRequests ||
      liveMarketSymbolCount === 0 ||
      (enableHeavyMarket && (enableDeferredIndicators || !shouldRunDeferredIndicatorRequests))
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      setEnableHeavyMarket(true);
      setEnableDeferredIndicators(shouldRunDeferredIndicatorRequests);
    }, 150);

    return () => window.clearTimeout(timer);
  }, [
    enableDeferredIndicators,
    enableHeavyMarket,
    liveMarketSymbolCount,
    shouldRunDeferredIndicatorRequests,
    shouldRunLiveMarketRequests,
  ]);

  useEffect(() => {
    if (!shouldRunDeferredIndicatorRequests || !enableDeferredIndicators || liveMarketSymbolCount === 0) {
      setDeferredIndicatorsExpanded(false);
      setDeferredIndicatorsFullCoverage(false);
      return;
    }

    setDeferredIndicatorsExpanded(false);
    setDeferredIndicatorsFullCoverage(false);
    const expandTimer = window.setTimeout(() => {
      setDeferredIndicatorsExpanded(true);
    }, DEFERRED_INDICATOR_EXPAND_DELAY_MS);
    const fullCoverageTimer = window.setTimeout(() => {
      setDeferredIndicatorsFullCoverage(true);
    }, DEFERRED_INDICATOR_FULL_COVERAGE_DELAY_MS);

    return () => {
      window.clearTimeout(expandTimer);
      window.clearTimeout(fullCoverageTimer);
    };
  }, [enableDeferredIndicators, liveMarketSymbolCount, shouldRunDeferredIndicatorRequests]);

  useEffect(() => {
    if (shouldRunLiveMarketRequests) {
      return;
    }

    setEnableHeavyMarket(false);
    setEnableDeferredIndicators(false);
    setDeferredIndicatorsExpanded(false);
    setDeferredIndicatorsFullCoverage(false);
    setFrameError(null);
    setOiFrameError(null);
  }, [setFrameError, setOiFrameError, shouldRunLiveMarketRequests]);

  useEffect(() => {
    if (shouldRunLeaderboardRequests) {
      return;
    }

    setOiFrameError(null);
  }, [setOiFrameError, shouldRunLeaderboardRequests]);

  const baseMarketData = useMemo(
    () => mergeOpenInterestFramesToTickers(
      mergeLightMarketOpenInterest(lightMarketData, openInterestData),
      oiFrameData
    ),
    [lightMarketData, oiFrameData, openInterestData]
  );

  const rawData = useMemo(
    () => mergeBaseAndHeavyMarketData(baseMarketData, heavyMarketData),
    [baseMarketData, heavyMarketData]
  );
  const openInterestQuality = useMemo(
    () => summarizeTimedPayloadQuality({ body: openInterestData ?? oiFramePayload ?? null }),
    [oiFramePayload, openInterestData]
  );

  // Process and merge all data
  const processedData = useMemo(
    () => normalizeTickerUniverse(rawData, frameData, rsrsData),
    [rawData, frameData, rsrsData]
  );
  const showMarketConnectionAlert = shouldShowMarketConnectionAlert({
    shouldRunLiveMarketRequests,
    marketError,
    auxiliaryError: frameError || rsrsError || oiFrameError,
    processedDataLength: processedData.length,
  });
  const showOpenInterestUnavailableAlert = shouldShowOpenInterestUnavailableAlert({
    shouldRunLiveMarketRequests,
    hasOpenInterestPayload: Boolean(openInterestData) || Boolean(oiFrameData),
    isOpenInterestDegraded: openInterestQuality.isDegraded,
    processedData,
  });

  const isHeavyMarketFreshEnough = isHeavyMarketPayloadFresh(heavyMarketPayload, MAX_STRATEGY_MARKET_DATA_AGE_MS);
  const isFrameDataFreshEnough = isTimedPayloadFresh(framePayload, MAX_STRATEGY_FRAME_DATA_AGE_SECONDS);
  const strategyFrameData = isFrameDataFreshEnough ? frameData : undefined;

  const strategyMarketData = useMemo(
    () => isHeavyMarketFreshEnough
      ? normalizeTickerUniverse(heavyMarketData, strategyFrameData, undefined).filter(isStrategyScanCandidate)
      : [],
    [heavyMarketData, isHeavyMarketFreshEnough, strategyFrameData]
  );

  const deferredStrategyMarketData = useDeferredValue(strategyMarketData);
  const isStrategyScannerReady = isHeavyMarketFreshEnough;
  const strategyScanData = useMemo(
    () => isStrategyScannerReady ? deferredStrategyMarketData : [],
    [deferredStrategyMarketData, isStrategyScannerReady]
  );

  // Run strategy scanner
  const { signals, readinessSummary, dismissSignal, clearAll: clearAllSignals } = useStrategyScanner(strategyScanData, {
    parameterOverrides: strategyParameterOverrides,
  });
  const strategyMarketDataStatus = useMemo(
    () => buildMarketDataStatus({
      dataQuality: heavyMarketPayload?.dataQuality,
      buildState: heavyMarketPayload?.buildState,
      dataSource: heavyMarketPayload?.dataSource,
    }),
    [heavyMarketPayload?.buildState, heavyMarketPayload?.dataQuality, heavyMarketPayload?.dataSource]
  );
  const demoSignals = useMemo<StrategySignal[]>(() => {
    if (!isDemoMode) {
      return [];
    }

    return createDemoSignals(DEMO_BASE_TIME);
  }, [isDemoMode]);
  // Keep the latest known signals visible even if a deferred data source is temporarily stale.
  const visibleSignals = useMemo(
    () => isDemoMode ? [...demoSignals, ...signals] : signals,
    [demoSignals, isDemoMode, signals]
  );

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
      {showMarketConnectionAlert && (
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
      {shouldRunLiveMarketRequests && !marketLoading && !marketError && processedData.length === 0 && (
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
      {showOpenInterestUnavailableAlert && (
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
          OI 数据源暂不可用，不代表市场没有持仓数据。
        </div>
      )}

      {activeTab === 'dashboard' && (
        <Dashboard
          processedData={processedData}
          openInterestFrames={oiFrameData}
          onSymbolClick={handleSymbolClick}
          demoMode={isDemoMode}
          watchlists={watchlists}
          selectedWatchlistId={dashboardWatchlistId}
          onSelectWatchlist={setDashboardWatchlistId}
        />
      )}
      {activeTab === 'leaderboard' && (
        <LeaderboardView
          data={processedData}
          openInterestFrames={oiFrameData}
          onSymbolClick={handleSymbolClick}
        />
      )}
      {activeTab === 'macro' && (
        <MacroView />
      )}
      {activeTab === 'watchlists' && (
        <WatchlistsPanel
          marketData={processedData}
          watchlists={watchlists}
          activeWatchlistId={activeWatchlist?.id ?? null}
          onSymbolClick={handleSymbolClick}
          onSelectWatchlist={setActiveWatchlist}
          onCreateWatchlist={addWatchlist}
          onDeleteWatchlist={removeWatchlist}
          onRenameWatchlist={updateWatchlistName}
          onAddSymbol={addSymbol}
          onRemoveSymbol={removeSymbol}
          onOpenDashboardWatchlist={(watchlistId) => {
            setDashboardWatchlistId(watchlistId);
            setActiveTab('dashboard');
          }}
        />
      )}
      {activeTab === 'longshort' && (
        <LongShortPanel />
      )}
      {activeTab === 'onchain' && (
        <OnchainTracker />
      )}
      {activeTab === 'strategies' && (
        <StrategyCenter
          signals={visibleSignals}
          dismissSignal={dismissSignal}
          clearAllSignals={clearAllSignals}
          onSymbolClick={handleSymbolClick}
          marketDataStatus={strategyMarketDataStatus}
          readinessSummary={readinessSummary}
        />
      )}
      {activeTab === 'trading' && (
        <SimulatedTrading
          strategyParameterOverrides={strategyParameterOverrides}
          onStrategyParameterOverridesChange={setStrategyParameterOverrides}
        />
      )}

      {/* Shared ChartDrawer for all tabs */}
      {selectedSymbol && (
        <ChartDrawer symbol={selectedSymbol} onClose={handleCloseChart} />
      )}
    </main>
  );
}
