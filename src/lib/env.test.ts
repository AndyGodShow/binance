import assert from 'node:assert/strict';
import test from 'node:test';

import { readBinanceEnv, readOnchainEnv, readRuntimeEnv, readServerEnv } from './env.ts';

test('readServerEnv parses the supported server environment into one explicit contract', () => {
    const parsed = readServerEnv({
        NODE_ENV: 'production',
        VERCEL: '1',
        MORALIS_API_KEY: '  moralis-secret  ',
        SOLANA_NETWORK: 'devnet',
        COINALYZE_API_KEY: ' coinalyze-secret ',
        BINANCE_FAPI_BASES: ' https://fapi.binance.com,https://fapi.binance.me/ ',
        DATA_DOWNLOAD_TOKEN: ' download-secret ',
        BITBO_API_KEY: ' bitbo-secret ',
        MARKET_ARCHIVE_ROOT: ' /var/lib/market-archive ',
        DEBUG_KLINE_CACHE: '1',
        UNKNOWN_SECRET: 'must-not-leak',
    });

    assert.deepEqual(parsed, {
        nodeEnv: 'production',
        isServerless: true,
        moralisApiKey: 'moralis-secret',
        solanaNetwork: 'devnet',
        coinalyzeApiKey: 'coinalyze-secret',
        binanceFapiBases: [
            'https://fapi.binance.com',
            'https://fapi.binance.me/',
        ],
        dataDownloadToken: 'download-secret',
        bitboApiKey: 'bitbo-secret',
        marketArchiveRoot: '/var/lib/market-archive',
        debugKlineCache: true,
        redisRestUrl: undefined,
        redisRestToken: undefined,
    });
});

test('readServerEnv normalizes optional blank values without exposing unknown variables', () => {
    const parsed = readServerEnv({
        NODE_ENV: 'test',
        MORALIS_API_KEY: '   ',
        COINALYZE_API_KEY: '',
        DATA_DOWNLOAD_TOKEN: '\t',
        BITBO_API_KEY: '  ',
        MARKET_ARCHIVE_ROOT: '',
        BINANCE_FAPI_BASES: ' , ',
        DEBUG_KLINE_CACHE: '0',
        UNRELATED_VALUE: 'ignored',
    });

    assert.equal(parsed.nodeEnv, 'test');
    assert.equal(parsed.isServerless, false);
    assert.equal(parsed.moralisApiKey, undefined);
    assert.equal(parsed.solanaNetwork, 'mainnet');
    assert.equal(parsed.coinalyzeApiKey, undefined);
    assert.deepEqual(parsed.binanceFapiBases, []);
    assert.equal(parsed.dataDownloadToken, undefined);
    assert.equal(parsed.bitboApiKey, undefined);
    assert.equal(parsed.marketArchiveRoot, undefined);
    assert.equal(parsed.debugKlineCache, false);
    assert.equal('UNRELATED_VALUE' in parsed, false);
    assert.equal('unknownSecret' in parsed, false);
});

test('readServerEnv recognizes each supported serverless runtime marker', () => {
    for (const marker of ['VERCEL', 'AWS_LAMBDA_FUNCTION_NAME', 'SERVERLESS'] as const) {
        assert.equal(readServerEnv({ [marker]: '1' }).isServerless, true, marker);
    }
});

test('readServerEnv rejects an unsupported Solana network with a clear variable name', () => {
    assert.throws(
        () => readServerEnv({ SOLANA_NETWORK: 'mainnet-beta' }),
        /SOLANA_NETWORK.*mainnet.*devnet/i,
    );
});

test('readServerEnv rejects non-HTTPS Binance futures base URLs', () => {
    assert.throws(
        () => readServerEnv({ BINANCE_FAPI_BASES: 'https://fapi.binance.com,http://mirror.example.com' }),
        /BINANCE_FAPI_BASES.*https/i,
    );
});

test('readServerEnv rejects malformed Binance futures base URLs', () => {
    assert.throws(
        () => readServerEnv({ BINANCE_FAPI_BASES: 'not-a-url' }),
        /BINANCE_FAPI_BASES.*https|BINANCE_FAPI_BASES.*URL/i,
    );
});

test('domain env readers do not validate unrelated configuration', () => {
    assert.deepEqual(
        readBinanceEnv({ SOLANA_NETWORK: 'invalid-network' }),
        { binanceFapiBases: [], debugKlineCache: false },
    );
    assert.deepEqual(
        readOnchainEnv({ BINANCE_FAPI_BASES: 'http://invalid.example.com' }),
        { moralisApiKey: undefined, solanaNetwork: 'mainnet' },
    );
    assert.deepEqual(
        readRuntimeEnv({ SOLANA_NETWORK: 'invalid', BINANCE_FAPI_BASES: 'not-a-url' }),
        { nodeEnv: undefined, isServerless: false },
    );
});
