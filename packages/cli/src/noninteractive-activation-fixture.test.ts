/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { Config, PLACEHOLDER_MODEL } from '@vybestack/llxprt-code-core';
import { buildNonInteractiveActivationIntent } from './__tests__/noninteractive-run-fixture.js';
import { makeBootstrapProfileArgs } from './test-utils/bootstrap-config.js';

const configs: Config[] = [];
function makeConfig(model: string): Config {
  const config = new Config({
    cwd: process.cwd(),
    targetDir: process.cwd(),
    debugMode: false,
    sessionId: crypto.randomUUID(),
    provider: 'openai',
    model,
  });
  configs.push(config);
  return config;
}
describe('noninteractive activation through the production intent builder', () => {
  afterEach(async () => {
    for (const config of configs.splice(0)) await config.dispose();
  });

  it('merges profile and CLI model parameters with CLI precedence', async () => {
    const config = Object.assign(makeConfig('resolved-model'), {
      _cliModelOverride: 'selected-model',
      _profileModelParams: { temperature: 0.3, top_p: 0.8 },
      _cliModelParams: { temperature: 0.7, max_tokens: 42 },
    });
    const intent = await buildNonInteractiveActivationIntent(config);
    expect(intent.modelParams).toStrictEqual({
      temperature: 0.7,
      top_p: 0.8,
      max_tokens: 42,
    });
    expect(intent.model).toBe('selected-model');
  });

  it('retains profile params without reviving profile model selection under a provider override', async () => {
    const config = Object.assign(makeConfig('resolved-model'), {
      _bootstrapArgs: makeBootstrapProfileArgs({
        providerOverride: 'openai',
        modelOverride: 'profile-model',
      }),
      _profileModelParams: { temperature: 0.3 },
      _cliModelParams: { top_p: 0.9 },
    });
    const intent = await buildNonInteractiveActivationIntent(config);
    expect(intent.modelParams).toStrictEqual({ temperature: 0.3, top_p: 0.9 });
    expect(intent.model).toBeUndefined();
  });

  it('does not copy the placeholder config model into activation', async () => {
    const intent = await buildNonInteractiveActivationIntent(
      makeConfig(PLACEHOLDER_MODEL),
    );
    expect(intent.model).toBeUndefined();
    expect(intent).not.toHaveProperty('model');
  });
});
