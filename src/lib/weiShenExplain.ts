import type { StrategySignalExplain, StrategySignalExplainLayer } from './strategyTypes.ts';
import type { RiskManagement } from './risk/types.ts';
import type { WeiShenSelectedCandidate } from './weiShenEngine.ts';
import type { WeiShenSymbolContext } from './weiShenTypes.ts';

function buildLayer(args: {
    passed: boolean;
    summary: string;
    reasons: string[];
    failedReasons: string[];
}): StrategySignalExplainLayer {
    return {
        passed: args.passed,
        summary: args.summary,
        reasons: args.reasons,
        failedReasons: args.failedReasons,
    };
}

export function buildWeiShenExplain(args: {
    symbolContext: WeiShenSymbolContext;
    selected: WeiShenSelectedCandidate;
    risk: RiskManagement | undefined;
}): StrategySignalExplain {
    const { symbolContext, selected, risk } = args;
    const regime = symbolContext.regime;
    const relativeStrengthDirection = symbolContext.relativeStrength.directional[selected.direction];

    const marketRegime = buildLayer({
        passed: selected.direction === 'long' ? regime.allowLong : regime.allowShort,
        summary: regime.summary,
        reasons: regime.passed,
        failedReasons: regime.failed,
    });

    const relativeStrength = buildLayer({
        passed: relativeStrengthDirection.passed,
        summary: symbolContext.relativeStrength.summary,
        reasons: relativeStrengthDirection.reasons,
        failedReasons: relativeStrengthDirection.failedReasons,
    });

    const entryCheck = buildLayer({
        passed: selected.executionMode === 'trade',
        summary: `${selected.direction === 'long' ? '做多' : '做空'} ${selected.entryType === 'breakout' ? '趋势突破' : '强势回踩'} ${selected.grade}级 ${selected.executionMode === 'trade' ? '可执行' : '观察'}`,
        reasons: selected.passed,
        failedReasons: [...selected.failed, ...selected.blockedReasons],
    });

    const riskPlan = buildLayer({
        passed: Boolean(risk),
        summary: risk
            ? `建议风险 ${selected.suggestedRiskPct}% ，止损 ${selected.stopLossPrice} ，失效 ${selected.invalidationPrice}`
            : '观察信号，不生成执行风控计划',
        reasons: risk
            ? [
                `单笔风险预算 ${selected.suggestedRiskPct}%`,
                `初始止损 ${selected.stopLossPrice}`,
                `结构失效价 ${selected.invalidationPrice}`,
            ]
            : ['C级或被阻断信号仅保留 explain，不执行'],
        failedReasons: risk ? [] : selected.blockedReasons,
    });

    return {
        marketRegime,
        relativeStrength,
        entryCheck,
        riskPlan,
        passed: selected.passed,
        failed: selected.failed,
        blockedReasons: selected.blockedReasons,
        suggestedRiskPct: selected.suggestedRiskPct,
        stopLossPrice: selected.stopLossPrice,
        invalidationPrice: selected.invalidationPrice,
        entryType: selected.entryType,
        grade: selected.grade,
    };
}
