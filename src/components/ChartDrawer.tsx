"use client";

import { useEffect } from 'react';
import { X } from 'lucide-react';
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

    // Convert symbol format: "BTCUSDT" -> "BINANCE:BTCUSDT.P"
    const tradingViewSymbol = `BINANCE:${symbol.replace('USDT', '')}USDT.P`;

    // Build TradingView widget URL using the embeddable domain
    const widgetUrl = new URL('https://s.tradingview.com/widgetembed/');
    widgetUrl.searchParams.set('frameElementId', 'tradingview_chart');
    widgetUrl.searchParams.set('symbol', tradingViewSymbol);
    widgetUrl.searchParams.set('interval', '15'); // 15 minutes
    widgetUrl.searchParams.set('theme', 'dark');
    widgetUrl.searchParams.set('style', '1'); // Candle style
    widgetUrl.searchParams.set('timezone', 'Asia/Shanghai');
    widgetUrl.searchParams.set('withdateranges', 'true');
    widgetUrl.searchParams.set('hide_side_toolbar', 'true');
    widgetUrl.searchParams.set('allow_symbol_change', 'false');
    widgetUrl.searchParams.set('save_image', 'false');
    widgetUrl.searchParams.set('locale', 'zh_CN');

    return (
        <>
            {/* Overlay */}
            <div
                className={styles.overlay}
                onClick={onClose}
            />

            {/* Drawer */}
            <div className={styles.drawer}>
                {/* Header */}
                <div className={styles.header}>
                    <div className={styles.title}>
                        <span className="text-yellow">{symbol.replace('USDT', '')}</span>
                        <span className={styles.perpBadge}>PERP</span>
                    </div>
                    <button
                        className={styles.closeBtn}
                        onClick={onClose}
                        aria-label="Close chart"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* TradingView Chart */}
                <div className={styles.chartContainer}>
                    <iframe
                        src={widgetUrl.toString()}
                        className={styles.iframe}
                        frameBorder="0"
                        allowTransparency
                        scrolling="no"
                        title={`${symbol} Chart`}
                    />
                </div>
            </div>
        </>
    );
}
