import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
        const text = await res.text();
        return NextResponse.json({
            status: res.status,
            headers: Object.fromEntries(res.headers.entries()),
            text: text.substring(0, 500)
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message });
    }
}
