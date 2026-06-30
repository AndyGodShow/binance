'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import {
    buildTradingViewPerpetualSymbol,
    buildTradingViewWidgetEmbedUrl,
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
    const widgetUrl = buildTradingViewWidgetEmbedUrl(symbol);

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
                    <iframe
                        key={tradingViewSymbol}
                        src={widgetUrl.toString()}
                        className={styles.iframe}
                        title={`${tradingViewSymbol} TradingView chart`}
                        allowFullScreen
                    />
                </div>
            </div>
        </>
    );
}
