"use client";

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import Dashboard from '@/components/Dashboard';
import TabNavigation from '@/components/TabNavigation';
import ChartDrawer from '@/components/ChartDrawer';

const StrategyCenter = dynamic(() => import('@/components/StrategyCenter'));
const SimulatedTrading = dynamic(() => import('@/components/SimulatedTrading'));
const LongShortPanel = dynamic(() => import('@/components/LongShortPanel'));
const OnchainTracker = dynamic(() => import('@/components/OnchainTracker'));
const MacroView = dynamic(() => import('@/components/MacroView'));
const WatchlistsPanel = dynamic(() => import('@/components/WatchlistsPanel'));
const LeaderboardView = dynamic(() => import('@/components/LeaderboardView'));

export type AppTab = 'dashboard' | 'leaderboard' | 'macro' | 'watchlists' | 'longshort' | 'onchain' | 'strategies' | 'trading';

interface WorkspaceViewsProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  showMarketConnectionAlert: boolean;
  showEmptyMarketAlert: boolean;
  showOpenInterestUnavailableAlert: boolean;
  dashboardProps: ComponentProps<typeof Dashboard>;
  leaderboardProps: ComponentProps<typeof LeaderboardView>;
  macroProps: ComponentProps<typeof MacroView>;
  watchlistsProps: ComponentProps<typeof WatchlistsPanel>;
  strategyProps: ComponentProps<typeof StrategyCenter>;
  tradingProps: ComponentProps<typeof SimulatedTrading>;
  chartProps: ComponentProps<typeof ChartDrawer>;
}

export default function WorkspaceViews({
  activeTab,
  onTabChange,
  showMarketConnectionAlert,
  showEmptyMarketAlert,
  showOpenInterestUnavailableAlert,
  dashboardProps,
  leaderboardProps,
  macroProps,
  watchlistsProps,
  strategyProps,
  tradingProps,
  chartProps,
}: WorkspaceViewsProps) {
  return (
    <main className="container">
      <TabNavigation activeTab={activeTab} onChange={onTabChange} />
      {showMarketConnectionAlert && (
        <div className="data-alert data-alert-error">
          数据服务连接失败：请检查网络或代理是否可访问 Binance Futures（fapi.binance.com）。
        </div>
      )}
      {showEmptyMarketAlert && (
        <div className="data-alert data-alert-warning">
          当前未获取到有效行情数据，请稍后重试。
        </div>
      )}
      {showOpenInterestUnavailableAlert && (
        <div className="data-alert data-alert-warning">
          OI 数据源暂不可用，不代表市场没有持仓数据。
        </div>
      )}
      {activeTab === 'dashboard' && <Dashboard {...dashboardProps} />}
      {activeTab === 'leaderboard' && <LeaderboardView {...leaderboardProps} />}
      {activeTab === 'macro' && <MacroView {...macroProps} />}
      {activeTab === 'watchlists' && <WatchlistsPanel {...watchlistsProps} />}
      {activeTab === 'longshort' && <LongShortPanel />}
      {activeTab === 'onchain' && <OnchainTracker />}
      {activeTab === 'strategies' && <StrategyCenter {...strategyProps} />}
      {activeTab === 'trading' && <SimulatedTrading {...tradingProps} />}
      <ChartDrawer {...chartProps} />
    </main>
  );
}
