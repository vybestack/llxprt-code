/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import type {
  Config,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
const retainedActivationOperations: Array<{ dispose(): void | Promise<void> }> =
  [];

const retainedSettingsOwners: SessionSettingsOwner[] = [];

/**
 * @plan:PLAN-20260603-ISSUE1584.P13
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-18
 */

/**
 * Task 1.7 – End-to-end provider/profile/override ordering parity test
 *
 * Verifies provider/profile/override ordering through loadCliConfig and
 * checks that post-Config runtime assembly binds its manager and bus to Config.
 */

import { restoreEnv, setEnv } from '@vybestack/llxprt-code-test-utils';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import * as os from 'node:os';
import * as path from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { loadCliConfig } from '../config.js';
import { parseArguments } from '../cliArgParser.js';
import type { Settings } from '../settings.js';
import { ExtensionStorage } from '../extension.js';
import { ExtensionEnablementManager } from '../extensions/extensionEnablement.js';
import {
  loadPrecedenceProviderContributions,
  registerPrecedenceProviders,
} from './precedenceProviderContributions.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const realTrustedFoldersModule = { ...(await import('../trustedFolders.js')) };
const realLlxprtCodeCoreModule = {
  ...(await import('@vybestack/llxprt-code-core')),
};

void vi.mock('../trustedFolders.js', () => {
  const actual = realTrustedFoldersModule;
  return { ...actual, isWorkspaceTrusted: vi.fn().mockReturnValue(true) };
});

void vi.mock('../sandboxConfig.js', () => ({
  loadSandboxConfig: vi.fn().mockResolvedValue(undefined),
}));

const pathMod = await import('node:path');
const actualFs = { ...(await import('fs')) };
void vi.mock('fs', () => {
  const MOCK_CWD = pathMod.resolve(pathMod.sep, 'home', 'user', 'project');
  const mockPaths = new Set([MOCK_CWD, process.cwd()]);
  return {
    ...actualFs,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(
      (p) => mockPaths.has(p.toString()) || actualFs.existsSync(p),
    ),
    statSync: vi.fn((p) => {
      if (mockPaths.has(p.toString())) return actualFs.statSync(process.cwd());
      return actualFs.statSync(p.toString());
    }),
    realpathSync: vi.fn((p) => p),
  };
});

const actualOs = { ...(await import('os')) };
void vi.mock('os', () => ({
  ...actualOs,
  homedir: vi.fn(() => path.resolve(path.sep, 'mock', 'home', 'user')),
}));

void vi.mock('open', () => ({ default: vi.fn() }));
void vi.mock('read-package-up', () => ({
  readPackageUp: vi.fn(() =>
    Promise.resolve({ packageJson: { version: 'test-version' } }),
  ),
}));

void vi.mock('@vybestack/llxprt-code-core', () => {
  const actual = realLlxprtCodeCoreModule;
  return {
    ...actual,
    IdeClient: {
      getInstance: vi.fn().mockResolvedValue({
        getConnectionStatus: vi.fn(),
        initialize: vi.fn(),
        shutdown: vi.fn(),
      }),
    },
    loadEnvironment: vi.fn(),
    loadServerHierarchicalMemory: vi.fn().mockResolvedValue({
      memoryContent: '',
      fileCount: 0,
      filePaths: [],
    }),
    DEFAULT_MEMORY_FILE_FILTERING_OPTIONS: {
      respectGitIgnore: false,
      respectLlxprtIgnore: true,
    },
    DEFAULT_FILE_FILTERING_OPTIONS: {
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    },
    isRipgrepAvailable: vi.fn().mockResolvedValue(true),
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeExtMgr(): ExtensionEnablementManager {
  return new ExtensionEnablementManager(
    ExtensionStorage.getUserExtensionsDir(),
  );
}

async function runConfig(
  settings: Settings,
  argv: string[] = [],
): Promise<{
  config: Config;
  settingsOwner: SessionSettingsOwner;
  oauthManager: OAuthManager | undefined;
  providerManager: RuntimeProviderManager;
  callLog: string[];
}> {
  process.argv = ['node', 'script.js', ...argv];
  const parsedArgv = await parseArguments(settings);
  const runtimeSettingsService = new SettingsService();
  const settingsOwner = new SessionSettingsOwner(runtimeSettingsService);
  retainedSettingsOwners.push(settingsOwner);
  let oauthManager: OAuthManager | undefined;
  let providerManager: RuntimeProviderManager | undefined;
  const callLog: string[] = [];
  const switchErrors: unknown[] = [];
  const config = await loadCliConfig(
    settings,
    [],
    makeExtMgr(),
    'test-session',
    parsedArgv,
    undefined,
    {
      credentialAuthority: new CredentialAuthority(),
      settingsService: runtimeSettingsService,
      sessionSettingsOwner: settingsOwner,
      onActivationBootstrapReady: (operation) => {
        operation.takeSettingsOwner(runtimeSettingsService);
        retainedActivationOperations.push(operation);
      },
      onPreflightReady: (operation) => {
        const preflight = operation.preflight.bind(operation);
        operation.preflight = async (intent): ReturnType<typeof preflight> => {
          callLog.push(`preflight:${intent.provider}`);
          const result = await preflight(intent);
          if (result.switchError !== undefined)
            switchErrors.push(result.switchError);
          callLog.push(`activated:${settingsOwner.readSelectedProvider()}`);
          return result;
        };
      },
      onOAuthManagerReady: (owner) => {
        oauthManager = owner;
        callLog.push('oauth-ready');
      },
      onProviderManagerReady: (manager) => {
        registerPrecedenceProviders(manager);
        providerManager = manager;
        callLog.push('manager-ready');
      },
      providerContributions: await loadPrecedenceProviderContributions(),
    },
  );
  if (providerManager === undefined)
    throw new Error('CLI startup did not publish its provider manager');
  expect(switchErrors).toHaveLength(0);
  return { config, settingsOwner, oauthManager, providerManager, callLog };
}

// ─── Suite: step ordering ─────────────────────────────────────────────────────

describe('e2eOrderingParity: step ordering constraints', () => {
  afterEach(async () => {
    const results = await Promise.allSettled(
      retainedActivationOperations
        .splice(0)
        .map(async (operation) => operation.dispose()),
    );
    const errors = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (errors.length > 0)
      throw new AggregateError(errors, 'Activation fixture cleanup');
  });
  afterEach(async () => {
    for (const owner of retainedSettingsOwners.splice(0)) await owner.dispose();
  });

  const originalArgv = process.argv;

  beforeEach(() => {
    vi.clearAllMocks();
    (os.homedir as Mock<typeof os.homedir>).mockReturnValue(
      path.resolve(path.sep, 'mock', 'home', 'user'),
    );
    setEnv('GEMINI_API_KEY', 'test-api-key');
    // Provide a fallback model so non-gemini providers don't fail with model.missing
    setEnv('LLXPRT_DEFAULT_MODEL', 'mock-default-model');
    process.argv = ['node', 'script.js'];
  });

  afterEach(() => {
    process.argv = originalArgv;
    restoreEnv();
    vi.restoreAllMocks();
  });

  it('binds the post-Config manager and message bus before provider activation', async () => {
    const { config, oauthManager, providerManager, callLog } = await runConfig(
      {},
      ['--provider', 'gemini'],
    );
    expect('getProviderManager' in config).toBe(false);
    expect(providerManager.getActiveProviderName()).toBe('gemini');
    expect(oauthManager?.runtimeMessageBus).toBeDefined();
    expect(callLog).toStrictEqual([
      'manager-ready',
      'oauth-ready',
      'preflight:gemini',
      'activated:gemini',
    ]);
    expect(callLog.indexOf('manager-ready')).toBeLessThan(
      callLog.indexOf('preflight:gemini'),
    );
    expect(callLog.indexOf('oauth-ready')).toBeLessThan(
      callLog.indexOf('preflight:gemini'),
    );
  });

  it('activates the requested provider exactly once through preflight', async () => {
    const { callLog, settingsOwner } = await runConfig({}, [
      '--provider',
      'gemini',
    ]);
    const switchCalls = callLog.filter((c) => c.startsWith('preflight:'));
    expect(settingsOwner.readSelectedProvider()).toBe('gemini');
    expect(switchCalls).toHaveLength(1);
  });

  it('with --provider+--key: applies the synthetic CLI profile before returning the config', async () => {
    const { config: config, settingsOwner: configSettingsOwner } =
      await runConfig({}, ['--provider', 'openai', '--key', 'sk-test']);
    expect(config.getProvider()).toBe('openai');
    expect(configSettingsOwner.readNamedParameter('auth-key')).toBe('sk-test');
  });
});

// ─── Suite: full precedence chain ────────────────────────────────────────────

describe('e2eOrderingParity: full precedence chain end-to-end', () => {
  afterEach(async () => {
    const results = await Promise.allSettled(
      retainedActivationOperations
        .splice(0)
        .map(async (operation) => operation.dispose()),
    );
    const errors = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (errors.length > 0)
      throw new AggregateError(errors, 'Activation fixture cleanup');
  });
  afterEach(async () => {
    for (const owner of retainedSettingsOwners.splice(0)) await owner.dispose();
  });

  const originalArgv = process.argv;

  beforeEach(() => {
    vi.clearAllMocks();
    (os.homedir as Mock<typeof os.homedir>).mockReturnValue(
      path.resolve(path.sep, 'mock', 'home', 'user'),
    );
    setEnv('GEMINI_API_KEY', 'test-api-key');
    // Provide a fallback model so non-gemini providers don't fail with model.missing
    setEnv('LLXPRT_DEFAULT_MODEL', 'mock-default-model');
    process.argv = ['node', 'script.js'];
  });

  afterEach(() => {
    process.argv = originalArgv;
    restoreEnv();
    vi.restoreAllMocks();
  });

  it('CLI --provider wins over LLXPRT_DEFAULT_PROVIDER env', async () => {
    setEnv('LLXPRT_DEFAULT_PROVIDER', 'anthropic');
    const { config, settingsOwner } = await runConfig({}, [
      '--provider',
      'openai',
    ]);
    expect(config.getProvider()).toBe('openai');
    expect(settingsOwner.readSelectedProvider()).toBe('openai');
  });

  it('LLXPRT_DEFAULT_PROVIDER env wins over gemini default', async () => {
    setEnv('LLXPRT_DEFAULT_PROVIDER', 'anthropic');
    const { config, settingsOwner } = await runConfig({});
    expect(config.getProvider()).toBe('anthropic');
    expect(settingsOwner.readSelectedProvider()).toBe('anthropic');
  });

  it('CLI --model is set on config and survives the provider switch', async () => {
    const { config, settingsOwner, callLog } = await runConfig({}, [
      '--provider',
      'gemini',
      '--model',
      'cli-override-model',
    ]);
    expect(config.getModel()).toBe('cli-override-model');
    expect(callLog).toContain('activated:gemini');
    expect(settingsOwner.readSelectedModel()).toBe('cli-override-model');
  });

  it('settings.model is used when no CLI --model and no env', async () => {
    const { config: config } = await runConfig({ model: 'settings-model' });
    expect(config.getModel()).toBe('settings-model');
  });

  it('CLI --model beats settings.model', async () => {
    const { config: config } = await runConfig({ model: 'settings-model' }, [
      '--model',
      'cli-model',
    ]);
    expect(config.getModel()).toBe('cli-model');
  });

  it('full stack: --provider + --model produces expected provider and model', async () => {
    const { config: config } = await runConfig({}, [
      '--provider',
      'openai',
      '--model',
      'gpt-4-turbo',
    ]);
    expect(config.getProvider()).toBe('openai');
    expect(config.getModel()).toBe('gpt-4-turbo');
  });
});
