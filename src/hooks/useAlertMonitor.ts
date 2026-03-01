"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
    const [history, setHistory] = useState<Map<string, { oldest: HistoricalDataPoint; newest: HistoricalDataPoint }>>(new Map());
    const triggeredAlertsRef = useRef<Set<string>>(new Set());
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
                triggeredAlertsRef.current = new Set(parsed);
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

    // Store historical data points (optimized: O(n) with Map)
    useEffect(() => {
        if (data.length === 0) return;

        const now = Date.now();
        const cutoffTime = now - config.timeWindow;

        setHistory(prev => {
            const newMap = new Map(prev);

            data.forEach(ticker => {
                const point: HistoricalDataPoint = {
                    symbol: ticker.symbol,
                    price: parseFloat(ticker.lastPrice),
                    openInterestValue: parseFloat(ticker.openInterestValue || '0'),
                    timestamp: now,
                };

                const existing = newMap.get(ticker.symbol);
                if (!existing) {
                    newMap.set(ticker.symbol, { oldest: point, newest: point });
                } else {
                    // 如果最早的记录过期了，用当前值替代
                    if (existing.oldest.timestamp < cutoffTime) {
                        newMap.set(ticker.symbol, { oldest: point, newest: point });
                    } else {
                        newMap.set(ticker.symbol, { oldest: existing.oldest, newest: point });
                    }
                }
            });

            return newMap;
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

    // Check for alerts (uses ref for triggeredAlerts to avoid stale closures)
    useEffect(() => {
        if (data.length === 0 || history.size === 0) return;

        const now = Date.now();
        const newAlerts: AlertRecord[] = [];
        const triggered = triggeredAlertsRef.current;

        data.forEach(ticker => {
            const symbol = ticker.symbol;
            const currentPrice = parseFloat(ticker.lastPrice);
            const currentOI = parseFloat(ticker.openInterestValue || '0');

            const entry = history.get(symbol);
            if (!entry) return;

            const basePoint = entry.oldest;
            const basePrice = basePoint.price;
            const baseOI = basePoint.openInterestValue;

            // Check price change
            if (config.monitorPrice && basePrice > 0) {
                const priceChange = ((currentPrice - basePrice) / basePrice) * 100;
                const direction: 'up' | 'down' = priceChange >= 0 ? 'up' : 'down';

                if (direction === 'up' || config.monitorDecline) {
                    const priceLevel = getAlertLevel(priceChange);

                    if (priceLevel) {
                        const alertKey = `${symbol}-price-${direction}-${priceLevel}`;
                        if (!triggered.has(alertKey)) {
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
                                baseTimestamp: basePoint.timestamp,
                            });
                            triggered.add(alertKey);
                        }
                    }
                }
            }

            // Check OI change
            if (config.monitorOI && baseOI > 0 && currentOI > 0) {
                const oiChange = ((currentOI - baseOI) / baseOI) * 100;
                const direction: 'up' | 'down' = oiChange >= 0 ? 'up' : 'down';

                if (direction === 'up' || config.monitorDecline) {
                    const oiLevel = getAlertLevel(oiChange);

                    if (oiLevel) {
                        const alertKey = `${symbol}-oi-${direction}-${oiLevel}`;
                        if (!triggered.has(alertKey)) {
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
                                baseTimestamp: basePoint.timestamp,
                            });
                            triggered.add(alertKey);
                        }
                    }
                }
            }
        });

        if (newAlerts.length > 0) {
            setAlerts(prev => [...newAlerts, ...prev].slice(0, 50)); // Cap at 50
            localStorage.setItem(STORAGE_KEYS.TRIGGERED, JSON.stringify([...triggered]));

            if (config.enableSound) {
                playAlertSound();
            }

            if (config.enableNotification) {
                newAlerts.forEach(alert => {
                    if (shouldShowNotification(alert.level, config.notificationMinLevel)) {
                        showBrowserNotification(alert);
                    }
                });
            }
        }
    }, [data, history, config, getAlertLevel]);

    // Clean up old triggered alerts periodically
    useEffect(() => {
        const interval = setInterval(() => {
            triggeredAlertsRef.current = new Set<string>();
            localStorage.setItem(STORAGE_KEYS.TRIGGERED, JSON.stringify([]));
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
