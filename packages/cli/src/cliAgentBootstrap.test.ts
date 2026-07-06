/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Config, MessageBus } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';

const { fromConfigMock } = vi.hoisted(() => ({
  fromConfigMock: vi.fn(),
}));

vi.mock('@vybestack/llxprt-code-agents', () => ({
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
}

function makeConfig(
  overrides: {
    provider?: string | undefined;
    model?: string;
    ephemerals?: Record<string, unknown>;
  } = {},
): Config {
  const ephemerals = { ...(overrides.ephemerals ?? {}) };
  return {
    getPolicyEngine: () => null,
    getDebugMode: () => false,
    getProvider: () => overrides.provider,
    getModel: () => overrides.model ?? 'gemini-2.5-pro',
    getEphemeralSetting: (key: string) => ephemerals[key],
    setEphemeralSetting: (key: string, value: unknown) => {
      ephemerals[key] = value;
    },
  } as unknown as Config;
}

function makeMessageBus(): MessageBus {
  return {
    publish: vi.fn(),
    subscribe: vi.fn(),
  } as unknown as MessageBus;
}

describe('createForegroundAgent', () => {
  let config: Config;
  let sessionMessageBus: MessageBus;
  let fakeAgent: FakeAgent;

  beforeEach(() => {
    __resetCleanupStateForTesting();
    fromConfigMock.mockReset();
    config = makeConfig();
    sessionMessageBus = makeMessageBus();
    fakeAgent = {
      dispose: vi.fn().mockResolvedValue(undefined),
      getConfig: () => config,
      getProvider: () => 'gemini',
      getModel: () => 'gemini-2.5-pro',
    };
    fromConfigMock.mockResolvedValue(fakeAgent as unknown as Agent);
  });

  afterEach(() => {
    __resetCleanupStateForTesting();
    vi.restoreAllMocks();
  });

  it('calls fromConfig exactly once with the existing config, sessionMessageBus, and an activation intent', async () => {
    await createForegroundAgent({ config, sessionMessageBus });

    expect(fromConfigMock).toHaveBeenCalledTimes(1);
    const options = fromConfigMock.mock.calls[0][0] as {
      config: Config;
      messageBus: MessageBus;
      activation: unknown;
    };
    expect(options.config).toBe(config);
    expect(options.messageBus).toBe(sessionMessageBus);
    expect(options.activation).toStrictEqual({
      provider: undefined,
      model: 'gemini-2.5-pro',
      authMode: 'auto',
    });
  });

  it('returns the agent produced by fromConfig and it is disposed on cleanup', async () => {
    const agent = await createForegroundAgent({ config, sessionMessageBus });

    // Observable outcome: the exact fakeAgent instance is returned (not a
    // wrapper), and it is registered for cleanup so runExitCleanup disposes it.
    expect(agent).toBe(fakeAgent as unknown as Agent);
    expect(fakeAgent.dispose).not.toHaveBeenCalled();
    await runExitCleanup();
    expect(fakeAgent.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes the agent on normal exit alongside the interactive UI cleanup', async () => {
    await createForegroundAgent({ config, sessionMessageBus });

    const uiCleanup = vi.fn();
    registerCleanup(uiCleanup);

    expect(fakeAgent.dispose).not.toHaveBeenCalled();

    await runExitCleanup();

    expect(fakeAgent.dispose).toHaveBeenCalledTimes(1);
    expect(uiCleanup).toHaveBeenCalledTimes(1);
  });

  it('disposes the agent when startup is interrupted before the UI registers cleanup', async () => {
    await createForegroundAgent({ config, sessionMessageBus });

    await runExitCleanup();

    expect(fakeAgent.dispose).toHaveBeenCalledTimes(1);
  });

  it('does not register cleanup when fromConfig rejects', async () => {
    const failure = new Error('fromConfig failed');
    fromConfigMock.mockReset();
    fromConfigMock.mockRejectedValue(failure);

    await expect(
      createForegroundAgent({ config, sessionMessageBus }),
    ).rejects.toThrow(failure);

    await runExitCleanup();

    expect(fakeAgent.dispose).not.toHaveBeenCalled();
  });

  it('forwards the exact existing instances to fromConfig (no duplicate runtime construction)', async () => {
    await createForegroundAgent({ config, sessionMessageBus });

    const options = fromConfigMock.mock.calls[0][0] as {
      config: Config;
      messageBus: MessageBus;
    };
    expect(options.config).toBe(config);
    expect(options.messageBus).toBe(sessionMessageBus);
  });

  it('declares the configured provider and model in the activation intent', async () => {
    config = makeConfig({ provider: 'glm', model: 'glm-4' });
    await createForegroundAgent({ config, sessionMessageBus });

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
    config = makeConfig({ provider: 'glm', model: 'placeholder-model' });
    await createForegroundAgent({ config, sessionMessageBus });

    const options = fromConfigMock.mock.calls[0][0] as {
      activation: { provider?: string; model?: string; authMode: string };
    };
    expect(options.activation).toStrictEqual({
      provider: 'glm',
      authMode: 'auto',
    });
    expect(options.activation).not.toHaveProperty('model');
  });
});
