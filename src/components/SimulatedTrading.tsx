"use client";

import { useState } from 'react';
import DataFetchTest from './DataFetchTest';
import BacktestPanel from './BacktestPanel';
import styles from './SimulatedTrading.module.css';

interface SimulatedTradingProps {
    data?: any[];
}

export default function SimulatedTrading({ data }: SimulatedTradingProps) {
    const [activeSubTab, setActiveSubTab] = useState<'backtest' | 'data-test'>('backtest');

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h2 className={styles.title}>📈 模拟交易</h2>
                <p className={styles.subtitle}>零风险交易练习，实时市场数据</p>
            </div>

            {/* 子标签导航 */}
            <div className={styles.subTabs}>
                <button
                    className={`${styles.subTabBtn} ${activeSubTab === 'backtest' ? styles.active : ''}`}
                    onClick={() => setActiveSubTab('backtest')}
                >
                    🔬 策略回测
                </button>
                <button
                    className={`${styles.subTabBtn} ${activeSubTab === 'data-test' ? styles.active : ''}`}
                    onClick={() => setActiveSubTab('data-test')}
                >
                    📊 数据测试
                </button>
            </div>

            {/* 内容区域 */}
            <div className={styles.content}>
                {activeSubTab === 'backtest' ? (
                    <BacktestPanel />
                ) : (
                    <DataFetchTest />
                )}
            </div>
        </div>
    );
}
