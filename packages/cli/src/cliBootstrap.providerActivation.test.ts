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
 * (preflight) is mocked because activateConfiguredProvider's
 * real job is intent ASSEMBLY + delegation to that agent-bootstrap entrypoint
 * — the CLI no longer imports/executes the runtime activation primitive
 * directly (#2378).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core';
import { createProviderSessionOwner } from './integration-tests/__tests__/session-client-owner-fixture.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ProviderActivationIntent } from '@vybestack/llxprt-code-agents';
import type { ParsedCliArgs } from './cliBootstrap.js';

const { preflightMock } = {
  preflightMock: vi.fn(),
};

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
  const config = new Config({
    sessionId: crypto.randomUUID(),
    cwd: process.cwd(),
    targetDir: process.cwd(),
    debugMode: false,
    model: overrides.model ?? 'glm-5.2',
  });
  return Object.assign(config, {
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
  });
}

let managers: ProviderManager[] = [];
function makeProviderManager(activeProviderName: string): {
  providerManager: ProviderManager;
  settingsService: SettingsService;
} {
  const settingsService = new SettingsService();
  const manager = new ProviderManager({
    settingsService,
  });
  managers.push(manager);
  return {
    providerManager: Object.assign(manager, {
      getActiveProviderName: () => activeProviderName,
    }),
    settingsService,
  };
}
function makeProviderManagerWithNoActive(): {
  providerManager: ProviderManager;
  settingsService: SettingsService;
} {
  const settingsService = new SettingsService();
  const manager = new ProviderManager({
    settingsService,
  });
  managers.push(manager);
  return { providerManager: manager, settingsService };
}
function makeOperation(
  config: Config,
  manager: ProviderManager,
  settingsService: SettingsService,
) {
  const operation = createProviderSessionOwner(
    config,
    manager,
    settingsService,
  );
  return {
    preflight: preflightMock,
    workspaceDefinitions: operation.workspaceDefinitions,
    workspaceTrust: operation.workspaceTrust,
    trustCleanup: operation.trustCleanup,
    workspaceMemory: operation.workspaceMemory,
    workspaceMemoryOwnership: operation.workspaceMemoryOwnership,
    workspaceFilesystem: operation.workspaceFilesystem,
    sessionClient: operation.sessionClient,
    takeMediaOwner: operation.takeMediaOwner.bind(operation),
    settingsOwnerOwnership: operation.settingsOwnerOwnership,
    takeSettingsOwner: operation.takeSettingsOwner.bind(operation),
    takeSessionClient: operation.takeSessionClient.bind(operation),
    dispose: () => operation.dispose(),
  };
}

function makeArgs(): ParsedCliArgs {
  return {
    provider: undefined,
  } as unknown as ParsedCliArgs;
}

describe('activateConfiguredProvider (declarative, #2374 round-3 Fix 5)', () => {
  afterEach(() => {
    for (const manager of managers) manager.dispose();
    managers = [];
  });

  beforeEach(() => {
    preflightMock.mockReset();
    preflightMock.mockResolvedValue({
      authFailed: false,
      infoMessages: [],
    });
  });

  // ── Observable contract: return value ─────────────────────────────────

  it('returns false (non-fatal) when the executor reports authFailed false', async () => {
    preflightMock.mockResolvedValue({
      authFailed: false,
      activeProvider: 'anthropic',
      infoMessages: ['switched'],
    });
    const config = makeConfig('anthropic');
    const { providerManager, settingsService } =
      makeProviderManager('anthropic');

    const failed = await activateConfiguredProvider(
      config,
      providerManager,
      makeArgs(),
      makeOperation(config, providerManager, settingsService),
    );

    expect(failed.authFailed).toBe(false);
  });

  it('returns true (fatal) when the executor reports authFailed true', async () => {
    preflightMock.mockResolvedValue({
      authFailed: true,
      infoMessages: [],
    });
    const config = makeConfig('anthropic');
    const { providerManager, settingsService } =
      makeProviderManager('anthropic');

    const failed = await activateConfiguredProvider(
      config,
      providerManager,
      makeArgs(),
      makeOperation(config, providerManager, settingsService),
    );

    expect(failed.authFailed).toBe(true);
  });

  // ── Assembled intent as a VALUE (deep-equal) ──────────────────────────

  it('assembles the intent with a configured provider and no model override', async () => {
    const config = makeConfig('anthropic');
    const { providerManager, settingsService } =
      makeProviderManager('anthropic');

    await activateConfiguredProvider(
      config,
      providerManager,
      makeArgs(),
      makeOperation(config, providerManager, settingsService),
    );

    const intent: ProviderActivationIntent = preflightMock.mock.calls[0][0];
    expect(intent).toStrictEqual({
      provider: 'anthropic',
      modelParams: {},
      cliOverrides: {},
      authMode: 'auto',
    });
  });

  it('assembles the intent with defaultProvider when config has no provider but manager has an active provider', async () => {
    const config = makeConfig(undefined);
    const { providerManager, settingsService } =
      makeProviderManager('anthropic');

    await activateConfiguredProvider(
      config,
      providerManager,
      makeArgs(),
      makeOperation(config, providerManager, settingsService),
    );

    const intent: ProviderActivationIntent = preflightMock.mock.calls[0][0];
    expect(intent).toStrictEqual({
      defaultProvider: 'anthropic',
      modelParams: {},
      cliOverrides: {},
      authMode: 'auto',
    });
  });

  it('assembles the intent with neither provider nor defaultProvider when unconfigured (#2481)', async () => {
    const config = makeConfig(undefined);
    const { providerManager, settingsService } =
      makeProviderManagerWithNoActive();

    await activateConfiguredProvider(
      config,
      providerManager,
      makeArgs(),
      makeOperation(config, providerManager, settingsService),
    );

    const intent: ProviderActivationIntent = preflightMock.mock.calls[0][0];
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
    const { providerManager, settingsService } =
      makeProviderManager('anthropic');

    await activateConfiguredProvider(
      config,
      providerManager,
      makeArgs(),
      makeOperation(config, providerManager, settingsService),
    );

    const intent: ProviderActivationIntent = preflightMock.mock.calls[0][0];
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
    const { providerManager, settingsService } =
      makeProviderManager('anthropic');

    await activateConfiguredProvider(
      config,
      providerManager,
      makeArgs(),
      makeOperation(config, providerManager, settingsService),
    );

    const intent: ProviderActivationIntent = preflightMock.mock.calls[0][0];
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
    preflightMock.mockRejectedValue(new Error('preflight blew up'));
    const config = makeConfig('anthropic');
    const { providerManager, settingsService } =
      makeProviderManager('anthropic');

    const failed = await activateConfiguredProvider(
      config,
      providerManager,
      makeArgs(),
      makeOperation(config, providerManager, settingsService),
    );

    expect(failed.authFailed).toBe(true);
  });
});
