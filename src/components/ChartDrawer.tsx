'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import {
    buildTradingViewPerpetualSymbol,
    mountTradingViewAdvancedChart,
    resetTradingViewWidgetContainer,
} from '@/lib/tradingViewWidget';
import styles from './ChartDrawer.module.css';

interface ChartDrawerProps {
    symbol: string | null;
    onClose: () => void;
}

type ChartLoadStatus = 'loading' | 'ready' | 'timeout';

function ChartDrawer({ symbol, onClose }: ChartDrawerProps) {
    const widgetContainerRef = useRef<HTMLDivElement | null>(null);
    const [readyKey, setReadyKey] = useState<string | null>(null);
    const [timeoutKey, setTimeoutKey] = useState<string | null>(null);
    const [reloadNonce, setReloadNonce] = useState(0);
    const chartInstanceKey = `${symbol ?? ''}:${reloadNonce}`;
    const loadStatus: ChartLoadStatus =
        readyKey === chartInstanceKey ? 'ready' : timeoutKey === chartInstanceKey ? 'timeout' : 'loading';

    // Close on ESC key
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    // Prevent body scroll when drawer is open
    useEffect(() => {
        if (symbol) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [symbol]);

    useEffect(() => {
        const container = widgetContainerRef.current;
        if (!symbol || !container) return;

        let completed = false;
        const frame = mountTradingViewAdvancedChart(container, symbol);

        const markReady = () => {
            if (completed) return;
            completed = true;
            setReadyKey(chartInstanceKey);
        };

        const detectRenderedChart = () => {
            try {
                const frameDocument = frame.contentDocument;
                const bodyText = frameDocument?.body?.innerText ?? '';
                if (
                    frameDocument?.querySelector('canvas') ||
                    bodyText.includes('PERPETUAL CONTRACT')
                ) {
                    markReady();
                }
            } catch {
                markReady();
            }
        };

        frame.addEventListener('load', detectRenderedChart);
        const pollTimer = window.setInterval(detectRenderedChart, 1500);
        const timeoutTimer = window.setTimeout(() => {
            if (!completed) setTimeoutKey(chartInstanceKey);
        }, 25000);

        return () => {
            frame.removeEventListener('load', detectRenderedChart);
            window.clearInterval(pollTimer);
            window.clearTimeout(timeoutTimer);
            resetTradingViewWidgetContainer(container);
        };
    }, [symbol, chartInstanceKey]);

    if (!symbol) return null;

    const tradingViewSymbol = buildTradingViewPerpetualSymbol(symbol);

    return (
        <>
            <div className={styles.overlay} onClick={onClose} />

            <div className={styles.drawer}>
                <div className={styles.header}>
                    <div className={styles.title}>
                        <span className="text-yellow">{symbol.replace('USDT', '')}</span>
                        <span className={styles.perpBadge}>PERP</span>
                    </div>
                    <div className={styles.actions}>
                        <button
                            className={styles.iconBtn}
                            onClick={onClose}
                            aria-label="Close chart"
                            title="Close chart"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className={styles.chartContainer}>
                    <div
                        key={tradingViewSymbol}
                        ref={widgetContainerRef}
                        className={styles.widgetHost}
                        aria-label={`${tradingViewSymbol} TradingView chart`}
                    />
                    {loadStatus !== 'ready' && (
                        <div className={styles.chartStatus}>
                            {loadStatus === 'loading' ? (
                                <div className={styles.spinner} aria-label="Loading TradingView chart" />
                            ) : (
                                <button
                                    type="button"
                                    className={styles.retryButton}
                                    onClick={() => setReloadNonce((value) => value + 1)}
                                >
                                    <RefreshCw size={16} />
                                    重新加载 TradingView
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

export default memo(ChartDrawer);
