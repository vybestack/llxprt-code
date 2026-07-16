/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * #2374 round-3 Fix 5 / #2378: these tests assert activateConfiguredProvider's
 * OBSERVABLE CONTRACT (return value: false=non-fatal, true=auth-failed) and the
 * assembled intent as a VALUE (deep-equal on the full intent object), NOT
 * fragmented arg-matching or call counts. The public preflight boundary
 * (preflightAgentActivation) is mocked because activateConfiguredProvider's
 * real job is intent ASSEMBLY + delegation to that agent-bootstrap entrypoint
 * — the CLI no longer imports/executes the runtime activation primitive
 * directly (#2378).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@vybestack/llxprt-code-core';
import type { ProviderActivationIntent } from '@vybestack/llxprt-code-agents';
import type { CliProviderManager } from './cliProviderInit.js';
import type { ParsedCliArgs } from './cliBootstrap.js';

const { preflightAgentActivationMock } = vi.hoisted(() => ({
  preflightAgentActivationMock: vi.fn(),
}));

vi.mock('@vybestack/llxprt-code-agents', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-agents')>();
  return {
    ...actual,
    preflightAgentActivation: preflightAgentActivationMock,
  };
});

import { activateConfiguredProvider } from './cliProviderInit.js';

function makeConfig(
  provider: string | undefined,
  overrides: {
    ephemerals?: Record<string, unknown>;
    model?: string;
    cliModelOverride?: string;
    profileModelParams?: Record<string, unknown>;
    bootstrapArgs?: Record<string, unknown>;
  } = {},
): Config {
  const ephemerals = { ...overrides.ephemerals };
  return {
    getProvider: () => provider,
    getModel: () => overrides.model ?? 'glm-5.2',
    getEphemeralSetting: (key: string) => ephemerals[key],
    setEphemeralSetting: (key: string, value: unknown) => {
      ephemerals[key] = value;
    },
    ...(overrides.cliModelOverride !== undefined
      ? { _cliModelOverride: overrides.cliModelOverride }
      : {}),
    ...(overrides.profileModelParams !== undefined
      ? { _profileModelParams: overrides.profileModelParams }
      : {}),
    ...(overrides.bootstrapArgs !== undefined
      ? { _bootstrapArgs: overrides.bootstrapArgs }
      : {}),
  } as unknown as Config;
}

function makeProviderManager(activeProviderName: string): CliProviderManager {
  return {
    getActiveProviderName: () => activeProviderName,
    getActiveProvider: () => ({
      name: activeProviderName,
    }),
  } as unknown as CliProviderManager;
}

function makeProviderManagerWithNoActive(): CliProviderManager {
  return {
    getActiveProviderName: () => undefined,
    getActiveProvider: () => undefined,
  } as unknown as CliProviderManager;
}

function makeArgs(): ParsedCliArgs {
  return {
    provider: undefined,
  } as unknown as ParsedCliArgs;
}

