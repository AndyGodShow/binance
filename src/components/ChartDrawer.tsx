"use client";

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { mountTradingViewAdvancedChart, resetTradingViewWidgetContainer } from '@/lib/tradingViewWidget';
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

    // Load TradingView widget
    useEffect(() => {
        if (!symbol || !containerRef.current) return;

        const container = containerRef.current;
        mountTradingViewAdvancedChart(container, symbol);

        return () => {
            resetTradingViewWidgetContainer(container);
        };
    }, [symbol]);

    if (!symbol) return null;

    return (
        <>
            <div className={styles.overlay} onClick={onClose} />

            <div className={styles.drawer}>
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

                <div className={styles.chartContainer} ref={containerRef} />
            </div>
        </>
    );
}
