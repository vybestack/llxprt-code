/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test';
import {
  createSessionScopedConfig,
  parseZedAuthMethodId,
} from './zedIntegration.js';
import type {
  Config,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';

const mockFromConfig = vi.fn();
const mockLoadProfileByName = vi.fn<(name: string) => Promise<void>>();

const actual = { ...(await import('@vybestack/llxprt-code-agents')) };
void vi.mock('@vybestack/llxprt-code-agents', () => {
  return {
    ...actual,
    fromConfig: (...args: unknown[]) => mockFromConfig(...args),
  };
});

void vi.mock('@vybestack/llxprt-code-providers/runtime.js', () => ({
  registerAgentRuntimeFactories: vi.fn(),
  resetAgentRuntimeFactories: vi.fn(),
  clearActiveModelParam: vi.fn(),
  getActiveModelParams: vi.fn(),
  loadProfileByName: (...args: unknown[]) =>
    mockLoadProfileByName(...(args as [string])),
  setCliRuntimeContext: vi.fn(),
}));

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
    // Minimal stand-ins; Config's getters type them as RuntimeProviderManager.
    const baseProviderManager = {
      id: 'base',
    } as unknown as RuntimeProviderManager;
    const firstProviderManager = {
      id: 'first',
    } as unknown as RuntimeProviderManager;
    const secondProviderManager = {
      id: 'second',
    } as unknown as RuntimeProviderManager;
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

  it('reconciles direct property set with getter closures so fileSystemService and providerManager stay in sync', () => {
    const baseFileSystemService = {
      readTextFile: vi.fn(async () => 'base'),
      writeTextFile: vi.fn(async () => undefined),
    };
    const replacementFileSystemService = {
      readTextFile: vi.fn(async () => 'replacement'),
      writeTextFile: vi.fn(async () => undefined),
    };
    // Minimal stand-ins; Config's getters type them as RuntimeProviderManager.
    const baseProviderManager = {
      id: 'base',
    } as unknown as RuntimeProviderManager;
    const replacementProviderManager = {
      id: 'replacement',
    } as unknown as RuntimeProviderManager;
    const baseConfig = {
      getFileSystemService: () => baseFileSystemService,
      setFileSystemService: vi.fn(),
      getProviderManager: () => baseProviderManager,
      setProviderManager: vi.fn(),
      getTargetDir: () => '/project',
    } as unknown as Config;

    const scoped = createSessionScopedConfig(
      baseConfig as unknown as Config,
      baseFileSystemService,
    );

    // Direct property assignment (the `set` trap) must update the same backing
    // store the getter closures read from, so getFileSystemService and
    // config.fileSystemService = X are reconciled.
    (scoped as unknown as Record<string, unknown>).fileSystemService =
      replacementFileSystemService;
    expect(scoped.getFileSystemService()).toBe(replacementFileSystemService);

    (scoped as unknown as Record<string, unknown>).providerManager =
      replacementProviderManager;
    expect(scoped.getProviderManager()).toBe(replacementProviderManager);
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
    // Minimal stand-ins; Config's getters type them as RuntimeProviderManager.
    const baseProviderManager = {
      id: 'base',
    } as unknown as RuntimeProviderManager;
    const firstProviderManager = {
      id: 'first',
    } as unknown as RuntimeProviderManager;
    const secondProviderManager = {
      id: 'second',
    } as unknown as RuntimeProviderManager;
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
      getSessionRecordingService: () => undefined,
    } as unknown as Config;
    const connection = {
      readTextFile: vi.fn(async (_params: { sessionId: string }) => ({
        content: 'client',
      })),
      writeTextFile: vi.fn(async () => undefined),
      sessionUpdate: vi.fn(async () => undefined),
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

  it('loads profile when switching to a different profile', async () => {
    const agent = createAgent();
    await agent.authenticate({ methodId: 'beta' });

    expect(mockLoadProfileByName).toHaveBeenCalledWith('beta');
  });

  it('loads profile when re-authenticating same profile', async () => {
    const agent = createAgent();
    await agent.authenticate({ methodId: 'alpha' });

    expect(mockLoadProfileByName).toHaveBeenCalledWith('alpha');
  });

  it('loads profile when no active profile exists', async () => {
    const agent = createAgent();
    await agent.authenticate({ methodId: 'alpha' });

    expect(mockLoadProfileByName).toHaveBeenCalledWith('alpha');
  });
});
