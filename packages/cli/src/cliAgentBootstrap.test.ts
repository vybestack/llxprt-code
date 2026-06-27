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
  runExitCleanup,
  __resetCleanupStateForTesting,
} from './utils/cleanup.js';

interface FakeAgent {
  dispose: ReturnType<typeof vi.fn>;
  getConfig: () => Config;
}

function makeConfig(overrides: Partial<Record<string, unknown>> = {}): Config {
  return {
    getPolicyEngine: () => null,
    getDebugMode: () => false,
    ...overrides,
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

  it('registers a cleanup that disposes the agent on normal exit', async () => {
    await createForegroundAgent({ config, sessionMessageBus });

    expect(fakeAgent.dispose).not.toHaveBeenCalled();

    await runExitCleanup();

    expect(fakeAgent.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes the agent when startup is interrupted before the UI renders', async () => {
    await createForegroundAgent({ config, sessionMessageBus });

    // Simulate an interrupted/fatal startup path that runs cleanup directly,
    // before any interactive UI cleanup is registered.
    await runExitCleanup();

    expect(fakeAgent.dispose).toHaveBeenCalledTimes(1);
  });

  it('does not tear down the caller-owned config when disposing the agent', async () => {
    const dispose = vi.fn();
    config = makeConfig({ dispose });
    fakeAgent.getConfig = () => config;

    await createForegroundAgent({ config, sessionMessageBus });
    await runExitCleanup();

    expect(dispose).not.toHaveBeenCalled();
  });

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
});
