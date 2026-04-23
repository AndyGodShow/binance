import type {
    CompositeCondition,
    StrategyDetectionContext,
    StrategySignalExplain,
    StrategySignal,
    TradingStrategy,
} from '../lib/strategyTypes.ts';
import type { TickerData } from '../lib/types.ts';
import { logger } from '../lib/logger.ts';
import { getStrategyParameterConfig } from '../lib/strategyParameters.ts';
import {
    buildWeiShenRiskManagement,
    selectWeiShenCandidate,
} from '../lib/weiShenEngine.ts';
import { buildWeiShenExplain } from '../lib/weiShenExplain.ts';
import { WEI_SHEN_UNIVERSE } from '../lib/weiShenUniverse.ts';
import {
    type WeiShenStrategyInput,
    toWeiShenStrategyInput,
} from '../lib/strategyInputs.ts';

function buildConditions(
    explain: StrategySignalExplain,
): CompositeCondition[] {
    const layers = [
        { name: 'market-regime', layer: explain.marketRegime },
        { name: 'relative-strength', layer: explain.relativeStrength },
        { name: 'entry-check', layer: explain.entryCheck },
        { name: 'risk-plan', layer: explain.riskPlan },
    ] as const;

    const conditions: CompositeCondition[] = [];

    layers.forEach(({ name, layer }) => {
        conditions.push({
            name,
            met: layer.passed,
            description: layer.summary,
        });

        layer.reasons.forEach((description, index) => {
            conditions.push({
                name: `${name}-passed-${index}`,
                met: true,
                description,
            });
        });

        layer.failedReasons.forEach((description, index) => {
            conditions.push({
                name: `${name}-failed-${index}`,
                met: false,
                description,
            });
        });
    });

    explain.blockedReasons.forEach((description, index) => {
        conditions.push({
            name: `blocked-${index}`,
            met: false,
            description,
        });
    });

    return conditions;
}

function buildReason(signal: {
    symbol: string;
    direction: 'long' | 'short';
    entryType: 'breakout' | 'pullback';
    grade: 'A' | 'B' | 'C';
    executionMode: 'trade' | 'observe';
    marketRegime: string;
}) {
    const cleanSymbol = signal.symbol.replace('USDT', '');
    const directionText = signal.direction === 'long' ? '顺势做多' : '顺势做空';
    const entryText = signal.entryType === 'breakout' ? '趋势突破' : '强势回踩';
    const modeText = signal.executionMode === 'trade' ? '可执行' : '仅观察';

    return `${cleanSymbol} ${directionText} ${entryText} ${signal.grade}级信号，${modeText}，${signal.marketRegime}`;
}

function buildStrategySignal(
    input: WeiShenStrategyInput,
    context: StrategyDetectionContext | undefined,
): StrategySignal | null {
    if (!WEI_SHEN_UNIVERSE.includes(input.symbol as (typeof WEI_SHEN_UNIVERSE)[number])) {
        return null;
    }

    const params = getStrategyParameterConfig('wei-shen-ledger', context?.parameterOverrides?.['wei-shen-ledger']);
    const symbolContext = input.strategyContexts?.weiShen;
    if (!symbolContext) {
        return null;
    }

    if (symbolContext.regime.state === 'risk-off') {
        return null;
    }

    const entryPrice = Number.parseFloat(input.lastPrice);
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
        return null;
    }

    const selected = selectWeiShenCandidate({
        symbolContext,
        entryPrice,
        portfolioState: context?.portfolioState,
        params,
    });
    if (!selected) {
        return null;
    }

    const risk = selected.executionMode === 'trade'
        ? buildWeiShenRiskManagement({
            symbol: input.symbol,
            entryPrice,
            direction: selected.direction,
            confidence: selected.confidence,
            stopLossPrice: selected.stopLossPrice,
            invalidationPrice: selected.invalidationPrice,
            suggestedRiskPct: selected.suggestedRiskPct,
            entryType: selected.entryType,
            params,
        })
        : undefined;

    const explain = buildWeiShenExplain({
        symbolContext,
        selected,
        risk,
    });

    const conditions = buildConditions(explain);

    const signal: StrategySignal = {
        symbol: input.symbol,
        strategyId: 'wei-shen-ledger',
        strategyName: '魏神策略',
        direction: selected.direction,
        confidence: selected.confidence,
        reason: buildReason({
            symbol: input.symbol,
            direction: selected.direction,
            entryType: selected.entryType,
            grade: selected.grade,
            executionMode: selected.executionMode,
            marketRegime: explain.marketRegime.summary,
        }),
        metrics: {
            suggestedRiskPct: selected.suggestedRiskPct,
            stopLossPrice: selected.stopLossPrice,
            invalidationPrice: selected.invalidationPrice,
            relativeStrengthSlope1h: symbolContext.relativeStrength.slope1h,
            excessReturn4h: symbolContext.relativeStrength.excessReturn4h,
            relativeStrengthVolume24hUsd: symbolContext.relativeStrength.volume24hUsd,
        },
        timestamp: context?.now ?? input.closeTime ?? Date.now(),
        price: entryPrice,
        isComposite: true,
        conditions,
        conditionsMet: conditions.filter((condition) => condition.met).length,
        totalConditions: conditions.length,
        risk,
        grade: selected.grade,
        executionMode: selected.executionMode,
        entryType: selected.entryType,
        explain,
    };

    logger.info('WeiShen structured signal emitted', {
        symbol: input.symbol,
        direction: signal.direction,
        grade: signal.grade,
        executionMode: signal.executionMode,
        entryType: signal.entryType,
        explain: signal.explain,
    });

    return signal;
}

export const weiShenStrategy: TradingStrategy = {
    id: 'wei-shen-ledger',
    name: '魏神策略',
    description: 'BTC 主导的规则化趋势框架：市场状态 + 相对强弱 + 突破/回踩 + 风控优先',
    category: 'special',
    enabled: true,
    detect: (ticker: TickerData, context?: StrategyDetectionContext) => buildStrategySignal(toWeiShenStrategyInput(ticker), context),
};
