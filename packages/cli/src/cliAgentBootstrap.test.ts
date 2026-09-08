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
  MessageBus,
  PolicyDecision,
  PolicyEngine,
} from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core';
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import type { Agent } from '@vybestack/llxprt-code-agents';

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
  const ephemerals = { ...(overrides.ephemerals ?? {}) };
  const engine = new PolicyEngine({});
  const bus = new MessageBus(engine);
  const config = {
    getPolicyEngine: () => engine,
    getDebugMode: () => false,
    getProvider: () => overrides.provider,
    getModel: () => overrides.model ?? 'gemini-2.5-pro',
    getEphemeralSetting: (key: string) => ephemerals[key],
    setEphemeralSetting: (key: string, value: unknown) => {
      ephemerals[key] = value;
    },
  } as unknown as Config;
  return { config, engine, bus };
}

interface Fixture {
  config: Config;
  engine: PolicyEngine;
  bus: MessageBus;
}

function makeFakeAgent(config: Config, bus: MessageBus): FakeAgent {
  return {
    dispose: vi.fn().mockResolvedValue(undefined),
    getConfig: () => config,
    getProvider: () => 'gemini',
    getModel: () => 'gemini-2.5-pro',
    getMessageBus: () => bus,
  };
}

describe('createForegroundAgent @plan:PLAN-20270110-ISSUE2378.P01 @requirement:REQ-2378-001', () => {
  let config: Config;
  let engine: PolicyEngine;
  let bus: MessageBus;
  let fakeAgent: FakeAgent;

  function useFixture(overrides: Parameters<typeof makeConfig>[0] = {}): void {
    ({ config, engine, bus } = makeConfig(overrides));
    fakeAgent = makeFakeAgent(config, bus);
    fromConfigMock.mockResolvedValue(fakeAgent as unknown as Agent);
  }

  beforeEach(() => {
    __resetCleanupStateForTesting();
    fromConfigMock.mockReset();
    useFixture();
  });

  afterEach(() => {
    __resetCleanupStateForTesting();
    vi.restoreAllMocks();
  });

  it('calls fromConfig exactly once with the existing config and an activation intent, and NO caller messageBus (the Agent owns its bus)', async () => {
    await createForegroundAgent({ config });

    expect(fromConfigMock).toHaveBeenCalledTimes(1);
    const options = fromConfigMock.mock.calls[0][0] as {
      config: Config;
      messageBus?: unknown;
      activation: unknown;
    };
    expect(options.config).toBe(config);
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
    const agent = await createForegroundAgent({ config });

    // Observable outcome: the exact fakeAgent instance is returned (not a
    // wrapper), and it is registered for cleanup so runExitCleanup disposes it.
    expect(agent).toBe(fakeAgent as unknown as Agent);
    expect(fakeAgent.dispose).not.toHaveBeenCalled();
    await runExitCleanup();
    expect(fakeAgent.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes the agent on normal exit alongside the interactive UI cleanup', async () => {
    await createForegroundAgent({ config });

    const uiCleanup = vi.fn();
    registerCleanup(uiCleanup);

    expect(fakeAgent.dispose).not.toHaveBeenCalled();

    await runExitCleanup();

    expect(fakeAgent.dispose).toHaveBeenCalledTimes(1);
    expect(uiCleanup).toHaveBeenCalledTimes(1);
  });

  it('disposes the agent when startup is interrupted before the UI registers cleanup', async () => {
    await createForegroundAgent({ config });

    await runExitCleanup();

    expect(fakeAgent.dispose).toHaveBeenCalledTimes(1);
  });

  it('does not register cleanup when fromConfig rejects', async () => {
    const failure = new Error('fromConfig failed');
    fromConfigMock.mockReset();
    fromConfigMock.mockRejectedValue(failure);

    await expect(createForegroundAgent({ config })).rejects.toThrow(failure);

    await runExitCleanup();

    expect(fakeAgent.dispose).not.toHaveBeenCalled();
  });

  it('forwards the exact existing Config to fromConfig (no duplicate runtime construction)', async () => {
    await createForegroundAgent({ config });

    const options = fromConfigMock.mock.calls[0][0] as {
      config: Config;
    };
    expect(options.config).toBe(config);
  });

  it('declares the configured provider and model in the activation intent', async () => {
    useFixture({ provider: 'glm', model: 'glm-4' });
    await createForegroundAgent({ config });

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
    await createForegroundAgent({ config });

    const options = fromConfigMock.mock.calls[0][0] as {
      activation: { provider?: string; model?: string; authMode: string };
    };
    expect(options.activation).toStrictEqual({
      provider: 'glm',
      authMode: 'auto',
    });
    expect(options.activation).not.toHaveProperty('model');
  });

  it('applies session policy updates from the Agent-owned bus to the Config policy engine', async () => {
    bus.publish({
      type: MessageBusType.UPDATE_POLICY,
      toolName: 'activate_skill',
      persist: false,
    });
    expect(engine.evaluate('activate_skill', { name: 'pr-creator' })).toBe(
      PolicyDecision.ASK_USER,
    );

    await createForegroundAgent({ config });

    bus.publish({
      type: MessageBusType.UPDATE_POLICY,
      toolName: 'activate_skill',
      persist: false,
    });

    expect(engine.evaluate('activate_skill', { name: 'pr-creator' })).toBe(
      PolicyDecision.ALLOW,
    );
    expect(engine.evaluate('ast_edit', {})).toBe(PolicyDecision.ASK_USER);
  });
});
