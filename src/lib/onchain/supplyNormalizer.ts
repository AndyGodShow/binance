import type {
    ClassifiedHolder,
    HolderAddressClass,
    HolderConcentrationAnalysis,
    SupplyBreakdown,
    TokenSearchResult,
} from './types.ts';

const LOCKED_OR_INFRA_CLASSES = new Set<HolderAddressClass>([
    'lp_pool',
    'treasury',
    'vesting',
    'staking',
    'bridge',
    'router',
    'contract',
    'market_maker',
]);

function parseBalance(value?: string | null) {
    if (!value) {
        return null;
    }

    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
}

function estimateTotalSupplyFromHolders(holders: ClassifiedHolder[]) {
    const estimates = holders
        .map((holder) => {
            const balance = parseBalance(holder.balance);
            if (balance === null || holder.percentage === null || holder.percentage <= 0) {
                return null;
            }

            return balance / (holder.percentage / 100);
        })
        .filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);

    if (estimates.length === 0) {
        return { totalSupply: null, hasConflict: false };
    }

    const min = Math.min(...estimates);
    const max = Math.max(...estimates);
    const hasConflict = min > 0 && max / min > 1.05;

    estimates.sort((a, b) => a - b);
    return {
        totalSupply: estimates[Math.floor(estimates.length / 2)],
        hasConflict,
    };
}

function supplyByClass(
    holders: ClassifiedHolder[],
    totalSupply: number | null,
    predicate: (holder: ClassifiedHolder) => boolean
) {
    if (totalSupply === null) {
        return null;
    }

    return holders
        .filter(predicate)
        .reduce((sum, holder) => sum + ((holder.percentage ?? 0) / 100) * totalSupply, 0);
}

export function buildSupplyBreakdown({
    token,
    holderConcentration,
}: {
    token: TokenSearchResult | null;
    holderConcentration: HolderConcentrationAnalysis;
}): SupplyBreakdown {
    const warnings: string[] = [];
    const evidence: string[] = [];
    const { totalSupply, hasConflict } = estimateTotalSupplyFromHolders(holderConcentration.classifiedHolders);
    const marketCap = token?.marketCap ?? null;
    const fdv = token?.fdv ?? null;
    const topHolderPercentageSum = holderConcentration.classifiedHolders.reduce(
        (sum, holder) => sum + (holder.percentage ?? 0),
        0
    );

    if (holderConcentration.classifiedHolders.some((holder) => holder.percentage !== null && (holder.percentage < 0 || holder.percentage > 100))
        || topHolderPercentageSum > 100.000001
    ) {
        warnings.push('Top holder percentage 数学异常，合计或单项占比越界。');
    }

    if (totalSupply !== null) {
        evidence.push('totalSupply 由 Top holders balance 与 percentage 反推，属于估算。');
    } else {
        warnings.push('decimals/supply 缺失，无法估算 totalSupply。');
    }

    if (hasConflict) {
        warnings.push('totalSupply 与 Top holders 百分比分母存在冲突。');
    }

    if (marketCap === null && fdv !== null) {
        warnings.push('marketCap 缺失但 FDV 存在，不能把 FDV 当 marketCap。');
    }

    if (marketCap !== null && fdv !== null) {
        const larger = Math.max(marketCap, fdv);
        const smaller = Math.min(marketCap, fdv);
        if (smaller > 0 && larger / smaller >= 3) {
            warnings.push('marketCap 与 FDV 差距过大，circulating supply 口径不明。');
        }
    }

    const burnedSupply = supplyByClass(holderConcentration.classifiedHolders, totalSupply, (holder) => holder.class === 'burn');
    const lockedOrInfrastructureSupply = supplyByClass(
        holderConcentration.classifiedHolders,
        totalSupply,
        (holder) => LOCKED_OR_INFRA_CLASSES.has(holder.class)
    );
    const cexSupply = supplyByClass(holderConcentration.classifiedHolders, totalSupply, (holder) => holder.class === 'cex');
    const unknownTopHolderSupply = supplyByClass(holderConcentration.classifiedHolders, totalSupply, (holder) => holder.class === 'unknown');
    const estimatedFloatSupply = totalSupply === null
        ? null
        : totalSupply - (burnedSupply ?? 0) - (lockedOrInfrastructureSupply ?? 0) - (cexSupply ?? 0);

    if (totalSupply !== null && burnedSupply !== null && burnedSupply / totalSupply >= 0.4) {
        warnings.push('burnedSupply 过高，供应口径需要复核。');
    }

    if (totalSupply !== null && lockedOrInfrastructureSupply !== null && lockedOrInfrastructureSupply / totalSupply >= 0.3) {
        warnings.push('lockedOrInfrastructureSupply 过高，非流通/基础设施地址占比需要复核。');
    }

    if (totalSupply !== null && unknownTopHolderSupply !== null && unknownTopHolderSupply / totalSupply >= 0.25) {
        warnings.push('unknownTopHolderSupply 过高，未知地址供应占比需要复核。');
    }

    if (estimatedFloatSupply !== null && estimatedFloatSupply <= 0) {
        warnings.push('estimatedFloatSupply <= 0，不能生成净化后集中度。');
    }

    if (estimatedFloatSupply !== null && totalSupply !== null && estimatedFloatSupply > totalSupply) {
        warnings.push('estimatedFloatSupply > totalSupply，供应口径异常。');
    }

    if (token?.chainFamily === 'solana') {
        warnings.push('Solana token supply 当前无法在本阶段独立验证。');
    }

    const confidence: SupplyBreakdown['confidence'] = totalSupply === null
        || hasConflict
        || marketCap === null
        || warnings.some((warning) => /estimatedFloatSupply|FDV|unknownTopHolderSupply|Solana|decimals|冲突/.test(warning))
        ? 'low'
        : warnings.length > 0
            ? 'medium'
            : 'medium';

    return {
        totalSupply,
        circulatingSupply: null,
        burnedSupply,
        lockedOrInfrastructureSupply,
        cexSupply,
        unknownTopHolderSupply,
        estimatedFloatSupply,
        confidence,
        warnings,
        evidence,
    };
}

export function applySupplyToHolderConcentration(
    holderConcentration: HolderConcentrationAnalysis,
    supplyBreakdown: SupplyBreakdown
): HolderConcentrationAnalysis {
    if (supplyBreakdown.confidence === 'low' || !supplyBreakdown.estimatedFloatSupply || supplyBreakdown.estimatedFloatSupply <= 0) {
        return {
            ...holderConcentration,
            floatTop1: null,
            floatTop5: null,
            floatTop10: null,
            warnings: Array.from(new Set([
                ...holderConcentration.warnings,
                '供应口径可信度不足，隐藏净化后 TopN。',
            ])),
        };
    }

    const eligible = holderConcentration.classifiedHolders
        .filter((holder) => holder.class === 'user_wallet' || holder.class === 'unknown')
        .map((holder) => ({
            ...holder,
            percentage: holder.percentage === null
                ? null
                : (((holder.percentage / 100) * (supplyBreakdown.totalSupply ?? 0)) / supplyBreakdown.estimatedFloatSupply!) * 100,
        }));

    const topShare = (count: number) => {
        const selected = eligible.slice(0, count);
        if (selected.length === 0 || selected.some((holder) => holder.percentage === null)) {
            return null;
        }
        return selected.reduce((sum, holder) => sum + (holder.percentage ?? 0), 0);
    };

    return {
        ...holderConcentration,
        floatTop1: topShare(1),
        floatTop5: topShare(5),
        floatTop10: topShare(10),
    };
}