describe('activateConfiguredProvider (declarative, #2374 round-3 Fix 5)', () => {
  beforeEach(() => {
    preflightAgentActivationMock.mockReset();
    preflightAgentActivationMock.mockResolvedValue({
      authFailed: false,
      infoMessages: [],
    });
  });

  // ── Observable contract: return value ─────────────────────────────────

  it('returns false (non-fatal) when the executor reports authFailed false', async () => {
    preflightAgentActivationMock.mockResolvedValue({
      authFailed: false,
      activeProvider: 'anthropic',
      infoMessages: ['switched'],
    });
    const config = makeConfig('anthropic');
    const providerManager = makeProviderManager('anthropic');

    const failed = await activateConfiguredProvider(
      config,
      providerManager,
      makeArgs(),
    );

    expect(failed.authFailed).toBe(false);
  });

  it('returns true (fatal) when the executor reports authFailed true', async () => {
    preflightAgentActivationMock.mockResolvedValue({
      authFailed: true,
      infoMessages: [],
    });
    const config = makeConfig('anthropic');
    const providerManager = makeProviderManager('anthropic');

    const failed = await activateConfiguredProvider(
      config,
      providerManager,
      makeArgs(),
    );

    expect(failed.authFailed).toBe(true);
  });

  // ── Assembled intent as a VALUE (deep-equal) ──────────────────────────

  it('assembles the intent with a configured provider and no model override', async () => {
    const config = makeConfig('anthropic');
    const providerManager = makeProviderManager('anthropic');

    await activateConfiguredProvider(config, providerManager, makeArgs());

    const intent: ProviderActivationIntent =
      preflightAgentActivationMock.mock.calls[0][1];
    expect(intent).toStrictEqual({
      provider: 'anthropic',
      modelParams: {},
      cliOverrides: {},
      authMode: 'auto',
    });
  });

  it('assembles the intent with defaultProvider when config has no provider but manager has an active provider', async () => {
    const config = makeConfig(undefined);
    const providerManager = makeProviderManager('anthropic');

    await activateConfiguredProvider(config, providerManager, makeArgs());

    const intent: ProviderActivationIntent =
      preflightAgentActivationMock.mock.calls[0][1];
    expect(intent).toStrictEqual({
      defaultProvider: 'anthropic',
      modelParams: {},
      cliOverrides: {},
      authMode: 'auto',
    });
  });

  it('assembles the intent with neither provider nor defaultProvider when unconfigured (#2481)', async () => {
    const config = makeConfig(undefined);
    const providerManager = makeProviderManagerWithNoActive();

    await activateConfiguredProvider(config, providerManager, makeArgs());

    const intent: ProviderActivationIntent =
      preflightAgentActivationMock.mock.calls[0][1];
    expect(intent).toStrictEqual({
      modelParams: {},
      cliOverrides: {},
      authMode: 'auto',
    });
    expect(intent.provider).toBeUndefined();
    expect(intent.defaultProvider).toBeUndefined();
  });

  it('assembles the intent with the CLI model override when present', async () => {
    const config = makeConfig('anthropic', {
      cliModelOverride: 'claude-3.5-sonnet',
    });
    const providerManager = makeProviderManager('anthropic');

    await activateConfiguredProvider(config, providerManager, makeArgs());

    const intent: ProviderActivationIntent =
      preflightAgentActivationMock.mock.calls[0][1];
    expect(intent).toStrictEqual({
      provider: 'anthropic',
      model: 'claude-3.5-sonnet',
      modelParams: {},
      cliOverrides: {},
      authMode: 'auto',
    });
  });

  it('assembles the intent with merged model params and CLI credential overrides', async () => {
    const config = makeConfig('anthropic', {
      profileModelParams: { temperature: 0.2 },
      bootstrapArgs: {
        keyOverride: 'sk-test',
        baseurlOverride: 'https://api.example.com',
      },
    });
    const providerManager = makeProviderManager('anthropic');

    await activateConfiguredProvider(config, providerManager, makeArgs());

    const intent: ProviderActivationIntent =
      preflightAgentActivationMock.mock.calls[0][1];
    expect(intent).toStrictEqual({
      provider: 'anthropic',
      modelParams: { temperature: 0.2 },
      cliOverrides: {
        key: 'sk-test',
        baseUrl: 'https://api.example.com',
      },
      authMode: 'auto',
    });
  });

  // ── Preflight error contract (#2378) ─────────────────────────────────
  //
  // The pre-existing contract (introduced in #2374, preserved by #2378)
  // catches a preflight throw and returns true (auth-failed) so bootstrap does
  // not crash on a synchronous error in the preflight path.

  it('returns true (auth-failed) when the preflight throws, preserving the non-crash contract', async () => {
    preflightAgentActivationMock.mockRejectedValue(
      new Error('preflight blew up'),
    );
    const config = makeConfig('anthropic');
    const providerManager = makeProviderManager('anthropic');

    const failed = await activateConfiguredProvider(
      config,
      providerManager,
      makeArgs(),
    );

    expect(failed.authFailed).toBe(true);
  });
});
