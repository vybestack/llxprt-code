/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { getTokenLimitForConfiguredContext } from './contextLimitResolver.js';

/**
 * Minimal Config double. Only the members read by the resolver are provided;
 * missing members (e.g. getContentGeneratorConfig on the model-only case) are
 * intentionally absent so the provider-limit branch safely short-circuits via
 * its try/catch.
 */
function makeConfig(opts: {
  model?: string;
  contextLimit?: number;
  providerContextLimit?: number;
}): Config {
  const config: Record<string, unknown> = {
    getModel: () => opts.model ?? 'gpt-4o',
    getEphemeralSetting: (key: string) =>
      key === 'context-limit' ? opts.contextLimit : undefined,
  };
  if (opts.providerContextLimit !== undefined) {
    config.getContentGeneratorConfig = () => ({
      providerManager: {
        getActiveProvider: () => ({
          getContextLimit: () => opts.providerContextLimit,
        }),
      },
    });
  }
  return config as unknown as Config;
}

describe('getTokenLimitForConfiguredContext', () => {
  it('uses an explicit user context-limit override over the provider limit', () => {
    const config = makeConfig({
      model: 'load-balancer',
      contextLimit: 50_000,
      providerContextLimit: 200_000,
    });

    expect(getTokenLimitForConfiguredContext('load-balancer', config)).toBe(
      50_000,
    );
  });

  it('uses the provider-derived limit when no user override is set', () => {
    const config = makeConfig({
      model: 'load-balancer',
      providerContextLimit: 200_000,
    });

    expect(getTokenLimitForConfiguredContext('load-balancer', config)).toBe(
      200_000,
    );
  });

  it('falls back to the model-name window when neither override nor provider limit is set', () => {
    const config = makeConfig({ model: 'gpt-4o' });

    // gpt-4o resolves to 128K, distinct from DEFAULT_TOKEN_LIMIT (1M), so the
    // model-lookup path is genuinely exercised rather than coincidental.
    expect(getTokenLimitForConfiguredContext('gpt-4o', config)).toBe(128_000);
  });

  it('returns DEFAULT_TOKEN_LIMIT for an unrecognized model with no overrides', () => {
    const config = makeConfig({ model: 'load-balancer' });

    expect(
      getTokenLimitForConfiguredContext('load-balancer', config),
    ).toBeGreaterThanOrEqual(1_000_000);
  });

  it('ignores a non-positive provider limit and falls back to the model lookup', () => {
    const config = makeConfig({ model: 'gpt-4o', providerContextLimit: 0 });

    expect(getTokenLimitForConfiguredContext('gpt-4o', config)).toBe(128_000);
  });
});
