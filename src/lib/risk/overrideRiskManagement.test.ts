import assert from 'node:assert/strict';
import test from 'node:test';

import { applyRiskConfigOverrides } from './overrideRiskManagement.ts';
import type { RiskManagement } from './types.ts';
import type { TickerData } from '../types.ts';

function createBaseRisk(): RiskManagement {
    return {
        stopLoss: {
            price: 95,
            percentage: 5,
            type: 'dynamic',
            reason: '策略结构止损',
        },
        takeProfit: {
            targets: [
                {
                    price: 110,
                    percentage: 10,
                    closePercentage: 100,
                    reason: '策略结构止盈',
                    moveStopToEntry: true,
                },
            ],
            riskRewardRatio: 2,
        },
        positionSizing: {
            percentage: 12,
            leverage: 2,
            maxRiskAmount: 120,
            confidence: 88,
            reasoning: '策略自带仓位',
        },
        metrics: {
            entryPrice: 100,
            riskAmount: 120,
            potentialProfit: 240,
        },
        dynamicExit: {
            enabled: true,
            timeframe: '15m',
            emaPeriod: 20,
            donchianLookback: 20,
            activateAfterTargetIndex: 0,
            invalidationPrice: 96,
            reason: '策略动态退出',
        },
    };
}

function createTicker(): TickerData {
    return {
        symbol: 'TESTUSDT',
        lastPrice: '100',
        priceChange: '0',
        priceChangePercent: '0',
        weightedAvgPrice: '100',
        prevClosePrice: '100',
        highPrice: '105',
        lowPrice: '95',
        volume: '1000',
        quoteVolume: '100000',
        openTime: 0,
        closeTime: 0,
        atr: 1,
    };
}

test('applyRiskConfigOverrides leaves strategy risk untouched when no manual override is supplied', () => {
    const baseRisk = createBaseRisk();
    const result = applyRiskConfigOverrides({
        strategyId: 'wei-shen-ledger',
        baseRisk,
        overrideConfig: null,
        ticker: createTicker(),
        direction: 'long',
    });

    assert.deepEqual(result, baseRisk);
});
