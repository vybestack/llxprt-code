/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20270110-ISSUE2378.P01
 * @requirement:REQ-2378-001
 *
 * BEHAVIORAL suite for the foreground-Agent composition helper.
 *
 * #2378 Phase A makes the Agent own the single session MessageBus and
 * Config.initialize: `createForegroundAgent` no longer accepts (or threads) a
 * caller-constructed session bus. It adopts the resolved Config through the
 * public `fromConfig` entrypoint — which builds exactly one bus from the
 * Config's policy engine — and exposes that bus via `agent.getMessageBus()`.
 * These assertions observe the OUTCOME (the exact call shape, the returned
 * instance, cleanup disposal) via public surfaces only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import {
  Config,
  MessageBus,
  PolicyDecision,
} from '@vybestack/llxprt-code-core';
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { Agent, FromConfigOptions } from '@vybestack/llxprt-code-agents';

const { fromConfigMock } = {
  fromConfigMock: vi.fn(),
};

void vi.mock('@vybestack/llxprt-code-agents', () => ({
  fromConfig: fromConfigMock,
}));

import { createForegroundAgent } from './cliAgentBootstrap.js';
import {
  registerCleanup,
  runExitCleanup,
  __resetCleanupStateForTesting,
} from './utils/cleanup.js';

interface FakeAgent {
  dispose: ReturnType<typeof vi.fn>;
  getConfig: () => Config;
  getProvider: () => string | undefined;
  getModel: () => string;
  getMessageBus: () => MessageBus;
}

function makeConfig(
  overrides: {
    provider?: string | undefined;
    model?: string;
    ephemerals?: Record<string, unknown>;
  } = {},
): Fixture {
  const config = new Config({
    cwd: process.cwd(),
    targetDir: process.cwd(),
    debugMode: false,
    question: undefined,
    userMemory: '',
    sessionId: 'foreground-bootstrap-fixture',
    model: overrides.model ?? 'gemini-2.5-pro',
    provider: overrides.provider,
    initialSettings: overrides.ephemerals,
  });
  const settingsService = new SettingsService();
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settingsService.set(key, value);
  const settingsOwner = new SessionSettingsOwner(settingsService);
  settingsOwner.initializeProviderSelection(
    config.getProvider(),
    config.getModel(),
  );
  return { config, settingsService, settingsOwner };
}

interface Fixture {
  config: Config;
  settingsService: SettingsService;
  settingsOwner: SessionSettingsOwner;
}

function makeFakeAgent(config: Config, getBus: () => MessageBus): FakeAgent {
  return {
    dispose: vi.fn().mockResolvedValue(undefined),
    getConfig: () => config,
    getProvider: () => 'gemini',
    getModel: () => 'gemini-2.5-pro',
    getMessageBus: getBus,
  };
}

