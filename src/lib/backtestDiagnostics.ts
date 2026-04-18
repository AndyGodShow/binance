import type { DataQualityMetrics } from './dataQuality.ts';

export interface BacktestDiagnosticCheck {
    key: string;
    label: string;
    status: 'pass' | 'warn' | 'fail';
    detail: string;
}

export interface BacktestDiagnostics {
    confidence: 'high' | 'medium' | 'low';
    summary: string;
    warnings: string[];
    checks: BacktestDiagnosticCheck[];
}

interface StrategyDependencyProfile {
    multiTimeframe: boolean;
    openInterest: boolean;
}

interface BacktestDiagnosticsInput {
    strategyId: string;
    interval: string;
    executionInterval: string;
    requestedDays: number;
    dataQuality: DataQualityMetrics;
    hasHistoricalMultiTimeframe: boolean;
}

const STRATEGY_DEPENDENCIES: Record<string, StrategyDependencyProfile> = {
    'strong-breakout': { multiTimeframe: true, openInterest: true },
    'trend-confirmation': { multiTimeframe: true, openInterest: true },
    'capital-inflow': { multiTimeframe: true, openInterest: false },
    'rsrs-trend': { multiTimeframe: true, openInterest: false },
    'volatility-squeeze': { multiTimeframe: false, openInterest: false },
};

function getDependencyProfile(strategyId: string): StrategyDependencyProfile {
    return STRATEGY_DEPENDENCIES[strategyId] || {
        multiTimeframe: false,
        openInterest: false,
    };
}

function intervalToMs(interval: string): number {
    const match = interval.match(/^(\d+)(m|h|d|w|M)$/);
    if (!match) {
        return 0;
    }

    const value = Number.parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
        case 'm':
            return value * 60 * 1000;
        case 'h':
            return value * 60 * 60 * 1000;
        case 'd':
            return value * 24 * 60 * 60 * 1000;
        case 'w':
            return value * 7 * 24 * 60 * 60 * 1000;
        case 'M':
            return value * 30 * 24 * 60 * 60 * 1000;
        default:
            return 0;
    }
}

export function buildBacktestDiagnostics(input: BacktestDiagnosticsInput): BacktestDiagnostics {
    const profile = getDependencyProfile(input.strategyId);
    const checks: BacktestDiagnosticCheck[] = [];

    if (profile.multiTimeframe) {
        checks.push({
            key: 'multiframe',
            label: '多周期历史对齐',
            status: input.hasHistoricalMultiTimeframe ? 'pass' : 'fail',
            detail: input.hasHistoricalMultiTimeframe
                ? '本次回测已使用真实 5m / 15m / 1h / 4h / 1d 历史数据按时间对齐。'
                : '当前策略依赖多周期字段，但本次未启用真实多周期历史对齐，结果会失真。',
        });
    } else {
        checks.push({
            key: 'multiframe',
            label: '多周期历史对齐',
            status: 'pass',
            detail: '当前策略不依赖额外多周期价格字段。',
        });
    }

    if (profile.openInterest) {
        let status: 'pass' | 'warn' | 'fail' = 'pass';
        if (input.dataQuality.oiExactCoverage < 30) {
            status = 'fail';
        } else if (input.dataQuality.oiExactCoverage < 60) {
            status = 'warn';
        }

        checks.push({
            key: 'open-interest',
            label: '持仓量覆盖',
            status,
            detail:
                status === 'pass'
                    ? `本次回测的 OI 可用覆盖率为 ${input.dataQuality.oiCoverage.toFixed(1)}%，其中精确命中覆盖率为 ${input.dataQuality.oiExactCoverage.toFixed(1)}%，足够支撑该策略。`
                    : status === 'warn'
                        ? `本次回测的 OI 可用覆盖率为 ${input.dataQuality.oiCoverage.toFixed(1)}%，但精确命中覆盖率仅 ${input.dataQuality.oiExactCoverage.toFixed(1)}%，策略可跑，OI 过滤可信度一般。`
                        : `本次回测的 OI 精确命中覆盖率仅 ${input.dataQuality.oiExactCoverage.toFixed(1)}%，依赖 OI 的策略结果不宜直接采信。`,
        });
    }

    let fundingStatus: 'pass' | 'warn' | 'fail' = 'pass';
    if (input.dataQuality.fundingExactCoverage < 15) {
        fundingStatus = 'fail';
    } else if (input.dataQuality.fundingExactCoverage < 40) {
        fundingStatus = 'warn';
    }

    checks.push({
        key: 'funding-rate',
        label: '资金费率覆盖',
        status: fundingStatus,
        detail:
            fundingStatus === 'pass'
                ? `资金费率可用覆盖率为 ${input.dataQuality.fundingCoverage.toFixed(1)}%，精确命中覆盖率为 ${input.dataQuality.fundingExactCoverage.toFixed(1)}%。`
                : fundingStatus === 'warn'
                    ? `资金费率精确命中覆盖率为 ${input.dataQuality.fundingExactCoverage.toFixed(1)}%，较多 K 线使用了前向填充值。`
                    : `资金费率精确命中覆盖率仅 ${input.dataQuality.fundingExactCoverage.toFixed(1)}%，相关过滤条件基本只能做粗参考。`,
    });

    checks.push({
        key: 'lookahead-guard',
        label: '前视偏差防护',
        status: 'pass',
        detail: '信号按已完成 K 线收盘计算，回测已隔离实时冷却状态，也避免同一根 K 线平仓后立刻反手。',
    });

    const signalIntervalMs = intervalToMs(input.interval);
    const executionIntervalMs = intervalToMs(input.executionInterval);
    const usesLowerExecution = executionIntervalMs > 0 && signalIntervalMs > 0 && executionIntervalMs < signalIntervalMs;

    checks.push({
        key: 'execution-model',
        label: '成交仿真精度',
        status: usesLowerExecution ? 'pass' : 'warn',
        detail: usesLowerExecution
            ? `当前使用 ${input.interval} 出信号、${input.executionInterval} 执行开平仓与风控，已显著降低单根 K 线内路径歧义；同根 K 线内的止损收紧会延后到下一根生效，按更保守的顺序处理。`
            : '当前仍按信号周期 K 线直接执行，同根 K 线内冲突按保守规则处理，但结果仍会比细粒度执行更粗。',
    });

    if (input.requestedDays > 30 && input.dataQuality.dataQualityScore < 60) {
        checks.push({
            key: 'long-range-quality',
            label: '长周期数据质量',
            status: 'warn',
            detail: `当前回测区间约 ${input.requestedDays.toFixed(0)} 天，但综合数据质量仅 ${input.dataQuality.dataQualityScore.toFixed(1)} 分，补齐 OI / 资金费率后应再跑一次。`,
        });
    }

    const warnings = checks
        .filter((check) => check.status !== 'pass')
        .map((check) => `${check.label}：${check.detail}`);

    let confidence: 'high' | 'medium' | 'low' = 'high';
    if (checks.some((check) => check.status === 'fail')) {
        confidence = 'low';
    } else if (checks.some((check) => check.status === 'warn')) {
        confidence = 'medium';
    }

    const summary =
        confidence === 'high'
            ? '本次回测关键输入完整，结果可作为主要参考。'
            : confidence === 'medium'
                ? '本次回测可参考，但有降级项，解读结果时要结合下面的提示。'
                : '本次回测存在明显降级项，只适合做粗筛，不建议直接拿结果下结论。';

    return {
        confidence,
        summary,
        warnings,
        checks,
    };
}
