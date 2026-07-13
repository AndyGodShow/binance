"use client";

import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
    buildStrategyParameterCandidates,
    getStrategyParameterConfig,
} from '@/lib/strategyParameters';
import type {
    DeepPartial,
    StrategyId,
    StrategyParameterCandidate,
    StrategyParameterConfigMap,
} from '@/lib/strategyParameters';
import styles from './BacktestPanel.module.css';

interface StrategyParameterPanelProps {
    strategyId: StrategyId;
    overrideValue?: DeepPartial<StrategyParameterConfigMap[StrategyId]>;
    onChange: (value: DeepPartial<StrategyParameterConfigMap[StrategyId]> | undefined) => void;
}

function stripCandidateRanges<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map((item) => stripCandidateRanges(item)) as T;
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== 'candidateRanges')
        .map(([key, nested]) => [key, stripCandidateRanges(nested)]);

    return Object.fromEntries(entries) as T;
}

function stringifyJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
}

function parseOverrideDraft(raw: string): Record<string, unknown> | undefined {
    const trimmed = raw.trim();
    if (!trimmed) {
        return undefined;
    }

    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('参数 override 必须是一个 JSON 对象');
    }

    return parsed as Record<string, unknown>;
}

export default function StrategyParameterPanel({
    strategyId,
    overrideValue,
    onChange,
}: StrategyParameterPanelProps) {
    const [expanded, setExpanded] = useState(false);
    const [draft, setDraft] = useState(() => (overrideValue ? stringifyJson(overrideValue) : ''));
    const [error, setError] = useState<string | null>(null);

    const defaultConfig = useMemo(
        () => stripCandidateRanges(getStrategyParameterConfig(strategyId)),
        [strategyId],
    );
    const candidates = useMemo(
        () => buildStrategyParameterCandidates(strategyId),
        [strategyId],
    );
    const defaultSnapshot = useMemo(
        () => stringifyJson(defaultConfig),
        [defaultConfig],
    );

    const applyDraft = (nextDraft: string) => {
        setDraft(nextDraft);

        try {
            const parsed = parseOverrideDraft(nextDraft);
            onChange(parsed as DeepPartial<StrategyParameterConfigMap[StrategyId]> | undefined);
            setError(null);
        } catch (parseError) {
            setError(parseError instanceof Error ? parseError.message : '参数 JSON 解析失败');
        }
    };

    const applyCandidate = (candidate: StrategyParameterCandidate) => {
        const scopedOverride = candidate.overrides[strategyId] as DeepPartial<StrategyParameterConfigMap[StrategyId]> | undefined;
        const nextDraft = scopedOverride ? stringifyJson(scopedOverride) : '';
        setDraft(nextDraft);
        onChange(scopedOverride);
        setError(null);
    };

    const loadDefaultSnapshot = () => {
        const nextDraft = defaultSnapshot;
        setDraft(nextDraft);
        onChange(defaultConfig as DeepPartial<StrategyParameterConfigMap[StrategyId]>);
        setError(null);
    };

    const clearOverride = () => {
        setDraft('');
        onChange(undefined);
        setError(null);
    };

    return (
        <div className={styles.section}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3>
                    <button
                        type="button"
                        onClick={() => setExpanded(!expanded)}
                        aria-expanded={expanded}
                        aria-controls="strategy-parameter-content"
                        style={sectionToggleStyle}
                    >
                        🧪 策略参数覆盖 {expanded ? '▾' : '▸'}
                    </button>
                </h3>
                {expanded && (
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" onClick={loadDefaultSnapshot} style={smallButtonStyle}>
                            载入默认快照
                        </button>
                        <button type="button" onClick={clearOverride} style={smallButtonStyle}>
                            清空覆盖
                        </button>
                    </div>
                )}
            </div>

            {expanded && (
                <div id="strategy-parameter-content" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
                    <div style={infoBlockStyle}>
                        <div style={infoTitleStyle}>当前默认参数快照</div>
                        <pre style={preStyle}>{defaultSnapshot}</pre>
                    </div>

                    <div style={infoBlockStyle}>
                        <div style={infoTitleStyle}>保守预设</div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {candidates.map((candidate) => (
                                <button
                                    key={candidate.id}
                                    type="button"
                                    onClick={() => applyCandidate(candidate)}
                                    style={smallButtonStyle}
                                >
                                    {candidate.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div style={infoBlockStyle}>
                        <div style={infoTitleStyle}>局部 JSON Override</div>
                        <textarea
                            value={draft}
                            onChange={(event) => applyDraft(event.target.value)}
                            placeholder={'例如：{\n  "cooldownPeriodMs": 7200000\n}'}
                            style={textareaStyle}
                        />
                        <div style={hintStyle}>
                            这里填的是“局部覆盖对象”，不会改默认参数。空白表示使用默认值。
                        </div>
                        {error && <div className={styles.error}>❌ {error}</div>}
                    </div>
                </div>
            )}
        </div>
    );
}

const smallButtonStyle: CSSProperties = {
    background: 'rgba(240, 185, 11, 0.12)',
    border: '1px solid rgba(240, 185, 11, 0.3)',
    color: '#F0B90B',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    cursor: 'pointer',
};

const sectionToggleStyle: CSSProperties = {
    appearance: 'none',
    background: 'none',
    border: 0,
    color: 'inherit',
    cursor: 'pointer',
    font: 'inherit',
    padding: 0,
    textAlign: 'left',
    userSelect: 'none',
};

const infoBlockStyle: CSSProperties = {
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: 12,
    background: 'rgba(255,255,255,0.02)',
};

const infoTitleStyle: CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 8,
};

const preStyle: CSSProperties = {
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontSize: 12,
    lineHeight: 1.5,
    maxHeight: 240,
    overflow: 'auto',
};

const textareaStyle: CSSProperties = {
    width: '100%',
    minHeight: 180,
    resize: 'vertical',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(0,0,0,0.18)',
    color: 'inherit',
    padding: 12,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 12,
    lineHeight: 1.5,
};

const hintStyle: CSSProperties = {
    fontSize: 12,
    opacity: 0.8,
    marginTop: 8,
};
