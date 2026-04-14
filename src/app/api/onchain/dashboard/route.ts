import { NextRequest, NextResponse } from 'next/server';

import { buildTokenResearchPayload } from '@/lib/onchain/service';
import type { OnchainSearchScope } from '@/lib/onchain/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const keyword = searchParams.get('keyword') || 'PEPE';
        const tokenAddress = searchParams.get('tokenAddress');
        const chainId = searchParams.get('chainId');
        const scope = (searchParams.get('scope') === 'alpha' ? 'alpha' : 'contracts') as OnchainSearchScope;

        const payload = await buildTokenResearchPayload(keyword, { tokenAddress, chainId }, scope);

        return NextResponse.json(payload, {
            headers: {
                'X-Data-Source': payload.sourceMode === 'hybrid' ? 'dexscreener-moralis-token-intelligence' : 'fallback-token-intelligence',
            },
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error in onchain dashboard';
        return NextResponse.json(
            { error: message, generatedAt: Date.now() },
            { status: 500 }
        );
    }
}
