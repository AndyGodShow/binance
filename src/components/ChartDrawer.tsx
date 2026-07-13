'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
    buildTradingViewSymbol,
    buildTradingViewWidgetEmbedUrl,
} from '@/lib/tradingViewWidget';
import styles from './ChartDrawer.module.css';

interface ChartDrawerProps {
    symbol: string | null;
    isOpen: boolean;
    onClose: () => void;
}

export default function ChartDrawer({ symbol, isOpen, onClose }: ChartDrawerProps) {
    const [loadedSymbol, setLoadedSymbol] = useState<string | null>(null);
    const drawerRef = useRef<HTMLDivElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!isOpen) return;

        const previouslyFocused = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        closeButtonRef.current?.focus();

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current();
                return;
            }

            if (event.key !== 'Tab') return;

            const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
                'button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])',
            );
            if (!focusable?.length) {
                event.preventDefault();
                drawerRef.current?.focus();
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            previouslyFocused?.focus();
        };
    }, [isOpen]);

    // Prevent body scroll when drawer is open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    if (!symbol) return null;

    const tradingViewSymbol = buildTradingViewSymbol(symbol);
    const widgetUrl = buildTradingViewWidgetEmbedUrl(symbol);
    const isChartLoaded = loadedSymbol === tradingViewSymbol;
    const isBinancePerpetual = tradingViewSymbol.startsWith('BINANCE:') && tradingViewSymbol.endsWith('.P');
    const displaySymbol = isBinancePerpetual
        ? tradingViewSymbol.slice('BINANCE:'.length, -'.P'.length).replace(/USDT$/, '')
        : tradingViewSymbol.split(':').at(-1);

    return (
        <>
            <div
                className={`${styles.overlay} ${isOpen ? styles.overlayOpen : ''}`}
                onClick={onClose}
                aria-hidden={!isOpen}
            />

            <div
                ref={drawerRef}
                className={`${styles.drawer} ${isOpen ? styles.drawerOpen : ''}`}
                role="dialog"
                aria-modal={isOpen}
                aria-labelledby="chart-drawer-title"
                aria-hidden={!isOpen}
                inert={!isOpen}
                tabIndex={-1}
            >
                <div className={styles.header}>
                    <div id="chart-drawer-title" className={styles.title}>
                        <span className="text-yellow">{displaySymbol}</span>
                        <span className={styles.perpBadge}>{isBinancePerpetual ? 'PERP' : 'MARKET'}</span>
                    </div>
                    <div className={styles.actions}>
                        <button
                            ref={closeButtonRef}
                            className={styles.iconBtn}
                            onClick={onClose}
                            aria-label="关闭 K 线图"
                            title="关闭 K 线图"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className={styles.chartContainer}>
                    {!isChartLoaded && (
                        <div className={styles.loadingState} role="status">
                            <span className={styles.loadingSpinner} aria-hidden="true" />
                            正在加载 K 线…
                        </div>
                    )}
                    <iframe
                        key={tradingViewSymbol}
                        src={widgetUrl.toString()}
                        className={styles.iframe}
                        title={`${tradingViewSymbol} TradingView chart`}
                        allowFullScreen
                        onLoad={() => setLoadedSymbol(tradingViewSymbol)}
                    />
                </div>
            </div>
        </>
    );
}
