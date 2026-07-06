/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSessionScopedConfig,
  parseZedAuthMethodId,
} from './zedIntegration.js';
import type { Config } from '@vybestack/llxprt-code-core';

const mockFromConfig = vi.hoisted(() => vi.fn());
const mockGetActiveProfileName = vi.fn<() => string | null>();
const mockLoadProfileByName = vi.fn<(name: string) => Promise<void>>();

vi.mock('@vybestack/llxprt-code-agents', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fromConfig: (...args: unknown[]) => mockFromConfig(...args),
  };
});

vi.mock('@vybestack/llxprt-code-providers/runtime.js', () => ({
  registerAgentRuntimeFactories: vi.fn(),
  resetAgentRuntimeFactories: vi.fn(),
  clearActiveModelParam: vi.fn(),
  getActiveModelParams: vi.fn(),
  getActiveProfileName: (...args: unknown[]) =>
    mockGetActiveProfileName(...(args as [])),
  loadProfileByName: (...args: unknown[]) =>
    mockLoadProfileByName(...(args as [string])),
  setCliRuntimeContext: vi.fn(),
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

describe('createSessionScopedConfig', () => {
  it('keeps session-scoped services isolated without mutating the base config', async () => {
    const baseFileSystemService = {
      readTextFile: vi.fn(async (_path: string) => 'base'),
      writeTextFile: vi.fn(async () => undefined),
    };
    const firstFileSystemService = {
      readTextFile: vi.fn(async (_path: string) => 'first'),
      writeTextFile: vi.fn(async () => undefined),
    };
    const secondFileSystemService = {
      readTextFile: vi.fn(async (_path: string) => 'second'),
      writeTextFile: vi.fn(async () => undefined),
    };
    const replacementFileSystemService = {
      readTextFile: vi.fn(async (_path: string) => 'replacement'),
      writeTextFile: vi.fn(async () => undefined),
    };
    const baseProviderManager = { id: 'base' };
    const firstProviderManager = { id: 'first' };
    const secondProviderManager = { id: 'second' };
    const baseConfig = {
      getFileSystemService: () => baseFileSystemService,
      setFileSystemService: vi.fn(),
      getProviderManager: () => baseProviderManager,
      setProviderManager: vi.fn(),
      getTargetDir: () => '/project',
    };

    const firstConfig = createSessionScopedConfig(
      baseConfig as unknown as Config,
      firstFileSystemService,
    );
    const secondConfig = createSessionScopedConfig(
      baseConfig as unknown as Config,
      secondFileSystemService,
    );

    expect(await firstConfig.getFileSystemService().readTextFile('/x')).toBe(
      'first',
    );
    expect(await secondConfig.getFileSystemService().readTextFile('/x')).toBe(
      'second',
    );
    expect(await baseConfig.getFileSystemService().readTextFile('/x')).toBe(
      'base',
    );
    expect(firstConfig.getProviderManager()).toBe(baseProviderManager);
    expect(secondConfig.getProviderManager()).toBe(baseProviderManager);

    firstConfig.setFileSystemService(replacementFileSystemService);
    firstConfig.setProviderManager(firstProviderManager as never);
    secondConfig.setProviderManager(secondProviderManager as never);

    expect(await firstConfig.getFileSystemService().readTextFile('/x')).toBe(
      'replacement',
    );
    expect(await secondConfig.getFileSystemService().readTextFile('/x')).toBe(
      'second',
    );
    expect(firstConfig.getProviderManager()).toBe(firstProviderManager);
    expect(secondConfig.getProviderManager()).toBe(secondProviderManager);
    expect(baseConfig.getProviderManager()).toBe(baseProviderManager);
    expect(baseConfig.setFileSystemService).not.toHaveBeenCalled();
    expect(baseConfig.setProviderManager).not.toHaveBeenCalled();
  });
});

describe('ZedAgent.newSession', () => {
  it('creates independent Agent sessions with session-scoped configs', async () => {
    const capturedConfigs: Config[] = [];
    const capturedOptions: Array<{ config: Config; sessionId?: string }> = [];
    mockFromConfig.mockImplementation(
      async (options: { config: Config; sessionId?: string }) => {
        capturedOptions.push(options);
        capturedConfigs.push(options.config);
        return {
          getApprovalMode: () => 'default',
          setApprovalMode: vi.fn(),
          dispose: vi.fn().mockResolvedValue(undefined),
          async *stream() {},
          tools: { respondToConfirmation: vi.fn() },
        };
      },
    );
    const baseProviderManager = { id: 'base' };
    const firstProviderManager = { id: 'first' };
    const secondProviderManager = { id: 'second' };
    const baseConfig = {
      getFileSystemService: () => ({
        readTextFile: vi.fn(async () => 'base'),
        writeTextFile: vi.fn(async () => undefined),
      }),
      getProviderManager: () => baseProviderManager,
      setProviderManager: vi.fn(),
      getProfileManager: () => undefined,
      getEphemeralSetting: () => undefined,
      getTargetDir: () => '/project',
    } as unknown as Config;
    const connection = {
      readTextFile: vi.fn(async (_params: { sessionId: string }) => ({
        content: 'client',
      })),
      writeTextFile: vi.fn(async () => undefined),
    };
    const mod = await import('./zedIntegration.js');
    const zedAgent = new mod.ZedAgent(
      baseConfig,
      { debug: () => {} } as never,
      connection as never,
    );

    await zedAgent.initialize({
      protocolVersion: '1',
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
    } as never);
    const firstSession = await zedAgent.newSession({
      cwd: '/project/first',
    } as never);
    const secondSession = await zedAgent.newSession({
      cwd: '/project/second',
    } as never);
    expect(capturedOptions).toHaveLength(2);
    expect(capturedOptions[0].sessionId).toBe(firstSession.sessionId);
    expect(capturedOptions[1].sessionId).toBe(secondSession.sessionId);
    expect(capturedOptions[0].sessionId).not.toBe(capturedOptions[1].sessionId);
    expect(capturedConfigs[0].getProviderManager()).toBe(baseProviderManager);
    expect(capturedConfigs[1].getProviderManager()).toBe(baseProviderManager);
    capturedConfigs[0].setProviderManager(firstProviderManager as never);
    capturedConfigs[1].setProviderManager(secondProviderManager as never);

    expect(capturedConfigs).toHaveLength(2);
    expect(capturedConfigs[0]).not.toBe(capturedConfigs[1]);
    expect(capturedConfigs[0].getTargetDir()).toBe('/project/first');
    expect(capturedConfigs[1].getTargetDir()).toBe('/project/second');
    expect(capturedConfigs[0].getProviderManager()).toBe(firstProviderManager);
    expect(capturedConfigs[1].getProviderManager()).toBe(secondProviderManager);
    expect(baseConfig.getProviderManager()).toBe(baseProviderManager);
    expect(baseConfig.setProviderManager).not.toHaveBeenCalled();
    expect(
      await capturedConfigs[0].getFileSystemService().readTextFile('/x'),
    ).toBe('client');
    expect(
      await capturedConfigs[1].getFileSystemService().readTextFile('/x'),
    ).toBe('client');
    const firstRead = connection.readTextFile.mock.calls[0];
    const secondRead = connection.readTextFile.mock.calls[1];
    expect(firstRead).toBeDefined();
    expect(secondRead).toBeDefined();
    expect(firstRead[0].sessionId).not.toBe(secondRead[0].sessionId);
  });
});

describe('ZedAgent.authenticate credential cache', () => {
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
    return new ZedAgent(
      mockConfig as never,
      { debug: () => {} } as never,
      undefined as never,
    );
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
