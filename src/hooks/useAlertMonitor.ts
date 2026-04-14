"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { TickerData, AlertConfig, AlertRecord, AlertLevel, HistoricalDataPoint } from '@/lib/types';

const ALERT_THRESHOLDS = {
    info: 10,
    warning: 30,
    critical: 50,
} as const;

const DEFAULT_CONFIG: AlertConfig = {
    enableInfo: true,
    enableWarning: true,
    enableCritical: true,
    timeWindow: 30 * 60 * 1000,
    enableSound: true,
    enableNotification: false,
    notificationMinLevel: 'warning',
    monitorPrice: true,
    monitorOI: true,
    monitorDecline: true,
    enableScheduledAlerts: true,
};

const STORAGE_KEYS = {
    CONFIG: 'alert_config',
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

function readStoredConfig(): AlertConfig {
    if (typeof window === 'undefined') {
        return DEFAULT_CONFIG;
    }

    const stored = window.localStorage.getItem(STORAGE_KEYS.CONFIG);
    if (!stored) {
        return DEFAULT_CONFIG;
    }

    try {
        return { ...DEFAULT_CONFIG, ...JSON.parse(stored) as Partial<AlertConfig> };
    } catch (error) {
        console.error('Failed to parse alert config:', error);
        return DEFAULT_CONFIG;
    }
}

function readTriggeredAlerts(): Set<string> {
    if (typeof window === 'undefined') {
        return new Set<string>();
    }

    const stored = window.localStorage.getItem(STORAGE_KEYS.TRIGGERED);
    if (!stored) {
        return new Set<string>();
    }

    try {
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? new Set(parsed.filter((item): item is string => typeof item === 'string')) : new Set<string>();
    } catch (error) {
        console.error('Failed to parse triggered alerts:', error);
        return new Set<string>();
    }
}

function scheduleStateUpdate(callback: () => void) {
    queueMicrotask(callback);
}

export function useAlertMonitor(data: TickerData[]) {
    const [alerts, setAlerts] = useState<AlertRecord[]>([]);
    const [config, setConfig] = useState<AlertConfig>(() => readStoredConfig());
    const historyRef = useRef<Map<string, HistoricalDataPoint[]>>(new Map());
    const triggeredAlertsRef = useRef<Set<string>>(readTriggeredAlerts());
    const [historyVersion, setHistoryVersion] = useState(0);

    const updateConfig = useCallback((newConfig: Partial<AlertConfig>) => {
        setConfig((prev) => {
            const updated = { ...prev, ...newConfig };
            try {
                localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(updated));
            } catch (error) {
                console.warn('Failed to persist alert config:', error);
            }
            return updated;
        });
    }, []);

    useEffect(() => {
        if (data.length === 0) {
            return;
        }

        const now = Date.now();
        const cutoffTime = now - config.timeWindow;
        const nextHistory = new Map(historyRef.current);
        const activeSymbols = new Set(data.map((ticker) => ticker.symbol));

        for (const [symbol, points] of nextHistory.entries()) {
            const nextPoints = pruneHistoryPoints(points, cutoffTime);
            if (nextPoints.length === 0 && !activeSymbols.has(symbol)) {
                nextHistory.delete(symbol);
                continue;
            }
            nextHistory.set(symbol, nextPoints);
        }

        data.forEach((ticker) => {
            const currentPrice = parseFloat(ticker.lastPrice);
            const currentOI = parseFloat(ticker.openInterestValue || '0');
            const point: HistoricalDataPoint = {
                symbol: ticker.symbol,
                price: Number.isFinite(currentPrice) ? currentPrice : 0,
                openInterestValue: Number.isFinite(currentOI) ? currentOI : 0,
                timestamp: now,
            };

            const existingPoints = pruneHistoryPoints(nextHistory.get(ticker.symbol) || [], cutoffTime);
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

            nextHistory.set(ticker.symbol, existingPoints);
        });

        historyRef.current = nextHistory;
        scheduleStateUpdate(() => {
            setHistoryVersion((prev) => prev + 1);
        });
    }, [config.timeWindow, data]);

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
    }, [config.enableCritical, config.enableInfo, config.enableWarning]);

    useEffect(() => {
        if (data.length === 0 || historyVersion === 0) {
            return;
        }

        const now = Date.now();
        const newAlerts: AlertRecord[] = [];
        const triggered = triggeredAlertsRef.current;
        const history = historyRef.current;

        data.forEach((ticker) => {
            const symbol = ticker.symbol;
            const currentPrice = parseFloat(ticker.lastPrice);
            const currentOI = parseFloat(ticker.openInterestValue || '0');
            const points = history.get(symbol);

            if (!points || points.length === 0) {
                return;
            }

            const basePoint = points[0];
            const basePrice = basePoint.price;
            const baseOI = basePoint.openInterestValue;

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
            scheduleStateUpdate(() => {
                setAlerts((prev) => [...newAlerts, ...prev].slice(0, 50));
            });

            try {
                localStorage.setItem(STORAGE_KEYS.TRIGGERED, JSON.stringify([...triggered]));
            } catch (error) {
                console.warn('Failed to save triggered alerts, possible quota exceeded', error);
            }

            if (config.enableSound) {
                playAlertSound();
            }

            if (config.enableNotification) {
                newAlerts.forEach((alert) => {
                    if (shouldShowNotification(alert.level, config.notificationMinLevel)) {
                        showBrowserNotification(alert);
                    }
                });
            }
        }
    }, [config, data, getAlertLevel, historyVersion]);

    useEffect(() => {
        const interval = setInterval(() => {
            triggeredAlertsRef.current = new Set<string>();
            try {
                localStorage.setItem(STORAGE_KEYS.TRIGGERED, JSON.stringify([]));
            } catch (error) {
                console.warn('Failed to clear triggered alerts:', error);
            }
        }, config.timeWindow);

        return () => clearInterval(interval);
    }, [config.timeWindow]);

    const dismissAlert = useCallback((id: string) => {
        setAlerts((prev) => prev.filter((alert) => alert.id !== id));
    }, []);

    const clearAllAlerts = useCallback(() => {
        setAlerts([]);
    }, []);

    return useMemo(() => ({
        alerts,
        config,
        updateConfig,
        dismissAlert,
        clearAllAlerts,
    }), [alerts, clearAllAlerts, config, dismissAlert, updateConfig]);
}

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
    } catch (error) {
        console.error('Failed to play alert sound:', error);
    }
}

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
