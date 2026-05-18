'use client';

import { useEffect } from 'react';
import { ExternalLink, X } from 'lucide-react';
import {
    buildTradingViewAdvancedChartEmbedUrl,
    buildTradingViewPerpetualSymbol,
} from '@/lib/tradingViewWidget';
import styles from './ChartDrawer.module.css';

interface ChartDrawerProps {
    symbol: string | null;
    onClose: () => void;
}

export default function ChartDrawer({ symbol, onClose }: ChartDrawerProps) {
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

    if (!symbol) return null;

    const tradingViewSymbol = buildTradingViewPerpetualSymbol(symbol);
    const tradingViewUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tradingViewSymbol)}`;
    const pageUri = typeof window === 'undefined'
        ? ''
        : `${window.location.host}${window.location.pathname}`;
    const embedUrl = buildTradingViewAdvancedChartEmbedUrl(symbol, pageUri);

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
                        <a
                            className={styles.iconBtn}
                            href={tradingViewUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="Open chart in TradingView"
                            title="Open chart in TradingView"
                        >
                            <ExternalLink size={18} />
                        </a>
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
                    <iframe
                        key={tradingViewSymbol}
                        className={styles.widget}
                        title={`${tradingViewSymbol} TradingView chart`}
                        src={embedUrl}
                        allowFullScreen
                    />
                </div>
            </div>
        </>
    );
}