describe('createForegroundAgent @plan:PLAN-20270110-ISSUE2378.P01 @requirement:REQ-2378-001', () => {
  let config: Config;
  let settingsService: SettingsService;
  let settingsOwner: SessionSettingsOwner;
  let roots: readonly Fixture[] = [];
  let providerManager: ProviderManager;
  let owner: NonNullable<FromConfigOptions['mcpRuntime']>;
  let bus: MessageBus;
  let fakeAgent: FakeAgent;

  function useFixture(overrides: Parameters<typeof makeConfig>[0] = {}): void {
    const root = makeConfig(overrides);
    roots = [...roots, root];
    ({ config, settingsService, settingsOwner } = root);
    providerManager = new ProviderManager({
      settingsService,
    });
    fakeAgent = makeFakeAgent(config, () => bus);
    fromConfigMock.mockImplementation(async (options: FromConfigOptions) => {
      if (!options.mcpRuntime) {
        throw new Error('Foreground Agent must hand off its MCP runtime');
      }
      owner = options.mcpRuntime;
      bus = owner.messageBus;
      return fakeAgent as unknown as Agent;
    });
  }

  beforeEach(() => {
    __resetCleanupStateForTesting();
    fromConfigMock.mockReset();
    useFixture();
  });

  afterEach(async () => {
    await owner.dispose();
    providerManager.dispose();
    for (const root of roots) {
      await root.settingsOwner.dispose();
      await root.config.dispose();
    }
    roots = [];
    __resetCleanupStateForTesting();
    vi.restoreAllMocks();
  });

  it('calls fromConfig exactly once with the existing config and an activation intent, and NO caller messageBus (the Agent owns its bus)', async () => {
    await createForegroundAgent({
      config,
      providerManager,
      settingsService,
      settingsOwner,
    });

    expect(fromConfigMock).toHaveBeenCalledTimes(1);
    const options = fromConfigMock.mock.calls[0][0] as FromConfigOptions;
    expect(options.config).toBe(config);
    expect(options.sessionId).toBe(config.getSessionId());
    expect(options.sessionIdentityOwnership).toBe('config');
    expect(options.mcpOwnership).toBe('agent');
    expect(options.mcpRuntime?.messageBus).toBe(bus);
    options.mcpRuntime?.assertConfig(config, bus);
    // #2378: the foreground helper never threads a caller-constructed bus —
    // fromConfig builds the single session bus from the Config's policy engine.
    expect(options.messageBus).toBeUndefined();
    expect(options.activation).toStrictEqual({
      provider: undefined,
      model: 'gemini-2.5-pro',
      authMode: 'auto',
    });
  });

  it('returns the agent produced by fromConfig and it is disposed on cleanup', async () => {
    const agent = await createForegroundAgent({
      config,
      providerManager,
      settingsService,
      settingsOwner,
    });

    // Observable outcome: the exact fakeAgent instance is returned (not a
    // wrapper), and it is registered for cleanup so runExitCleanup disposes it.
    expect(agent).toBe(fakeAgent as unknown as Agent);
    expect(fakeAgent.dispose).not.toHaveBeenCalled();
    await runExitCleanup();
    expect(fakeAgent.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes the agent on normal exit alongside the interactive UI cleanup', async () => {
    await createForegroundAgent({
      config,
      providerManager,
      settingsService,
      settingsOwner,
    });

    const uiCleanup = vi.fn();
    registerCleanup(uiCleanup);

    expect(fakeAgent.dispose).not.toHaveBeenCalled();

    await runExitCleanup();

    expect(fakeAgent.dispose).toHaveBeenCalledTimes(1);
    expect(uiCleanup).toHaveBeenCalledTimes(1);
  });

  it('disposes the agent when startup is interrupted before the UI registers cleanup', async () => {
    await createForegroundAgent({
      config,
      providerManager,
      settingsService,
      settingsOwner,
    });

    await runExitCleanup();

    expect(fakeAgent.dispose).toHaveBeenCalledTimes(1);
  });

  it('does not register cleanup when fromConfig rejects', async () => {
    const failure = new Error('fromConfig failed');
    fromConfigMock.mockReset();
    fromConfigMock.mockRejectedValue(failure);

    await expect(
      createForegroundAgent({
        config,
        providerManager,
        settingsService,
        settingsOwner,
      }),
    ).rejects.toThrow(failure);

    await runExitCleanup();

    expect(fakeAgent.dispose).not.toHaveBeenCalled();
  });

  it('forwards the exact existing Config to fromConfig (no duplicate runtime construction)', async () => {
    await createForegroundAgent({
      config,
      providerManager,
      settingsService,
      settingsOwner,
    });

    const options = fromConfigMock.mock.calls[0][0] as {
      config: Config;
    };
    expect(options.config).toBe(config);
  });

  it('declares the configured provider and model in the activation intent', async () => {
    useFixture({ provider: 'glm', model: 'glm-4' });
    await createForegroundAgent({
      config,
      providerManager,
      settingsService,
      settingsOwner,
    });

    const options = fromConfigMock.mock.calls[0][0] as {
      activation: { provider?: string; model?: string; authMode: string };
    };
    expect(options.activation).toStrictEqual({
      provider: 'glm',
      model: 'glm-4',
      authMode: 'auto',
    });
  });

  it('omits the model from the intent when the config model is the placeholder', async () => {
    useFixture({ provider: 'glm', model: 'placeholder-model' });
    await createForegroundAgent({
      config,
      providerManager,
      settingsService,
      settingsOwner,
    });

    const options = fromConfigMock.mock.calls[0][0] as {
      activation: { provider?: string; model?: string; authMode: string };
    };
    expect(options.activation).toStrictEqual({
      provider: 'glm',
      authMode: 'auto',
    });
    expect(options.activation).not.toHaveProperty('model');
  });

  it('applies session policy updates through the foreground session owner', async () => {
    await createForegroundAgent({
      config,
      providerManager,
      settingsService,
      settingsOwner,
    });
    expect(
      owner.policyOwner.session.decisions.evaluate('activate_skill', {
        name: 'pr-creator',
      }),
    ).toBe(PolicyDecision.ASK_USER);

    bus.publish({
      type: MessageBusType.UPDATE_POLICY,
      toolName: 'activate_skill',
      persist: false,
    });

    expect(
      owner.policyOwner.session.decisions.evaluate('activate_skill', {
        name: 'pr-creator',
      }),
    ).toBe(PolicyDecision.ALLOW);
    expect(owner.policyOwner.session.decisions.evaluate('ast_edit', {})).toBe(
      PolicyDecision.ASK_USER,
    );
  });
});
