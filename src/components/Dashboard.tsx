"use client";

import { useState, useMemo, useEffect, useCallback } from 'react';
import { TickerData, SortableKey } from '@/lib/types';
import { useAlertMonitor } from '@/hooks/useAlertMonitor';
import { useScheduledAlerts } from '@/hooks/useScheduledAlerts';
import ControlBar from './ControlBar';
import DataTable from './DataTable';
import AlertNotification from './AlertNotification';
import AlertSettings from './AlertSettings';
import ScheduledAlertCard from './ScheduledAlertCard';
import styles from './Dashboard.module.css';

interface DashboardProps {
    processedData?: TickerData[];
    onSymbolClick?: (symbol: string) => void;
}

export default function Dashboard({ processedData: externalData, onSymbolClick }: DashboardProps) {
    const [mounted, setMounted] = useState(false);
    const [search, setSearch] = useState('');
    const [volumeFilter, setVolumeFilter] = useState('0');
    const [compactMode, setCompactMode] = useState(false);
    const [showAlertSettings, setShowAlertSettings] = useState(false);
    const [sortConfig, setSortConfig] = useState<{ key: SortableKey; direction: 'asc' | 'desc' } | null>({
        key: 'quoteVolume',
        direction: 'desc',
    });

    useEffect(() => {
        setMounted(true);
    }, []);

    // Filter and sort the external data
    const filteredData = useMemo(() => {
        if (!externalData) return [];

        let result = [...externalData];

        // Filter by Search
        if (search) {
            const q = search.toLowerCase();
            result = result.filter((t) => t.symbol.toLowerCase().includes(q));
        }

        // Filter by Volume
        if (volumeFilter !== '0') {
            const [val, op] = volumeFilter.split('_');
            const threshold = Number(val);
            if (op === 'lt') {
                result = result.filter((t) => Number(t.quoteVolume) < threshold);
            } else if (op === 'gt') {
                result = result.filter((t) => Number(t.quoteVolume) > threshold);
            }
        }

        // Sort
        if (sortConfig) {
            result.sort((a, b) => {
                const key = sortConfig.key;
                let aVal: number | string = 0;
                let bVal: number | string = 0;

                const valA = a[key as keyof TickerData];
                const valB = b[key as keyof TickerData];

                if (valA === undefined && valB === undefined) return 0;
                if (valA === undefined) return 1;
                if (valB === undefined) return -1;

                const numericKeys: (keyof TickerData)[] = [
                    'lastPrice', 'priceChangePercent', 'quoteVolume',
                    'fundingRate', 'openInterest', 'change15m', 'change1h', 'change4h'
                ];

                if (numericKeys.includes(key as keyof TickerData) || key === 'openInterest' || key === 'openInterestValue') {
                    aVal = Number(valA);
                    bVal = Number(valB);
                } else {
                    aVal = valA as string;
                    bVal = valB as string;
                }

                if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }

        return result;
    }, [externalData, search, volumeFilter, sortConfig]);

    // BUG-1: Calculate maxVolume for DataTable progress bars
    const maxVolume = useMemo(() => {
        if (filteredData.length === 0) return 0;
        return Math.max(...filteredData.map(t => Number(t.quoteVolume) || 0));
    }, [filteredData]);

    const alertData = externalData || [];

    // Alert Monitor Hook
    const { alerts, config: alertConfig, updateConfig: updateAlertConfig, dismissAlert, clearAllAlerts } = useAlertMonitor(alertData);

    // Scheduled Alerts Hook
    const { scheduledAlerts, dismissAlert: dismissScheduledAlert } = useScheduledAlerts(
        alertData,
        alertConfig.enableScheduledAlerts,
        { enableSound: alertConfig.enableSound, enableNotification: alertConfig.enableNotification }
    );

    const handleSort = useCallback((key: SortableKey) => {
        let direction: 'asc' | 'desc' = 'desc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
            direction = 'asc';
        }
        setSortConfig({ key, direction });
    }, [sortConfig]);

    const handleOpenAlertSettings = useCallback(() => {
        setShowAlertSettings(true);
    }, []);

    const handleCloseAlertSettings = useCallback(() => {
        setShowAlertSettings(false);
    }, []);

    if (!mounted) {
        return null;
    }

    return (
        <div className={styles.dashboard}>
            <ControlBar
                search={search}
                setSearch={setSearch}
                volumeFilter={volumeFilter}
                setVolumeFilter={setVolumeFilter}
                compactMode={compactMode}
                setCompactMode={setCompactMode}
                onOpenAlertSettings={handleOpenAlertSettings}
            />

            <DataTable
                data={filteredData}
                onSymbolClick={onSymbolClick}
                onSort={handleSort}
                sortConfig={sortConfig}
                compactMode={compactMode}
                maxVolume={maxVolume}
            />

            {/* Alert Notifications */}
            {alerts.length > 0 && (
                <AlertNotification
                    alerts={alerts}
                    onDismiss={dismissAlert}
                    onClearAll={clearAllAlerts}
                />
            )}

            {/* Scheduled Alert Cards */}
            {scheduledAlerts.slice(0, 2).map((alert) => (
                <ScheduledAlertCard
                    key={alert.id}
                    alert={alert}
                    onDismiss={dismissScheduledAlert}
                />
            ))}

            {/* Alert Settings Panel */}
            {showAlertSettings && (
                <AlertSettings
                    config={alertConfig}
                    onUpdateConfig={updateAlertConfig}
                    onClose={handleCloseAlertSettings}
                />
            )}
        </div>
    );
}
