"use client";

import styles from './TabNavigation.module.css';

type TabType = 'dashboard' | 'leaderboard' | 'macro' | 'news' | 'watchlists' | 'longshort' | 'onchain' | 'strategies' | 'trading';

interface TabNavigationProps {
    activeTab: TabType;
    onChange: (tab: TabType) => void;
}

export default function TabNavigation({ activeTab, onChange }: TabNavigationProps) {
    return (
        <nav className={styles.tabNav}>
            <button
                className={`${styles.tabBtn} ${activeTab === 'dashboard' ? styles.active : ''}`}
                onClick={() => onChange('dashboard')}
            >
                📊 数据面板
            </button>
            <button
                className={`${styles.tabBtn} ${activeTab === 'leaderboard' ? styles.active : ''}`}
                onClick={() => onChange('leaderboard')}
            >
                🏆 异动排行榜
            </button>
            <button
                className={`${styles.tabBtn} ${activeTab === 'macro' ? styles.active : ''}`}
                onClick={() => onChange('macro')}
            >
                🌐 宏观视角
            </button>
            <button
                className={`${styles.tabBtn} ${activeTab === 'news' ? styles.active : ''}`}
                onClick={() => onChange('news')}
            >
                🗞️ 每日新闻
            </button>
            <button
                className={`${styles.tabBtn} ${activeTab === 'watchlists' ? styles.active : ''}`}
                onClick={() => onChange('watchlists')}
            >
                🗂️ 自选名单
            </button>
            <button
                className={`${styles.tabBtn} ${activeTab === 'longshort' ? styles.active : ''}`}
                onClick={() => onChange('longshort')}
            >
                📈 多空比
            </button>
            <button
                className={`${styles.tabBtn} ${activeTab === 'onchain' ? styles.active : ''}`}
                onClick={() => onChange('onchain')}
            >
                ⛓️ 链上追踪
            </button>
            <button
                className={`${styles.tabBtn} ${activeTab === 'strategies' ? styles.active : ''}`}
                onClick={() => onChange('strategies')}
            >
                🎯 策略专区
            </button>
            <button
                className={`${styles.tabBtn} ${activeTab === 'trading' ? styles.active : ''}`}
                onClick={() => onChange('trading')}
            >
                💼 模拟交易
            </button>
        </nav>
    );
}
