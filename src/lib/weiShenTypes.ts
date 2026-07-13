import type { SentimentHotspotContext } from './sentimentHotspot.ts';

export type WeiShenSignalGrade = 'A' | 'B' | 'C';
export type WeiShenExecutionMode = 'trade' | 'observe';
export type WeiShenEntryType = 'breakout' | 'pullback';
type WeiShenMarketRegimeState = 'bull-trend' | 'bear-trend' | 'range' | 'risk-off';

export interface WeiShenDirectionalCandidate {
    eligible: boolean;
    grade: WeiShenSignalGrade;
    confidenceScore: number;
    passed: string[];
    failed: string[];
    blockedReasons: string[];
    stopLossPrice: number;
    invalidationPrice: number;
    suggestedRiskPct: number;
}

interface WeiShenDirectionalCandidates {
    long: WeiShenDirectionalCandidate;
    short: WeiShenDirectionalCandidate;
}

export interface WeiShenMarketRegimeContext {
    state: WeiShenMarketRegimeState;
    allowLong: boolean;
    allowShort: boolean;
    onlyAGrade: boolean;
    summary: string;
    passed: string[];
    failed: string[];
}

interface WeiShenRelativeStrengthContext {
    passed: boolean;
    reasons: string[];
    slope1h: number;
    excessReturn4h: number;
    volume24hUsd: number;
    minVolume24hUsd: number;
    minExcessReturn4h: number;
    summary: string;
    passedReasons: string[];
    failedReasons: string[];
    directional: Record<'long' | 'short', {
        passed: boolean;
        reasons: string[];
        failedReasons: string[];
    }>;
}

export interface WeiShenSymbolContext {
    universeAllowed: boolean;
    symbol: string;
    regime: WeiShenMarketRegimeContext;
    relativeStrength: WeiShenRelativeStrengthContext;
    entries: {
        breakout: WeiShenDirectionalCandidates;
        pullback: WeiShenDirectionalCandidates;
    };
}

export interface StrategyTickerContexts {
    weiShen?: WeiShenSymbolContext;
    sentimentHotspot?: SentimentHotspotContext;
}
