"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
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

const MIN_HISTORY_SAMPLE_MS = 5000;
const MAX_HISTORY_POINTS_PER_SYMBOL = 720;

function pruneHistoryPoints(points: HistoricalDataPoint[], cutoffTime: number): HistoricalDataPoint[] {
    if (points.length === 0) {
        return [];
    }

    let baselineIndex = -1;
    for (let index = points.length - 1; index >= 0; index--) {
        if (points[index].timestamp < cutoffTime) {
            baselineIndex = index;
            break;
        }
    }

    if (baselineIndex >= 0) {
        return points.slice(baselineIndex);
    }

    const firstWithinWindow = points.findIndex((point) => point.timestamp >= cutoffTime);
    if (firstWithinWindow >= 0) {
        return points.slice(firstWithinWindow);
    }

    return [points[points.length - 1]];
}

export function useAlertMonitor(data: TickerData[]) {
    const [alerts, setAlerts] = useState<AlertRecord[]>([]);
    const [config, setConfig] = useState<AlertConfig>(DEFAULT_CONFIG);
    const [history, setHistory] = useState<Map<string, HistoricalDataPoint[]>>(new Map());
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

    const updateConfig = useCallback((newConfig: Partial<AlertConfig>) => {
        setConfig(prev => {
            const updated = { ...prev, ...newConfig };
            try {
                localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(updated));
            } catch (e) {
                console.warn('Failed to persist alert config:', e);
            }
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
            const activeSymbols = new Set(data.map((ticker) => ticker.symbol));

            for (const [symbol, points] of newMap.entries()) {
                const nextPoints = pruneHistoryPoints(points, cutoffTime);
                if (nextPoints.length === 0 && !activeSymbols.has(symbol)) {
                    newMap.delete(symbol);
                    continue;
                }
                newMap.set(symbol, nextPoints);
            }

            data.forEach(ticker => {
                const currentPrice = parseFloat(ticker.lastPrice);
                const currentOI = parseFloat(ticker.openInterestValue || '0');
                const point: HistoricalDataPoint = {
                    symbol: ticker.symbol,
                    price: Number.isFinite(currentPrice) ? currentPrice : 0,
                    openInterestValue: Number.isFinite(currentOI) ? currentOI : 0,
                    timestamp: now,
                };

                const existingPoints = pruneHistoryPoints(newMap.get(ticker.symbol) || [], cutoffTime);
                const lastPoint = existingPoints[existingPoints.length - 1];
                const shouldAppend = !lastPoint ||
                    now - lastPoint.timestamp >= MIN_HISTORY_SAMPLE_MS ||
                    lastPoint.price !== point.price ||
                    lastPoint.openInterestValue !== point.openInterestValue;

                if (shouldAppend) {
                    existingPoints.push(point);
                }

                const overflow = existingPoints.length - MAX_HISTORY_POINTS_PER_SYMBOL;
                if (overflow > 0) {
                    existingPoints.splice(0, overflow);
                }

                newMap.set(ticker.symbol, existingPoints);
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

            const points = history.get(symbol);
            if (!points || points.length === 0) return;

            const basePoint = points[0];
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
            try {
                localStorage.setItem(STORAGE_KEYS.TRIGGERED, JSON.stringify([...triggered]));
            } catch (e) {
                console.warn('Failed to save triggered alerts, possible quota exceeded', e);
            }

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
            try {
                localStorage.setItem(STORAGE_KEYS.TRIGGERED, JSON.stringify([]));
            } catch (e) {
                console.warn('Failed to clear triggered alerts:', e);
            }
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

function playAlertSound() {
    try {
        const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.value = 0.3;
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
    } catch (e) {
        console.error('Failed to play alert sound:', e);
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
