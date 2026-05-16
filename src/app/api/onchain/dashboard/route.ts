import { NextRequest, NextResponse } from 'next/server';

import { buildTokenResearchPayload } from '@/lib/onchain/service';
import { invalidRequestBody, validateOnchainDashboardParams } from '@/lib/apiRequestValidation';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const validated = validateOnchainDashboardParams(searchParams);
        if (!validated.ok) {
            return NextResponse.json(invalidRequestBody(validated.details), { status: 400 });
        }

        const { keyword, tokenAddress, chainId, scope } = validated.value;

        const payload = await buildTokenResearchPayload(keyword, { tokenAddress, chainId }, scope);

        return NextResponse.json(payload, {
            headers: {
                'X-Data-Source': payload.sourceMode === 'hybrid' ? 'dexscreener-moralis-token-intelligence' : 'fallback-token-intelligence',
            },
        });
    } catch {
        return NextResponse.json(
            { error: 'Onchain dashboard request failed', generatedAt: Date.now() },
            { status: 500 }
        );
    }
}
