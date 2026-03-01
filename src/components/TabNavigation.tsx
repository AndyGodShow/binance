"use client";

import styles from './TabNavigation.module.css';

type TabType = 'dashboard' | 'longshort' | 'strategies' | 'trading';

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
                className={`${styles.tabBtn} ${activeTab === 'longshort' ? styles.active : ''}`}
                onClick={() => onChange('longshort')}
            >
                📈 多空比
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
