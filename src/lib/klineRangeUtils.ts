import type { KlineData } from './backtestKlineMerge.ts';

export function detectKlineGaps(klines: KlineData[], intervalMs: number) {
    let gapCount = 0;
    let missingBars = 0;
    let maxGapBars = 0;

    for (let index = 1; index < klines.length; index += 1) {
        const diff = klines[index].closeTime - klines[index - 1].closeTime;
        if (diff <= intervalMs) {
            continue;
        }

        const missing = Math.max(1, Math.round(diff / intervalMs) - 1);
        gapCount += 1;
        missingBars += missing;
        maxGapBars = Math.max(maxGapBars, missing);
    }

    return { gapCount, missingBars, maxGapBars };
}
