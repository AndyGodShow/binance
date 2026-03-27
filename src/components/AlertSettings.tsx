"use client";

import { useState } from 'react';
import { AlertConfig, AlertLevel } from '@/lib/types';
import { X, Bell } from 'lucide-react';
import styles from './AlertSettings.module.css';

interface AlertSettingsProps {
    config: AlertConfig;
    onUpdateConfig: (config: Partial<AlertConfig>) => void;
    onClose: () => void;
}

export default function AlertSettings({ config, onUpdateConfig, onClose }: AlertSettingsProps) {
    const [notificationPermission, setNotificationPermission] = useState(
        typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default'
    );

    const requestNotificationPermission = async () => {
        if (!('Notification' in window)) {
            alert('此浏览器不支持通知功能');
            return;
        }

        const permission = await Notification.requestPermission();
        setNotificationPermission(permission);

        if (permission === 'granted') {
            onUpdateConfig({ enableNotification: true });
        }
    };

    const timeWindowOptions = [
        { value: 15 * 60 * 1000, label: '15分钟' },
        { value: 30 * 60 * 1000, label: '30分钟' },
        { value: 60 * 60 * 1000, label: '1小时' },
    ];

    const notificationLevelOptions: { value: AlertLevel; label: string }[] = [
        { value: 'info', label: '全部 (10%+)' },
        { value: 'warning', label: '警示及以上 (30%+)' },
        { value: 'critical', label: '仅紧急 (50%+)' },
    ];

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className={styles.header}>
                    <div className={styles.titleArea}>
                        <Bell size={24} />
                        <h2 className={styles.title}>提醒设置</h2>
                    </div>
                    <button className={styles.closeBtn} onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className={styles.content}>
                    {/* Alert Levels Section */}
                    <section className={styles.section}>
                        <h3 className={styles.sectionTitle}>提醒级别</h3>
                        <p className={styles.sectionDesc}>选择需要监控的涨幅级别</p>

                        <div className={styles.levelCards}>
                            <div
                                className={`${styles.levelCard} ${styles.info} ${config.enableInfo ? styles.active : ''}`}
                                onClick={() => onUpdateConfig({ enableInfo: !config.enableInfo })}
                            >
                                <div className={styles.levelHeader}>
                                    <span className={styles.levelEmoji}>🔵</span>
                                    <span className={styles.levelName}>信息级</span>
                                </div>
                                <div className={styles.levelThreshold}>≥ 10%</div>
                                <div className={styles.levelToggle}>
                                    {config.enableInfo ? '已启用' : '已禁用'}
                                </div>
                            </div>

                            <div
                                className={`${styles.levelCard} ${styles.warning} ${config.enableWarning ? styles.active : ''}`}
                                onClick={() => onUpdateConfig({ enableWarning: !config.enableWarning })}
                            >
                                <div className={styles.levelHeader}>
                                    <span className={styles.levelEmoji}>🟡</span>
                                    <span className={styles.levelName}>警示级</span>
                                </div>
                                <div className={styles.levelThreshold}>≥ 30%</div>
                                <div className={styles.levelToggle}>
                                    {config.enableWarning ? '已启用' : '已禁用'}
                                </div>
                            </div>

                            <div
                                className={`${styles.levelCard} ${styles.critical} ${config.enableCritical ? styles.active : ''}`}
                                onClick={() => onUpdateConfig({ enableCritical: !config.enableCritical })}
                            >
                                <div className={styles.levelHeader}>
                                    <span className={styles.levelEmoji}>🔴</span>
                                    <span className={styles.levelName}>紧急级</span>
                                </div>
                                <div className={styles.levelThreshold}>≥ 50%</div>
                                <div className={styles.levelToggle}>
                                    {config.enableCritical ? '已启用' : '已禁用'}
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* 监控类型选择 */}
                    <section className={styles.section}>
                        <h3 className={styles.sectionTitle}>监控类型</h3>
                        <p className={styles.sectionDesc}>选择要监控的数据类型</p>

                        <div className={styles.switchRow}>
                            <label className={styles.switchLabel}>
                                监控价格变化
                            </label>
                            <button
                                className={`${styles.switch} ${config.monitorPrice ? styles.on : ''}`}
                                onClick={() => onUpdateConfig({ monitorPrice: !config.monitorPrice })}
                            >
                                <span className={styles.switchSlider} />
                            </button>
                        </div>

                        <div className={styles.switchRow}>
                            <label className={styles.switchLabel}>
                                监控持仓金额变化
                            </label>
                            <button
                                className={`${styles.switch} ${config.monitorOI ? styles.on : ''}`}
                                onClick={() => onUpdateConfig({ monitorOI: !config.monitorOI })}
                            >
                                <span className={styles.switchSlider} />
                            </button>
                        </div>

                        <div className={styles.switchRow}>
                            <label className={styles.switchLabel}>
                                监控跌幅
                            </label>
                            <button
                                className={`${styles.switch} ${config.monitorDecline ? styles.on : ''}`}
                                onClick={() => onUpdateConfig({ monitorDecline: !config.monitorDecline })}
                            >
                                <span className={styles.switchSlider} />
                            </button>
                        </div>
                    </section>

                    {/* Time Window */}
                    <section className={styles.section}>
                        <h3 className={styles.sectionTitle}>时间窗口</h3>
                        <p className={styles.sectionDesc}>计算涨幅的时间范围</p>

                        <div className={styles.selectWrapper}>
                            <select
                                className={styles.select}
                                value={config.timeWindow}
                                onChange={(e) => onUpdateConfig({ timeWindow: Number(e.target.value) })}
                            >
                                {timeWindowOptions.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                    </section>

                    {/* Notification Settings */}
                    <section className={styles.section}>
                        <h3 className={styles.sectionTitle}>浏览器通知</h3>
                        <p className={styles.sectionDesc}>在系统级别显示通知（即使标签页不在前台）</p>

                        {notificationPermission === 'denied' && (
                            <div className={styles.warning}>
                                ⚠️ 浏览器通知已被禁止。请在浏览器设置中允许通知权限。
                            </div>
                        )}

                        {notificationPermission === 'default' && (
                            <button
                                className={styles.permissionBtn}
                                onClick={requestNotificationPermission}
                            >
                                <Bell size={16} />
                                请求通知权限
                            </button>
                        )}

                        {notificationPermission === 'granted' && (
                            <>
                                <div className={styles.switchRow}>
                                    <label className={styles.switchLabel}>
                                        启用浏览器通知
                                    </label>
                                    <button
                                        className={`${styles.switch} ${config.enableNotification ? styles.on : ''}`}
                                        onClick={() => onUpdateConfig({ enableNotification: !config.enableNotification })}
                                    >
                                        <span className={styles.switchSlider} />
                                    </button>
                                </div>

                                {config.enableNotification && (
                                    <div className={styles.selectWrapper} style={{ marginTop: '12px' }}>
                                        <label className={styles.selectLabel}>通知最低级别</label>
                                        <select
                                            className={styles.select}
                                            value={config.notificationMinLevel}
                                            onChange={(e) => onUpdateConfig({ notificationMinLevel: e.target.value as AlertLevel })}
                                        >
                                            {notificationLevelOptions.map(opt => (
                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                            </>
                        )}
                    </section>

                    {/* Sound Settings */}
                    <section className={styles.section}>
                        <h3 className={styles.sectionTitle}>音效提醒</h3>
                        <p className={styles.sectionDesc}>提醒触发时播放提示音</p>

                        <div className={styles.switchRow}>
                            <label className={styles.switchLabel}>
                                启用音效
                            </label>
                            <button
                                className={`${styles.switch} ${config.enableSound ? styles.on : ''}`}
                                onClick={() => onUpdateConfig({ enableSound: !config.enableSound })}
                            >
                                <span className={styles.switchSlider} />
                            </button>
                        </div>
                    </section>

                    {/* 定时推送 */}
                    <section className={styles.section}>
                        <h3 className={styles.sectionTitle}>定时资金费率推送</h3>
                        <p className={styles.sectionDesc}>每个整点和半点推送费率排名TOP3</p>

                        <div className={styles.switchRow}>
                            <label className={styles.switchLabel}>
                                启用定时推送
                            </label>
                            <button
                                className={`${styles.switch} ${config.enableScheduledAlerts ? styles.on : ''}`}
                                onClick={() => onUpdateConfig({ enableScheduledAlerts: !config.enableScheduledAlerts })}
                            >
                                <span className={styles.switchSlider} />
                            </button>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
