"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { TickerData, ScheduledAlertRecord, FundingRateItem } from '@/lib/types';

export function useScheduledAlerts(data: TickerData[], enabled: boolean) {
    const [scheduledAlerts, setScheduledAlerts] = useState<ScheduledAlertRecord[]>([]);
    const lastTriggeredRef = useRef<number>(-1);
    const dataRef = useRef<TickerData[]>(data);

    // 保持 dataRef 最新
    useEffect(() => {
        dataRef.current = data;
    }, [data]);

    const triggerFundingRateAlert = useCallback(() => {
        const currentData = dataRef.current;
        if (currentData.length === 0) return;

        // 过滤并排序获取TOP3正负费率
        const validData = currentData.filter(t => t.fundingRate && parseFloat(t.fundingRate) !== 0);

        const sorted = [...validData].sort((a, b) =>
            parseFloat(b.fundingRate || '0') - parseFloat(a.fundingRate || '0')
        );

        const topPositive: FundingRateItem[] = sorted.slice(0, 3).map(t => ({
            symbol: t.symbol,
            fundingRate: parseFloat(t.fundingRate || '0')
        }));

        const topNegative: FundingRateItem[] = sorted.slice(-3).reverse().map(t => ({
            symbol: t.symbol,
            fundingRate: parseFloat(t.fundingRate || '0')
        }));

        const alert: ScheduledAlertRecord = {
            id: `scheduled-${Date.now()}`,
            type: 'funding-rate',
            timestamp: Date.now(),
            topPositive,
            topNegative,
        };

        setScheduledAlerts(prev => [alert, ...prev.slice(0, 9)]);
        showFundingRateNotification(alert);
        playAlertSound();
    }, []);

    useEffect(() => {
        if (!enabled) return;

        const checkSchedule = () => {
            const now = new Date();
            const minutes = now.getMinutes();
            const seconds = now.getSeconds();

            // 在整点或半点的前10秒内触发（加大窗口，防止错过）
            if ((minutes === 0 || minutes === 30) && seconds < 10) {
                const currentIdentifier = now.getHours() * 100 + minutes;
                if (lastTriggeredRef.current !== currentIdentifier) {
                    lastTriggeredRef.current = currentIdentifier;
                    triggerFundingRateAlert();
                }
            }
        };

        const interval = setInterval(checkSchedule, 1000);
        return () => clearInterval(interval);
    }, [enabled, triggerFundingRateAlert]); // 不再依赖 data 和 lastTriggeredMinute



    const dismissAlert = (id: string) => {
        setScheduledAlerts(prev => prev.filter(a => a.id !== id));
    };

    const clearAll = () => {
        setScheduledAlerts([]);
    };

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
        const audio = new Audio('/alert.mp3');
        audio.volume = 0.3; // 定时推送音量稍小
        audio.play().catch(e => console.error('Failed to play sound:', e));
    } catch (e) {
        console.error('Failed to create audio:', e);
    }
}
