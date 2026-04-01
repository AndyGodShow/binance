"use client";

import { Search, LayoutGrid, List, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import styles from './ControlBar.module.css';

interface ControlBarProps {
    search: string;
    setSearch: (s: string) => void;
    volumeFilter: string;
    setVolumeFilter: (v: string) => void;
    compactMode: boolean;
    setCompactMode: (b: boolean) => void;
    onOpenAlertSettings?: () => void;
}

const volumeOptions = [
    { label: '全部', value: '0' },
    { label: '> 10 亿', value: '1000000000_gt' },
    { label: '> 5 亿', value: '500000000_gt' },
    { label: '> 1 亿', value: '100000000_gt' },
    { label: '< 1 亿', value: '100000000_lt' },
    { label: '< 5000 万', value: '50000000_lt' },
    { label: '< 1000 万', value: '10000000_lt' },
];

export default function ControlBar({
    search,
    setSearch,
    volumeFilter,
    setVolumeFilter,
    compactMode,
    setCompactMode,
    onOpenAlertSettings,
}: ControlBarProps) {
    return (
        <div className={styles.container}>
            <div className={styles.left}>
                <div className={styles.searchSection}>
                    <span className={styles.fieldLabel}>搜索</span>
                    <div className={styles.searchWrapper}>
                        <Search className={styles.searchIcon} size={16} />
                        <input
                            type="text"
                            placeholder="搜索币种 (e.g. BTC)"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className={styles.searchInput}
                        />
                    </div>
                </div>

                <div className={styles.filterSection}>
                    <span className={styles.fieldLabel}>流动性</span>
                    <div className={styles.segmentedControl}>
                        {volumeOptions.map((opt) => (
                            <button
                                key={opt.value}
                                onClick={() => setVolumeFilter(opt.value)}
                                className={cn(styles.segmentBtn, volumeFilter === opt.value && styles.activeSegment)}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className={styles.right}>
                <span className={styles.fieldLabel}>工具</span>
                <div className={styles.actionRow}>
                    {onOpenAlertSettings && (
                        <button
                            className={styles.alertBtn}
                            onClick={onOpenAlertSettings}
                            title="提醒设置"
                        >
                            <Bell size={18} />
                        </button>
                    )}

                    <div className={styles.viewToggle}>
                        <button
                            className={cn(styles.iconBtn, !compactMode && styles.activeIcon)}
                            onClick={() => setCompactMode(false)}
                            title="Comfortable View"
                        >
                            <LayoutGrid size={18} />
                        </button>
                        <button
                            className={cn(styles.iconBtn, compactMode && styles.activeIcon)}
                            onClick={() => setCompactMode(true)}
                            title="Compact View"
                        >
                            <List size={18} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
