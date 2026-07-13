"use client";

import styles from './TabNavigation.module.css';

type TabType = 'dashboard' | 'leaderboard' | 'macro' | 'watchlists' | 'longshort' | 'onchain' | 'strategies' | 'trading';

interface TabNavigationProps {
    activeTab: TabType;
    onChange: (tab: TabType) => void;
}

export default function TabNavigation({ activeTab, onChange }: TabNavigationProps) {
    return (
        <nav className={styles.tabNav} aria-label="主要功能">
            <button
                className={`${styles.tabBtn} ${activeTab === 'dashboard' ? styles.active : ''}`}
                onClick={() => onChange('dashboard')}
                aria-current={activeTab === 'dashboard' ? 'page' : undefined}
            >
                📊 数据面板
            </button>
            <button
                className={`${styles.tabBtn} ${activeTab === 'leaderboard' ? styles.active : ''}`}
                onClick={() => onChange('leaderboard')}
                aria-current={activeTab === 'leaderboard' ? 'page' : undefined}
            >
                🏆 异动排行榜
            </button>
            <button
                className={`${styles.tabBtn} ${activeTab === 'macro' ? styles.active : ''}`}
                onClick={() => onChange('macro')}
                aria-current={activeTab === 'macro' ? 'page' : undefined}
            >
                🌐 宏观视角
            </button>
            <button
                className={`${styles.tabBtn} ${activeTab === 'watchlists' ? styles.active : ''}`}
                onClick={() => onChange('watchlists')}
                aria-current={activeTab === 'watchlists' ? 'page' : undefined}
            >
                🗂️ 自选名单
            </button>
            <button
                className={`${styles.tabBtn} ${activeTab === 'longshort' ? styles.active : ''}`}
                onClick={() => onChange('longshort')}
                aria-current={activeTab === 'longshort' ? 'page' : undefined}
            >
                📈 多空比
            </button>
            <button
                className={`${styles.tabBtn} ${activeTab === 'onchain' ? styles.active : ''}`}
                onClick={() => onChange('onchain')}
                aria-current={activeTab === 'onchain' ? 'page' : undefined}
            >
                ⛓️ 链上筹码观察
            </button>
            <button
                className={`${styles.tabBtn} ${activeTab === 'strategies' ? styles.active : ''}`}
                onClick={() => onChange('strategies')}
                aria-current={activeTab === 'strategies' ? 'page' : undefined}
            >
                🎯 策略专区
            </button>
            <button
                className={`${styles.tabBtn} ${activeTab === 'trading' ? styles.active : ''}`}
                onClick={() => onChange('trading')}
                aria-current={activeTab === 'trading' ? 'page' : undefined}
            >
                💼 模拟交易
            </button>
        </nav>
    );
}
