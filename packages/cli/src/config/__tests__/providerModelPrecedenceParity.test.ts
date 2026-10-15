/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P13
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-18
 */

/**
 * Task 1.2 – Provider/model precedence parity tests
 *
 * Locks the 4-level provider precedence chain:
 *   CLI --provider > profile provider > LLXPRT_DEFAULT_PROVIDER env > 'gemini'
 *
 * Locks the 6-level model precedence chain:
 *   CLI --model > profile model > settings.model > env vars > alias default > Gemini default
 */

import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
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
import * as ServerConfig from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ProviderManager } from '@vybestack/llxprt-code-providers';
import { loadCliConfig } from '../config.js';
import { parseArguments } from '../cliArgParser.js';
import type { Settings } from '../settings.js';
import { ExtensionStorage } from '../extension.js';
import { ExtensionEnablementManager } from '../extensions/extensionEnablement.js';
import { loadPrecedenceProviderContributions } from './precedenceProviderContributions.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const realTrustedFoldersModule = { ...(await import('../trustedFolders.js')) };
const realLlxprtCodeCoreModule = {
  ...(await import('@vybestack/llxprt-code-core')),
};

void vi.mock('../trustedFolders.js', () => {
  const actual = realTrustedFoldersModule;
  return {
    ...actual,
    isWorkspaceTrusted: vi.fn().mockReturnValue(true),
  };
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
      (p) =>
        mockPaths.has(p.toString()) ||
        (String(p).startsWith(
          pathMod.resolve(
            process.cwd(),
            'packages/providers/src/composition/aliases',
          ),
        ) &&
          actualFs.existsSync(p) === true),
    ),
    statSync: vi.fn((p) => {
      if (mockPaths.has(p.toString())) {
        return { isDirectory: () => true } as unknown as import('fs').Stats;
      }
      return actualFs.statSync(p as unknown as string);
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

const runtimeSettingsState = {
  context: null as {
    settingsService: SettingsService;
    config: ServerConfig.Config | null;
    runtimeId: string;
    metadata?: Record<string, unknown>;
  } | null,
  providerManager: null as ProviderManager | null,
  oauthManager: null as unknown,
};

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

function makeExtMgr() {
  return new ExtensionEnablementManager(
    ExtensionStorage.getUserExtensionsDir(),
  );
}

async function runConfig(settings: Settings, argv?: string[]) {
  if (argv) {
    process.argv = ['node', 'script.js', ...argv];
  }
  const parsedArgv = await parseArguments(settings);
  const runtimeSettingsService = new SettingsService();
  return loadCliConfig(
    settings,
    [],
    makeExtMgr(),
    'test-session',
    parsedArgv,
    undefined,
    {
      credentialAuthority: new CredentialAuthority(),
      settingsService: runtimeSettingsService,
      providerContributions: await loadPrecedenceProviderContributions(),
    },
  );
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('providerModelPrecedenceParity: 4-level provider chain', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetAllMocks();
    (os.homedir as Mock<typeof os.homedir>).mockReturnValue(
      path.resolve(path.sep, 'mock', 'home', 'user'),
    );
    setEnv('GEMINI_API_KEY', 'test-api-key');
    // Scrub env vars that may leak from CI environment
    delete process.env.LLXPRT_PROFILE;
    delete process.env.LLXPRT_DEFAULT_PROVIDER;
    delete process.env.LLXPRT_DEFAULT_MODEL;
    delete process.env.GEMINI_MODEL;
    // Provide a fallback model so non-gemini providers don't fail with model.missing
    setEnv('LLXPRT_DEFAULT_MODEL', 'mock-default-model');
    process.argv = ['node', 'script.js'];
    runtimeSettingsState.context = null;
    runtimeSettingsState.providerManager = null;
    runtimeSettingsState.oauthManager = null;
  });

  afterEach(() => {
    process.argv = originalArgv;
    restoreEnv();
    vi.restoreAllMocks();
  });

  it('level 4 fallback: no CLI/profile/env → no implicit provider (#2481)', async () => {
    delete process.env.LLXPRT_DEFAULT_MODEL;
    const config = await runConfig({});
    expect(config.getProvider()).toBeUndefined();
  });

  it('level 3: LLXPRT_DEFAULT_PROVIDER env sets the provider', async () => {
    setEnv('LLXPRT_DEFAULT_PROVIDER', 'anthropic');
    const config = await runConfig({});
    expect(config.getProvider()).toBe('anthropic');
  });

  it('level 1: CLI --provider overrides LLXPRT_DEFAULT_PROVIDER env', async () => {
    setEnv('LLXPRT_DEFAULT_PROVIDER', 'anthropic');
    const config = await runConfig({}, ['--provider', 'openai']);
    expect(config.getProvider()).toBe('openai');
  });

  it('level 1: CLI --provider beats env', async () => {
    const config = await runConfig({}, ['--provider', 'openai']);
    expect(config.getProvider()).toBe('openai');
  });

  it('rejects an explicitly configured provider that was not registered', async () => {
    await expect(
      runConfig({}, ['--provider', 'not-a-provider']),
    ).rejects.toThrow(
      "Could not activate explicitly-configured provider 'not-a-provider': Provider 'not-a-provider' not found",
    );
  });
});

describe('providerModelPrecedenceParity: 6-level model chain', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetAllMocks();
    (os.homedir as Mock<typeof os.homedir>).mockReturnValue(
      path.resolve(path.sep, 'mock', 'home', 'user'),
    );
    process.argv = ['node', 'script.js'];
    runtimeSettingsState.context = null;
    runtimeSettingsState.providerManager = null;
    runtimeSettingsState.oauthManager = null;
    restoreEnv();
    setEnv('GEMINI_API_KEY', 'test-api-key');
    // Scrub env vars that may leak from CI environment
    delete process.env.LLXPRT_PROFILE;
    delete process.env.LLXPRT_DEFAULT_PROVIDER;
    delete process.env.LLXPRT_DEFAULT_MODEL;
    delete process.env.GEMINI_MODEL;
  });

  afterEach(() => {
    process.argv = originalArgv;
    restoreEnv();
    vi.restoreAllMocks();
  });

  it('level 6 fallback: no provider → empty model (#2481)', async () => {
    const config = await runConfig({});
    expect(config.getModel()).toBe('');
  });

  it('level 6 fallback: explicit gemini provider → provider default model', async () => {
    const config = await runConfig({}, ['--provider', 'gemini']);
    expect(config.getProvider()).toBe('gemini');
    expect(config.getModel()).toBe('gemini-2.5-pro');
  });

  it('level 5: GEMINI_MODEL env provides model when resolved provider is explicit gemini', async () => {
    setEnv('GEMINI_MODEL', 'gemini-1.5-flash');
    const config = await runConfig({}, ['--provider', 'gemini']);
    expect(config.getProvider()).toBe('gemini');
    expect(config.getModel()).toBe('gemini-1.5-flash');
  });

  it('level 5: LLXPRT_DEFAULT_MODEL env provides model when no other override', async () => {
    setEnv('LLXPRT_DEFAULT_MODEL', 'gemini-env-model');
    const config = await runConfig({});
    expect(config.getModel()).toBe('gemini-env-model');
  });

  it('level 5: LLXPRT_DEFAULT_MODEL beats GEMINI_MODEL', async () => {
    setEnv('LLXPRT_DEFAULT_MODEL', 'preferred-model');
    setEnv('GEMINI_MODEL', 'fallback-model');
    const config = await runConfig({});
    expect(config.getModel()).toBe('preferred-model');
  });

  it('level 4: settings.model beats env vars', async () => {
    setEnv('GEMINI_MODEL', 'env-model');
    const config = await runConfig({ model: 'settings-model' });
    expect(config.getModel()).toBe('settings-model');
  });

  it('level 1: CLI --model beats settings.model and env', async () => {
    setEnv('GEMINI_MODEL', 'env-model');
    const config = await runConfig({ model: 'settings-model' }, [
      '--model',
      'cli-model',
    ]);
    expect(config.getModel()).toBe('cli-model');
  });

  it('level 1: CLI --model beats LLXPRT_DEFAULT_MODEL env', async () => {
    setEnv('LLXPRT_DEFAULT_MODEL', 'env-model');
    const config = await runConfig({}, ['--model', 'cli-model']);
    expect(config.getModel()).toBe('cli-model');
  });
});
