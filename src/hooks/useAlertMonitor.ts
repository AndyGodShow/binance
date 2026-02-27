"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import { TickerData, AlertConfig, AlertRecord, AlertLevel, HistoricalDataPoint } from '@/lib/types';

// Alert level thresholds
const ALERT_THRESHOLDS = {
    info: 10,
    warning: 30,
    critical: 50,
} as const;

// Default configuration
const DEFAULT_CONFIG: AlertConfig = {
    enableInfo: true,
    enableWarning: true,
    enableCritical: true,
    timeWindow: 30 * 60 * 1000, // 30 minutes
    enableSound: true,
    enableNotification: false,
    notificationMinLevel: 'warning',
    monitorPrice: true,        // 默认监控价格
    monitorOI: true,           // 默认监控持仓金额
    monitorDecline: true,      // 默认监控跌幅
    enableScheduledAlerts: true, // 默认启用定时推送
};

const STORAGE_KEYS = {
    CONFIG: 'alert_config',
    HISTORY: 'alert_history',
    TRIGGERED: 'alert_triggered',
};

export function useAlertMonitor(data: TickerData[]) {
    const [alerts, setAlerts] = useState<AlertRecord[]>([]);
    const [config, setConfig] = useState<AlertConfig>(DEFAULT_CONFIG);
    const [history, setHistory] = useState<HistoricalDataPoint[]>([]);
    const [triggeredAlerts, setTriggeredAlerts] = useState<Set<string>>(new Set());
    const [isClient, setIsClient] = useState(false);

    // 标记客户端已挂载，避免 Hydration Mismatch
    useEffect(() => {
        setIsClient(true);
    }, []);

    // Load config from localStorage (仅在客户端)
    useEffect(() => {
        if (!isClient) return;
        const stored = localStorage.getItem(STORAGE_KEYS.CONFIG);
        if (stored) {
            try {
                setConfig(JSON.parse(stored));
            } catch (e) {
                console.error('Failed to parse alert config:', e);
            }
        }
    }, [isClient]);

    // Load triggered alerts from localStorage (仅在客户端)
    useEffect(() => {
        if (!isClient) return;
        const stored = localStorage.getItem(STORAGE_KEYS.TRIGGERED);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                setTriggeredAlerts(new Set(parsed));
            } catch (e) {
                console.error('Failed to parse triggered alerts:', e);
            }
        }
    }, [isClient]);

    // Save config to localStorage
    const updateConfig = useCallback((newConfig: Partial<AlertConfig>) => {
        setConfig(prev => {
            const updated = { ...prev, ...newConfig };
            localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(updated));
            return updated;
        });
    }, []);

    // Store historical data points
    useEffect(() => {
        if (data.length === 0) return;

        const now = Date.now();
        const cutoffTime = now - config.timeWindow;

        setHistory(prev => {
            // Add new data points
            const newPoints: HistoricalDataPoint[] = data.map(ticker => ({
                symbol: ticker.symbol,
                price: parseFloat(ticker.lastPrice),
                openInterestValue: parseFloat(ticker.openInterestValue || '0'),
                timestamp: now,
            }));

            // Merge with previous, remove old entries
            const merged = [...prev, ...newPoints];
            const filtered = merged.filter(point => point.timestamp > cutoffTime);

            // Keep only the oldest and newest for each symbol within the window
            const symbolMap = new Map<string, HistoricalDataPoint[]>();
            filtered.forEach(point => {
                if (!symbolMap.has(point.symbol)) {
                    symbolMap.set(point.symbol, []);
                }
                symbolMap.get(point.symbol)!.push(point);
            });

            const optimized: HistoricalDataPoint[] = [];
            symbolMap.forEach((points, symbol) => {
                if (points.length <= 2) {
                    optimized.push(...points);
                } else {
                    // Keep oldest and newest
                    const sorted = points.sort((a, b) => a.timestamp - b.timestamp);
                    optimized.push(sorted[0], sorted[sorted.length - 1]);
                }
            });

            return optimized;
        });
    }, [data, config.timeWindow]);

    // Determine alert level based on change percent (use absolute value)
    const getAlertLevel = useCallback((changePercent: number): AlertLevel | null => {
        const absChange = Math.abs(changePercent);
        if (absChange >= ALERT_THRESHOLDS.critical && config.enableCritical) {
            return 'critical';
        }
        if (absChange >= ALERT_THRESHOLDS.warning && config.enableWarning) {
            return 'warning';
        }
        if (absChange >= ALERT_THRESHOLDS.info && config.enableInfo) {
            return 'info';
        }
        return null;
    }, [config.enableInfo, config.enableWarning, config.enableCritical]);

    // Check for alerts
    useEffect(() => {
        if (data.length === 0 || history.length === 0) return;

        const now = Date.now();
        const cutoffTime = now - config.timeWindow;
        const newAlerts: AlertRecord[] = [];

        data.forEach(ticker => {
            const symbol = ticker.symbol;
            const currentPrice = parseFloat(ticker.lastPrice);
            const currentOI = parseFloat(ticker.openInterestValue || '0');

            // Find the oldest historical point for this symbol within time window
            const symbolHistory = history
                .filter(h => h.symbol === symbol && h.timestamp > cutoffTime)
                .sort((a, b) => a.timestamp - b.timestamp);

            if (symbolHistory.length === 0) return;

            const basePoint = symbolHistory[0];
            const basePrice = basePoint.price;
            const baseOI = basePoint.openInterestValue;

            // Check price change
            if (config.monitorPrice && basePrice > 0) {
                const priceChange = ((currentPrice - basePrice) / basePrice) * 100;
                const direction: 'up' | 'down' = priceChange >= 0 ? 'up' : 'down';

                // 只有在启用跌幅监控或者是涨幅时才处理
                if (direction === 'up' || config.monitorDecline) {
                    const priceLevel = getAlertLevel(priceChange);

                    if (priceLevel) {
                        const alertKey = `${symbol}-price-${direction}-${priceLevel}`;
                        if (!triggeredAlerts.has(alertKey)) {
                            newAlerts.push({
                                id: `${alertKey}-${now}`,
                                symbol,
                                type: 'price',
                                level: priceLevel,
                                changePercent: priceChange,
                                direction,
                                timestamp: now,
                                baseValue: basePrice,
                                currentValue: currentPrice,
                                baseTimestamp: basePoint.timestamp, // 记录基准时间
                            });
                            triggeredAlerts.add(alertKey);
                        }
                    }
                }
            }

            // Check OI change
            if (config.monitorOI && baseOI > 0 && currentOI > 0) {
                const oiChange = ((currentOI - baseOI) / baseOI) * 100;
                const direction: 'up' | 'down' = oiChange >= 0 ? 'up' : 'down';

                // 只有在启用跌幅监控或者是涨幅时才处理
                if (direction === 'up' || config.monitorDecline) {
                    const oiLevel = getAlertLevel(oiChange);

                    if (oiLevel) {
                        const alertKey = `${symbol}-oi-${direction}-${oiLevel}`;
                        if (!triggeredAlerts.has(alertKey)) {
                            newAlerts.push({
                                id: `${alertKey}-${now}`,
                                symbol,
                                type: 'oi',
                                level: oiLevel,
                                changePercent: oiChange,
                                direction,
                                timestamp: now,
                                baseValue: baseOI,
                                currentValue: currentOI,
                                baseTimestamp: basePoint.timestamp, // 记录基准时间
                            });
                            triggeredAlerts.add(alertKey);
                        }
                    }
                }
            }
        });

        if (newAlerts.length > 0) {
            setAlerts(prev => [...newAlerts, ...prev]);
            localStorage.setItem(STORAGE_KEYS.TRIGGERED, JSON.stringify([...triggeredAlerts]));

            // Play sound if enabled
            if (config.enableSound) {
                playAlertSound();
            }

            // Show browser notification if enabled
            if (config.enableNotification) {
                newAlerts.forEach(alert => {
                    if (shouldShowNotification(alert.level, config.notificationMinLevel)) {
                        showBrowserNotification(alert);
                    }
                });
            }
        }
    }, [data, history, config, triggeredAlerts, getAlertLevel]);

    // Clean up old triggered alerts periodically
    useEffect(() => {
        const interval = setInterval(() => {
            setTriggeredAlerts(prev => {
                const newSet = new Set<string>();
                localStorage.setItem(STORAGE_KEYS.TRIGGERED, JSON.stringify([...newSet]));
                return newSet;
            });
        }, config.timeWindow);

        return () => clearInterval(interval);
    }, [config.timeWindow]);

    // Remove alert
    const dismissAlert = useCallback((id: string) => {
        setAlerts(prev => prev.filter(a => a.id !== id));
    }, []);

    // Clear all alerts
    const clearAllAlerts = useCallback(() => {
        setAlerts([]);
    }, []);

    return {
        alerts,
        config,
        updateConfig,
        dismissAlert,
        clearAllAlerts,
    };
}

// Helper: Check if notification should be shown based on level
function shouldShowNotification(alertLevel: AlertLevel, minLevel: AlertLevel): boolean {
    const levelPriority = { info: 0, warning: 1, critical: 2 };
    return levelPriority[alertLevel] >= levelPriority[minLevel];
}

// Helper: Play alert sound
function playAlertSound() {
    try {
        const audio = new Audio('/alert.mp3');
        audio.volume = 0.5;
        audio.play().catch(e => console.error('Failed to play alert sound:', e));
    } catch (e) {
        console.error('Failed to create audio:', e);
    }
}

// Helper: Show browser notification
function showBrowserNotification(alert: AlertRecord) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const typeText = alert.type === 'price' ? '价格' : '持仓金额';
    const directionText = alert.direction === 'up' ? '异动' : '暴跌';
    const levelEmoji = alert.level === 'critical' ? '🔴' : alert.level === 'warning' ? '🟡' : '🔵';
    const sign = alert.direction === 'up' ? '+' : '';

    new Notification(`${levelEmoji} ${alert.symbol} ${typeText}${directionText}`, {
        body: `${typeText}变化: ${sign}${alert.changePercent.toFixed(2)}%`,
        icon: '/favicon.ico',
        tag: alert.id,
    });
}
