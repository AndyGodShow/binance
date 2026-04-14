"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { TickerData, ScheduledAlertRecord } from '@/lib/types';
import { buildFundingRateAlert } from '@/lib/scheduledAlerts';

export function useScheduledAlerts(data: TickerData[], enabled: boolean, config?: { enableSound: boolean; enableNotification: boolean }) {
    const [scheduledAlerts, setScheduledAlerts] = useState<ScheduledAlertRecord[]>([]);
    const lastTriggeredRef = useRef<number>(-1);
    const dataRef = useRef<TickerData[]>(data);

    // 保持 dataRef 最新
    useEffect(() => {
        dataRef.current = data;
    }, [data]);

    const triggerFundingRateAlert = useCallback((): boolean => {
        const currentData = dataRef.current;
        const timestamp = Date.now();
        const alert = buildFundingRateAlert(currentData, timestamp);

        if (!alert) {
            return false;
        }

        setScheduledAlerts(prev => [alert, ...prev.slice(0, 9)]);
        if (config?.enableNotification !== false) {
            showFundingRateNotification(alert);
        }
        if (config?.enableSound !== false) {
            playAlertSound();
        }
        return true;
    }, [config?.enableNotification, config?.enableSound]);

    const checkSchedule = useCallback(() => {
        const now = new Date();
        const minutes = now.getMinutes();
        const halfHourOffsetMinutes = minutes % 30;
        const withinTriggerWindow = halfHourOffsetMinutes < 2;

        if (!withinTriggerWindow) {
            return;
        }

        const slotMinute = minutes - halfHourOffsetMinutes;
        const dateKey = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
        const slotIdentifier = dateKey * 10000 + now.getHours() * 100 + slotMinute;

        if (lastTriggeredRef.current !== slotIdentifier && triggerFundingRateAlert()) {
            lastTriggeredRef.current = slotIdentifier;
        }
    }, [triggerFundingRateAlert]);

    useEffect(() => {
        if (!enabled) return;

        checkSchedule();

        const interval = setInterval(checkSchedule, 1000);
        return () => clearInterval(interval);
    }, [checkSchedule, enabled]);
    const dismissAlert = useCallback((id: string) => {
        setScheduledAlerts(prev => prev.filter(a => a.id !== id));
    }, []);

    const clearAll = useCallback(() => {
        setScheduledAlerts([]);
    }, []);

    return {
        scheduledAlerts,
        dismissAlert,
        clearAll,
    };
}

// Helper: 显示资金费率浏览器通知
function showFundingRateNotification(alert: ScheduledAlertRecord) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const time = new Date(alert.timestamp).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit'
    });

    const topPos = alert.topPositive[0];
    const topNeg = alert.topNegative[0];

    new Notification(`📊 资金费率推送 ${time}`, {
        body: `🟢 ${topPos?.symbol || ''} +${((topPos?.fundingRate || 0) * 100).toFixed(4)}%\n🔴 ${topNeg?.symbol || ''} ${((topNeg?.fundingRate || 0) * 100).toFixed(4)}%`,
        icon: '/favicon.ico',
        tag: alert.id,
    });
}

// Helper: 播放提示音
function playAlertSound() {
    try {
        const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.value = 0.2;
        osc.start();
        osc.stop(ctx.currentTime + 0.12);
    } catch (e) {
        console.error('Failed to play alert sound:', e);
    }
}
