/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseZedAuthMethodId } from './zedIntegration.js';
import type { Agent } from '@vybestack/llxprt-code-agents';

// Mock runtimeSettings to test credential cache clearing logic
const mockGetActiveProfileName = vi.fn<() => string | null>();
const mockLoadProfileByName = vi.fn<(name: string) => Promise<void>>();
vi.mock('@vybestack/llxprt-code-providers/runtime.js', () => ({
  registerAgentRuntimeFactories: vi.fn(),
  resetAgentRuntimeFactories: vi.fn(),
  clearActiveModelParam: vi.fn(),
  getActiveModelParams: vi.fn(),
  getActiveProfileName: (...args: unknown[]) =>
    mockGetActiveProfileName(...(args as [])),
  loadProfileByName: (...args: unknown[]) =>
    mockLoadProfileByName(...(args as [string])),
}));

const mockClearCachedCredentialFile = vi.fn<() => Promise<void>>();
vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    clearCachedCredentialFile: (...args: unknown[]) =>
      mockClearCachedCredentialFile(...(args as [])),
  };
});

describe('zedIntegration auth method validation', () => {
  it('accepts known profile names', () => {
    expect(parseZedAuthMethodId('alpha', ['alpha', 'beta'])).toBe('alpha');
    expect(parseZedAuthMethodId('beta', ['alpha', 'beta'])).toBe('beta');
  });

  it('rejects unknown profile names', () => {
    expect(() => parseZedAuthMethodId('gamma', ['alpha', 'beta'])).toThrow(
      /Invalid enum value/,
    );
  });

  it('rejects selection when no profiles exist', () => {
    expect(() => parseZedAuthMethodId('alpha', [])).toThrow(
      /No profiles available for selection/,
    );
  });
});

describe('ZedAgent.authenticate credential cache', () => {
  // Import dynamically after mocks are set up
  let ZedAgent: typeof import('./zedIntegration.js').ZedAgent;

  beforeAll(async () => {
    const mod = await import('./zedIntegration.js');
    ZedAgent = mod.ZedAgent;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadProfileByName.mockResolvedValue(undefined);
  });

  function createAgent(): InstanceType<typeof ZedAgent> {
    const mockConfig = {
      getProfileManager: () => ({
        listProfiles: async () => ['alpha', 'beta'],
      }),
      getEphemeralSetting: () => undefined,
    };
    const agent = new ZedAgent(
      mockConfig as never,
      { debug: () => {} } as never,
      undefined as never,
    );
    // Stub applyRuntimeProviderOverrides to avoid config dependencies
    vi.spyOn(agent as never, 'applyRuntimeProviderOverrides').mockResolvedValue(
      undefined,
    );
    return agent;
  }

  it('clears credential cache when switching to a different profile', async () => {
    mockGetActiveProfileName.mockReturnValue('alpha');
    mockClearCachedCredentialFile.mockResolvedValue(undefined);

    const agent = createAgent();
    await agent.authenticate({ methodId: 'beta' });

    expect(mockClearCachedCredentialFile).toHaveBeenCalledOnce();
    expect(mockLoadProfileByName).toHaveBeenCalledWith('beta');
  });

  it('does NOT clear credential cache when re-authenticating same profile', async () => {
    mockGetActiveProfileName.mockReturnValue('alpha');
    mockClearCachedCredentialFile.mockResolvedValue(undefined);

    const agent = createAgent();
    await agent.authenticate({ methodId: 'alpha' });

    expect(mockClearCachedCredentialFile).not.toHaveBeenCalled();
    expect(mockLoadProfileByName).toHaveBeenCalledWith('alpha');
  });

  it('clears credential cache when no active profile exists', async () => {
    mockGetActiveProfileName.mockReturnValue(null);
    mockClearCachedCredentialFile.mockResolvedValue(undefined);

    const agent = createAgent();
    await agent.authenticate({ methodId: 'alpha' });

    expect(mockClearCachedCredentialFile).toHaveBeenCalledOnce();
    expect(mockLoadProfileByName).toHaveBeenCalledWith('alpha');
  });
});

describe('Session agent disposal', () => {
  // Import dynamically after mocks are set up
  let Session: typeof import('./zedIntegration.js').Session;

  beforeAll(async () => {
    const mod = await import('./zedIntegration.js');
    Session = mod.Session;
  });

  function createMockAgent(): {
    agent: Agent;
    dispose: ReturnType<typeof vi.fn>;
  } {
    const dispose = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const agent = { dispose } as unknown as Agent;
    return { agent, dispose };
  }

  function createSession(agent: Agent): InstanceType<typeof Session> {
    const mockConfig = {
      getEphemeralSetting: () => undefined,
      getFileSystemService: () => ({}),
      getWorkspaceContext: () => ({
        getDirectories: () => [],
      }),
      getDebugMode: () => false,
    };
    const mockChat = {};
    return new Session(
      'test-session-id',
      mockChat as never,
      mockConfig as never,
      undefined as never,
      agent,
    );
  }

  it('disposes the agent on dispose()', async () => {
    const { agent, dispose } = createMockAgent();
    const session = createSession(agent);

    await session.dispose();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes the todo-update listener on dispose()', async () => {
    const { todoEvents } = await import('@vybestack/llxprt-code-core');
    const { agent } = createMockAgent();
    const before = todoEvents.listenerCount('todo-updated');
    const session = createSession(agent);
    expect(todoEvents.listenerCount('todo-updated')).toBe(before + 1);

    await session.dispose();

    expect(todoEvents.listenerCount('todo-updated')).toBe(before);
  });

  it('guards against double-dispose (calls agent.dispose exactly once)', async () => {
    const { agent, dispose } = createMockAgent();
    const session = createSession(agent);

    await session.dispose();
    await session.dispose();
    await session.dispose();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes all sessions via ZedAgent.disposeAllSessions', async () => {
    const ZedAgentMod = await import('./zedIntegration.js');
    const { agent: agent1, dispose: dispose1 } = createMockAgent();
    const { agent: agent2, dispose: dispose2 } = createMockAgent();

    const mockConfig = {
      getProfileManager: () => ({ listProfiles: async () => [] }),
      getEphemeralSetting: () => undefined,
      getFileSystemService: () => ({}),
      getWorkspaceContext: () => ({ getDirectories: () => [] }),
      getDebugMode: () => false,
    };

    const zedAgent = new ZedAgentMod.ZedAgent(
      mockConfig as never,
      { debug: () => {} } as never,
      undefined as never,
    );

    const session1 = createSession(agent1);
    const session2 = createSession(agent2);
    // Access private sessions map via the same pattern the tests use
    (zedAgent as never as { sessions: Map<string, unknown> }).sessions.set(
      's1',
      session1,
    );
    (zedAgent as never as { sessions: Map<string, unknown> }).sessions.set(
      's2',
      session2,
    );

    await zedAgent.disposeAllSessions();

    expect(dispose1).toHaveBeenCalledTimes(1);
    expect(dispose2).toHaveBeenCalledTimes(1);
  });
});
