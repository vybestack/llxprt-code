/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Config, MessageBus } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';

const { fromConfigMock, switchActiveProviderMock, setActiveModelMock } =
  vi.hoisted(() => ({
    fromConfigMock: vi.fn(),
    switchActiveProviderMock: vi.fn().mockResolvedValue(undefined),
    setActiveModelMock: vi.fn().mockResolvedValue(undefined),
  }));

vi.mock('@vybestack/llxprt-code-agents', () => ({
  fromConfig: fromConfigMock,
}));

vi.mock('@vybestack/llxprt-code-providers/runtime.js', () => ({
  switchActiveProvider: switchActiveProviderMock,
  setActiveModel: setActiveModelMock,
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
  overrides: { provider?: string | undefined; model?: string } = {},
): Config {
  return {
    getPolicyEngine: () => null,
    getDebugMode: () => false,
    getProvider: () => overrides.provider,
    getModel: () => overrides.model ?? 'gemini-2.5-pro',
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
    switchActiveProviderMock.mockReset();
    switchActiveProviderMock.mockResolvedValue(undefined);
    setActiveModelMock.mockReset();
    setActiveModelMock.mockResolvedValue(undefined);
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

  it('calls fromConfig exactly once with the existing config and sessionMessageBus', async () => {
    await createForegroundAgent({ config, sessionMessageBus });

    expect(fromConfigMock).toHaveBeenCalledTimes(1);
    const options = fromConfigMock.mock.calls[0][0] as {
      config: Config;
      messageBus: MessageBus;
    };
    expect(options.config).toBe(config);
    expect(options.messageBus).toBe(sessionMessageBus);
  });

  it('returns the agent produced by fromConfig', async () => {
    const agent = await createForegroundAgent({ config, sessionMessageBus });

    expect(agent).toBe(fakeAgent as unknown as Agent);
  });

  it('disposes the agent on normal exit alongside the interactive UI cleanup', async () => {
    await createForegroundAgent({ config, sessionMessageBus });

    // Mirror the real startup flow: after the agent is created, the interactive
    // UI registers its own teardown. Both cleanups must run on a normal exit.
    const uiCleanup = vi.fn();
    registerCleanup(uiCleanup);

    expect(fakeAgent.dispose).not.toHaveBeenCalled();

    await runExitCleanup();

    expect(fakeAgent.dispose).toHaveBeenCalledTimes(1);
    expect(uiCleanup).toHaveBeenCalledTimes(1);
  });

  it('disposes the agent when startup is interrupted before the UI registers cleanup', async () => {
    await createForegroundAgent({ config, sessionMessageBus });

    // Fatal/interrupted startup: the exit cleanup fires before the interactive
    // UI ever mounts, so the agent's cleanup is the only one registered.
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

    // No agent was produced, so no disposal cleanup should have been queued.
    await runExitCleanup();

    expect(fakeAgent.dispose).not.toHaveBeenCalled();
  });

  // Note: the caller-owned Config contract (agent.dispose() must NOT tear down
  // a fromConfig-supplied Config) is owned and verified by the agents package
  // against the real fromConfig/dispose flow — see
  // packages/agents/src/api/__tests__/fromConfig.behavior.test.ts (T7/T7b).
  // Asserting it here, where fromConfig is mocked, would be mock theater.

  it('forwards the exact existing instances to fromConfig (no duplicate runtime construction)', async () => {
    await createForegroundAgent({ config, sessionMessageBus });

    const options = fromConfigMock.mock.calls[0][0] as {
      config: Config;
      messageBus: MessageBus;
    };
    // Identity equality proves we adopt rather than reconstruct the runtime.
    expect(options.config).toBe(config);
    expect(options.messageBus).toBe(sessionMessageBus);
    expect(Object.keys(options)).toStrictEqual(['config', 'messageBus']);
  });

  it('re-activates the configured provider after fromConfig resets it', async () => {
    config = makeConfig({ provider: 'glm', model: 'glm-4' });
    await createForegroundAgent({ config, sessionMessageBus });

    // fromConfig → activate() resets the active provider; the fix
    // re-activates the profile-loaded provider so the status bar is correct.
    expect(switchActiveProviderMock).toHaveBeenCalledWith('glm');
    expect(setActiveModelMock).toHaveBeenCalledWith('glm-4');
  });

  it('does not call setActiveModel when model is placeholder-model', async () => {
    config = makeConfig({ provider: 'glm', model: 'placeholder-model' });
    await createForegroundAgent({ config, sessionMessageBus });

    expect(switchActiveProviderMock).toHaveBeenCalledWith('glm');
    expect(setActiveModelMock).not.toHaveBeenCalled();
  });

  it('falls back to agent provider when config has none', async () => {
    config = makeConfig({ provider: undefined, model: 'gemini-2.5-pro' });
    fakeAgent.getProvider = () => 'ollama';
    await createForegroundAgent({ config, sessionMessageBus });

    expect(switchActiveProviderMock).toHaveBeenCalledWith('ollama');
    expect(setActiveModelMock).toHaveBeenCalledWith('gemini-2.5-pro');
  });
});
