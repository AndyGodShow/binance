"use client";

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import styles from './ChartDrawer.module.css';

interface ChartDrawerProps {
    symbol: string | null;
    onClose: () => void;
}

export default function ChartDrawer({ symbol, onClose }: ChartDrawerProps) {
    const containerRef = useRef<HTMLDivElement>(null);

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

    // Load TradingView widget using official script API
    useEffect(() => {
        if (!symbol || !containerRef.current) return;

        // Clear previous widget
        const container = containerRef.current;
        container.innerHTML = '';

        // TradingView symbol format for Binance USDT perpetual futures
        // Use BINANCE:BTCUSDT.P format (the .P suffix indicates perpetual)
        const tvSymbol = `BINANCE:${symbol}.P`;

        // Create the TradingView widget container
        const widgetContainer = document.createElement('div');
        widgetContainer.className = 'tradingview-widget-container';
        widgetContainer.style.height = '100%';
        widgetContainer.style.width = '100%';

        const widgetInner = document.createElement('div');
        widgetInner.className = 'tradingview-widget-container__widget';
        widgetInner.style.height = 'calc(100% - 32px)';
        widgetInner.style.width = '100%';
        widgetContainer.appendChild(widgetInner);

        container.appendChild(widgetContainer);

        // Create and load the TradingView Advanced Chart Widget script
        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
        script.async = true;
        script.innerHTML = JSON.stringify({
            autosize: true,
            symbol: tvSymbol,
            interval: "15",
            timezone: "Asia/Shanghai",
            theme: "dark",
            style: "1",
            locale: "zh_CN",
            allow_symbol_change: false,
            save_image: false,
            hide_side_toolbar: false,
            calendar: false,
            hide_volume: false,
            support_host: "https://www.tradingview.com",
        });

        widgetContainer.appendChild(script);

        return () => {
            // Cleanup
            container.innerHTML = '';
        };
    }, [symbol]);

    if (!symbol) return null;

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
                <div className={styles.chartContainer} ref={containerRef} />
            </div>
        </>
    );
}
