"use client";

import { TickerData, OpenInterestFrameSnapshot } from '@/lib/types';
import LeaderboardPanel from './LeaderboardPanel';
import styles from './Dashboard.module.css';

interface LeaderboardViewProps {
    data: TickerData[];
    openInterestFrames?: Record<string, OpenInterestFrameSnapshot>;
    onSymbolClick?: (symbol: string) => void;
}

export default function LeaderboardView({ data, openInterestFrames = {}, onSymbolClick }: LeaderboardViewProps) {
    return (
        <div className={styles.dashboard}>
            <section className={styles.header} style={{ gridTemplateColumns: '1fr' }}>
                <div className={styles.heroBlock}>
                    <span className={styles.eyebrow}>Anomaly Detection</span>
                    <div className={styles.heroTitleRow}>
                        <h1 className={styles.title}>异动排行榜</h1>
                        <span className={styles.liveBadge}>多维异动</span>
                    </div>
                    <p className={styles.subtitle}>
                        全市场合约涨跌幅与持仓异动实时榜单，快速发现资金介入与多空失衡的市场焦点。
                    </p>
                </div>
            </section>
            
            <LeaderboardPanel
                data={data}
                openInterestFrames={openInterestFrames}
                onSymbolClick={onSymbolClick}
            />
        </div>
    );
}
