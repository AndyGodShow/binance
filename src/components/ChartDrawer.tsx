'use client';

import { useEffect, useState } from 'react';
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

    // Close on ESC key
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) onClose();
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [isOpen, onClose]);

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
                className={`${styles.drawer} ${isOpen ? styles.drawerOpen : ''}`}
                aria-hidden={!isOpen}
                inert={!isOpen}
            >
                <div className={styles.header}>
                    <div className={styles.title}>
                        <span className="text-yellow">{displaySymbol}</span>
                        <span className={styles.perpBadge}>{isBinancePerpetual ? 'PERP' : 'MARKET'}</span>
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
