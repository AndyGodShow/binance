"use client";

import BacktestPanel from './BacktestPanel';
import styles from './SimulatedTrading.module.css';
import type { DeepPartial, StrategyParameterConfigMap } from '@/lib/strategyParameters';
import type { Dispatch, SetStateAction } from 'react';

interface SimulatedTradingProps {
    strategyParameterOverrides?: DeepPartial<StrategyParameterConfigMap>;
    onStrategyParameterOverridesChange?: Dispatch<SetStateAction<DeepPartial<StrategyParameterConfigMap>>>;
}

export default function SimulatedTrading({
    strategyParameterOverrides,
    onStrategyParameterOverridesChange,
}: SimulatedTradingProps) {
    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h2 className={styles.title}>📈 模拟交易</h2>
                <p className={styles.subtitle}>零风险交易练习，回测与数据质量能力已经整合到主面板</p>
            </div>

            <div className={styles.content}>
                <BacktestPanel
                    strategyParameterOverrides={strategyParameterOverrides}
                    onStrategyParameterOverridesChange={onStrategyParameterOverridesChange}
                />
            </div>
        </div>
    );
}
