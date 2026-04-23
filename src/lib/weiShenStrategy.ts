import { buildWeiShenSymbolContext } from './weiShenEngine.ts';
import {
    getStrategyParameterConfig,
    type DeepPartial,
    type StrategyParameterConfigMap,
    type WeiShenLedgerParameters,
} from './strategyParameters.ts';

export const WEI_SHEN_STRATEGY_ID = 'wei-shen-ledger' as const;

export interface WeiShenTimeframes {
    signalInterval: string;
    confirmInterval: string;
    dailyFilterInterval: string;
    executionInterval: string;
}

export interface WeiShenBtcContextRequirement {
    symbol: 'BTCUSDT';
    interval: string;
    role: 'btc-market-signal' | 'btc-market-confirm' | 'btc-market-daily';
}

export function isWeiShenStrategy(strategyId: string): strategyId is typeof WEI_SHEN_STRATEGY_ID {
    return strategyId === WEI_SHEN_STRATEGY_ID;
}

export function getWeiShenParameters(
    parameterOverrides?: DeepPartial<StrategyParameterConfigMap>,
): WeiShenLedgerParameters {
    return getStrategyParameterConfig(WEI_SHEN_STRATEGY_ID, parameterOverrides?.[WEI_SHEN_STRATEGY_ID]);
}

export function getWeiShenTimeframes(
    parameterOverrides?: DeepPartial<StrategyParameterConfigMap>,
): WeiShenTimeframes {
    return getWeiShenParameters(parameterOverrides).timeframes;
}

export function resolveStrategyIntervalsWithOverrides(args: {
    strategyId: string;
    signalInterval: string;
    executionInterval: string;
    parameterOverrides?: DeepPartial<StrategyParameterConfigMap>;
}) {
    if (!isWeiShenStrategy(args.strategyId)) {
        return {
            signalInterval: args.signalInterval,
            executionInterval: args.executionInterval,
        };
    }

    const timeframes = getWeiShenTimeframes(args.parameterOverrides);
    return {
        signalInterval: timeframes.signalInterval,
        executionInterval: timeframes.executionInterval,
    };
}

export function getWeiShenBtcContextRequirements(
    symbol: string,
    parameterOverrides?: DeepPartial<StrategyParameterConfigMap>,
): WeiShenBtcContextRequirement[] {
    if (symbol === 'BTCUSDT') {
        return [];
    }

    const timeframes = getWeiShenTimeframes(parameterOverrides);
    return [
        { symbol: 'BTCUSDT', interval: timeframes.signalInterval, role: 'btc-market-signal' },
        { symbol: 'BTCUSDT', interval: timeframes.confirmInterval, role: 'btc-market-confirm' },
        { symbol: 'BTCUSDT', interval: timeframes.dailyFilterInterval, role: 'btc-market-daily' },
    ];
}

export function buildWeiShenContext(args: {
    symbol: string;
    signal1h: Parameters<typeof buildWeiShenSymbolContext>[0]['signal1h'];
    confirm4h: Parameters<typeof buildWeiShenSymbolContext>[0]['confirm4h'];
    daily1d: Parameters<typeof buildWeiShenSymbolContext>[0]['daily1d'];
    btc1h: Parameters<typeof buildWeiShenSymbolContext>[0]['btc1h'];
    btc4h: Parameters<typeof buildWeiShenSymbolContext>[0]['btc4h'];
    btc1d: Parameters<typeof buildWeiShenSymbolContext>[0]['btc1d'];
    fallbackQuoteVolume24hUsd?: number;
    parameterOverrides?: DeepPartial<StrategyParameterConfigMap>;
}) {
    return buildWeiShenSymbolContext({
        symbol: args.symbol,
        signal1h: args.signal1h,
        confirm4h: args.confirm4h,
        daily1d: args.daily1d,
        btc1h: args.btc1h,
        btc4h: args.btc4h,
        btc1d: args.btc1d,
        fallbackQuoteVolume24hUsd: args.fallbackQuoteVolume24hUsd,
        params: getWeiShenParameters(args.parameterOverrides),
    });
}
