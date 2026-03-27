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
    { label: '> 5亿', value: '500000000_gt' },
    { label: '> 1亿', value: '100000000_gt' },
    { label: '< 5M', value: '5000000_lt' },
    { label: '< 10M', value: '10000000_lt' },
    { label: '< 30M', value: '30000000_lt' },
    { label: '< 50M', value: '50000000_lt' },
    { label: '< 1亿', value: '100000000_lt' },
    { label: '< 3亿', value: '300000000_lt' },
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
                {/* Search */}
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

                {/* Segmented Control for Volume */}
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

            <div className={styles.right}>
                {/* Alert Settings Button */}
                {onOpenAlertSettings && (
                    <button
                        className={styles.alertBtn}
                        onClick={onOpenAlertSettings}
                        title="提醒设置"
                    >
                        <Bell size={18} />
                    </button>
                )}

                {/* View Mode Toggle */}
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
    );
}
