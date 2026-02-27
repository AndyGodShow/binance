"use client";

import styles from './TabNavigation.module.css';

interface TabNavigationProps {
    activeTab: 'dashboard' | 'strategies' | 'trading';
    onChange: (tab: 'dashboard' | 'strategies' | 'trading') => void;
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
