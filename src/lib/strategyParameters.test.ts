import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
    BASELINE_STRATEGY_PARAMETER_CONFIGS,
    buildStrategyParameterCandidates,
    getAllStrategyParameterConfigs,
    getStrategyParameterConfig,
    resetStrategyParameterOverrides,
    withStrategyParameterOverrides,
} from './strategyParameters.ts';

beforeEach(() => {
    resetStrategyParameterOverrides();
});

test('shared strategy parameter defaults stay aligned with the baseline snapshot', () => {
    assert.deepEqual(getAllStrategyParameterConfigs(), BASELINE_STRATEGY_PARAMETER_CONFIGS);
});

test('candidate presets are generated for every strategy', () => {
    const strategyIds = Object.keys(BASELINE_STRATEGY_PARAMETER_CONFIGS);

    strategyIds.forEach((strategyId) => {
        const candidates = buildStrategyParameterCandidates(strategyId as keyof typeof BASELINE_STRATEGY_PARAMETER_CONFIGS);
        assert.equal(candidates.length, 2);
        candidates.forEach((candidate) => {
            assert.ok(candidate.id.length > 0);
            assert.ok(candidate.label.length > 0);
            assert.ok(candidate.overrides[strategyId as keyof typeof candidate.overrides]);
        });
    });
});

test('withStrategyParameterOverrides keeps overrides active for async tasks', async () => {
    const baselineEnabled = getStrategyParameterConfig('trend-confirmation').betaFilter.enabled;
    assert.equal(baselineEnabled, false);

    const activeValue = await withStrategyParameterOverrides({
        'trend-confirmation': {
            betaFilter: {
                enabled: true,
            },
        },
    }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return getStrategyParameterConfig('trend-confirmation').betaFilter.enabled;
    });

    assert.equal(activeValue, true);
    assert.equal(getStrategyParameterConfig('trend-confirmation').betaFilter.enabled, false);
});
