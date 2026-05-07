import type {
    ClassifiedHolder,
    HolderAddressClass,
    HolderConcentrationAnalysis,
    TopHolderItem,
} from './types.ts';

const INFRA_CLASSES = new Set<HolderAddressClass>([
    'lp_pool',
    'burn',
    'cex',
    'treasury',
    'vesting',
    'staking',
    'bridge',
    'router',
    'contract',
    'market_maker',
]);

function descriptorOf(holder: Pick<TopHolderItem, 'label' | 'entity'>) {
    return `${holder.label ?? ''} ${holder.entity ?? ''}`.trim().toLowerCase();
}

function hasAny(value: string, keywords: string[]) {
    return keywords.some((keyword) => value.includes(keyword));
}

function isBurnAddress(address: string) {
    const normalized = address.toLowerCase();
    return normalized === '0x0000000000000000000000000000000000000000'
        || normalized === '0x000000000000000000000000000000000000dead'
        || /^1{32,}$/.test(address)
        || /^0{32,}$/.test(address);
}

function classFromDescriptor(descriptor: string): { holderClass: HolderAddressClass; reason: string } | null {
    if (hasAny(descriptor, ['burn', 'dead', 'null address', 'black hole'])) {
        return { holderClass: 'burn', reason: 'label/entity 命中 burn/dead/null。' };
    }
    if (hasAny(descriptor, ['pair', 'pool', 'liquidity', 'uniswap', 'pancake', 'sushiswap', 'raydium', 'orca', 'meteora'])) {
        return { holderClass: 'lp_pool', reason: 'label/entity 命中 DEX pair/pool/liquidity。' };
    }
    if (hasAny(descriptor, ['binance', 'okx', 'coinbase', 'bybit', 'gate', 'kucoin', 'mexc', 'upbit', 'bitget', 'kraken'])) {
        return { holderClass: 'cex', reason: 'label/entity 命中中心化交易所。' };
    }
    if (hasAny(descriptor, ['bridge', 'wormhole', 'layerzero', 'stargate', 'portal', 'multichain'])) {
        return { holderClass: 'bridge', reason: 'label/entity 命中 bridge/跨链基础设施。' };
    }
    if (hasAny(descriptor, ['vesting'])) {
        return { holderClass: 'vesting', reason: 'label/entity 命中 vesting。' };
    }
    if (hasAny(descriptor, ['staking', 'stake', 'vault'])) {
        return { holderClass: 'staking', reason: 'label/entity 命中 staking/vault。' };
    }
    if (hasAny(descriptor, ['treasury', 'foundation', 'team', 'dao', 'reserve'])) {
        return { holderClass: 'treasury', reason: 'label/entity 命中 treasury/foundation/team/reserve。' };
    }
    if (hasAny(descriptor, ['router'])) {
        return { holderClass: 'router', reason: 'label/entity 命中 router。' };
    }
    if (hasAny(descriptor, ['market maker', 'market-maker', 'wintermute', 'amber', 'jump trading', 'gsr', 'dwf'])) {
        return { holderClass: 'market_maker', reason: 'label/entity 命中 market maker。' };
    }
    if (hasAny(descriptor, ['wallet', 'holder'])) {
        return { holderClass: 'user_wallet', reason: 'label/entity 更像普通钱包。' };
    }

    return null;
}

export function classifyHolderAddress(holder: TopHolderItem): ClassifiedHolder {
    const descriptor = descriptorOf(holder);
    const reasons: string[] = [];
    let holderClass: HolderAddressClass = 'unknown';
    let confidence: ClassifiedHolder['confidence'] = 'low';

    if (isBurnAddress(holder.address)) {
        holderClass = 'burn';
        confidence = 'high';
        reasons.push('地址命中 burn/null 地址模式。');
    } else {
        const descriptorClass = classFromDescriptor(descriptor);
        if (descriptorClass) {
            holderClass = descriptorClass.holderClass;
            confidence = holderClass === 'user_wallet' ? 'medium' : 'high';
            reasons.push(descriptorClass.reason);
        } else if (holder.isContract) {
            holderClass = 'contract';
            confidence = 'medium';
            reasons.push('isContract=true 且无更具体标签。');
        } else {
            reasons.push('缺少可用 label/entity，无法可靠分类。');
        }
    }

    return {
        address: holder.address,
        balance: holder.balance,
        percentage: Number.isFinite(holder.percentage) ? holder.percentage : null,
        label: holder.label,
        entity: holder.entity,
        isContract: holder.isContract,
        class: holderClass,
        confidence,
        reasons,
    };
}

function topShare(holders: ClassifiedHolder[], count: number) {
    const selected = holders.slice(0, count);
    if (selected.length === 0 || selected.some((holder) => holder.percentage === null)) {
        return null;
    }

    return selected.reduce((sum, holder) => sum + (holder.percentage ?? 0), 0);
}

export function buildHolderConcentration(topHolders: TopHolderItem[]): HolderConcentrationAnalysis {
    const classifiedHolders = topHolders.map(classifyHolderAddress);
    const excludedTopHolders = classifiedHolders.filter((holder) => INFRA_CLASSES.has(holder.class));
    const unknownTopHolders = classifiedHolders.filter((holder) => holder.class === 'unknown');
    const floatEligibleHolders = classifiedHolders.filter((holder) => holder.class === 'user_wallet' || holder.class === 'unknown');
    const excludedSharePercent = excludedTopHolders.reduce((sum, holder) => sum + (holder.percentage ?? 0), 0);
    const unknownSharePercent = unknownTopHolders.reduce((sum, holder) => sum + (holder.percentage ?? 0), 0);
    const warnings: string[] = [];

    if (excludedSharePercent >= 20) {
        warnings.push(`疑似非流通/基础设施地址占比约 ${excludedSharePercent.toFixed(2)}%，原始集中度被污染。`);
    }
    if (unknownSharePercent >= 25) {
        warnings.push(`未知地址占比约 ${unknownSharePercent.toFixed(2)}%，该结果依赖标签质量。`);
    }
    if (classifiedHolders.some((holder) => holder.percentage === null)) {
        warnings.push('部分 Top holders 缺少可用占比，无法计算完整净化后集中度。');
    }

    return {
        rawTop1: topShare(classifiedHolders, 1),
        rawTop5: topShare(classifiedHolders, 5),
        rawTop10: topShare(classifiedHolders, 10),
        floatTop1: topShare(floatEligibleHolders, 1),
        floatTop5: topShare(floatEligibleHolders, 5),
        floatTop10: topShare(floatEligibleHolders, 10),
        excludedSharePercent,
        unknownSharePercent,
        classifiedHolders,
        excludedTopHolders,
        unknownTopHolders,
        warnings,
    };
}
