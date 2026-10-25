import { observeActivationPreparation } from '../../../../agents/src/api/__tests__/helpers/activation-acquisition-capture.js';

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
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
 * Task 1.6 – Profile + CLI override precedence parity tests
 *
 * Locks:
 *   - --provider with --key/--keyfile/--baseurl creates synthetic profile
 *   - Profile ephemeral settings are skipped when --provider is explicit
 *   - CLI model override is re-applied after provider switch (observable via config.getModel())
 *   - Profile source chain: --profile-load CLI > LLXPRT_PROFILE env > settings.defaultProfile
 *     (only when --provider is NOT explicit)
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P13
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-18
 */
/**
 * Task 1.6 – Profile + CLI override precedence parity tests
 *
 * Locks:
 *   - --provider with --key/--keyfile/--baseurl creates synthetic profile
 *   - Profile ephemeral settings are skipped when --provider is explicit
 *   - CLI model override is re-applied after provider switch (observable via config.getModel())
 *   - Profile source chain: --profile-load CLI > LLXPRT_PROFILE env > settings.defaultProfile
 *     (only when --provider is NOT explicit)
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
import type {
  Config,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { parseArguments } from '../cliArgParser.js';
import type { Settings } from '../settings.js';
import { ExtensionStorage } from '../extension.js';
import { ExtensionEnablementManager } from '../extensions/extensionEnablement.js';
import { loadPrecedenceProviderContributions } from './precedenceProviderContributions.js';
import { loadCliConfigWithPreflight } from '../../__tests__/load-cli-config-fixture.js';

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
  runtimeSettingsService = new SettingsService(),
): Promise<{
  config: Config;
  settingsOwner: SessionSettingsOwner;
  providerManager: RuntimeProviderManager;
  profileNames: string[];
  providerSelections: string[];
}> {
  process.argv = ['node', 'script.js', ...argv];
  const parsedArgv = await parseArguments(settings);
  const settingsOwner = new SessionSettingsOwner(runtimeSettingsService);
  retainedSettingsOwners.push(settingsOwner);
  let providerManager: RuntimeProviderManager | undefined;
  const profileNames: string[] = [];
  const providerSelections: string[] = [];
  runtimeSettingsService.on('change', ({ key, oldValue, newValue }) => {
    if (key === 'currentProfile' && typeof newValue === 'string')
      profileNames.push(newValue);
    if (
      key === 'activeProvider' &&
      typeof newValue === 'string' &&
      newValue !== oldValue
    )
      providerSelections.push(newValue);
  });

  const observation = observeActivationPreparation((operation, state) => {
    providerManager = state.manager;
  });
  const config = await loadCliConfigWithPreflight({
    settings,
    extensions: [],
    extensionEnablementManager: makeExtMgr(),
    sessionId: 'test-session',
    argv: parsedArgv,
    settingsService: runtimeSettingsService,
    settingsOwner,
    authority: new CredentialAuthority(),
    contributions: await loadPrecedenceProviderContributions(),
    onActivationBootstrapReady: (operation) => {
      retainedActivationOperations.push(operation);
    },
  });
  observation.mockRestore();
  if (providerManager === undefined)
    throw new Error('CLI startup did not publish its provider manager');
  return {
    config,
    settingsOwner,
    providerManager,
    profileNames,
    providerSelections,
  };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('profileOverridePrecedenceParity: synthetic profile for CLI auth', () => {
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
    // Remove provider/model env vars that may leak from CI environment
    delete process.env.LLXPRT_DEFAULT_PROVIDER;
    delete process.env.LLXPRT_DEFAULT_MODEL;
    delete process.env.GEMINI_MODEL;
    delete process.env.LLXPRT_PROFILE;
    // Provide a fallback model so non-gemini providers don't fail with model.missing
    setEnv('LLXPRT_DEFAULT_MODEL', 'mock-default-model');
    process.argv = ['node', 'script.js'];
  });

  afterEach(() => {
    process.argv = originalArgv;
    restoreEnv();
    vi.restoreAllMocks();
  });

  it('--provider with --key applies the CLI credential to the selected provider', async () => {
    const { config: config, settingsOwner: configSettingsOwner } =
      await runConfig({}, ['--provider', 'openai', '--key', 'sk-test-key']);
    expect(config.getProvider()).toBe('openai');
    expect(configSettingsOwner.readNamedParameter('auth-key')).toBe(
      'sk-test-key',
    );
  });

  it('--provider with --baseurl applies the CLI endpoint to the selected provider', async () => {
    const { config: config, settingsOwner: configSettingsOwner } =
      await runConfig({}, [
        '--provider',
        'openai',
        '--baseurl',
        'https://custom.api.com',
      ]);
    expect(config.getProvider()).toBe('openai');
    expect(configSettingsOwner.readNamedParameter('base-url')).toBe(
      'https://custom.api.com',
    );
  });

  it('--provider alone (no key/keyfile/baseurl) does NOT create synthetic profile', async () => {
    const { profileNames } = await runConfig({}, ['--provider', 'openai']);
    const syntheticCall = profileNames.find((name) => name === 'cli-args');
    expect(syntheticCall).toBeUndefined();
  });
});

describe('profileOverridePrecedenceParity: --provider skips profile ephemeral settings', () => {
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
    // Remove provider/model env vars that may leak from CI environment
    delete process.env.LLXPRT_DEFAULT_PROVIDER;
    delete process.env.LLXPRT_DEFAULT_MODEL;
    delete process.env.GEMINI_MODEL;
    delete process.env.LLXPRT_PROFILE;
    // Provide a fallback model so non-gemini providers don't fail with model.missing
    setEnv('LLXPRT_DEFAULT_MODEL', 'mock-default-model');
    process.argv = ['node', 'script.js'];
  });

  afterEach(() => {
    process.argv = originalArgv;
    restoreEnv();
    vi.restoreAllMocks();
  });

  it('with --provider, profile from LLXPRT_PROFILE env is skipped (no crash)', async () => {
    setEnv('LLXPRT_PROFILE', 'nonexistent-profile');
    const { config: config } = await runConfig({}, ['--provider', 'gemini']);
    expect(config).toBeDefined();
    expect(config.getProvider()).toBe('gemini');
  });

  it('without --provider, settings.defaultProfile is attempted (non-crash on not-found)', async () => {
    const settings: Settings = { defaultProfile: 'nonexistent-default' };
    const { config: config } = await runConfig(settings);
    expect(config).toBeDefined();
  });

  it('with --provider, settings.defaultProfile is NOT applied as file-based profile', async () => {
    const settings: Settings = { defaultProfile: 'some-profile' };
    const { profileNames } = await runConfig(settings, [
      '--provider',
      'gemini',
    ]);
    const fileBasedCall = profileNames.find((name) => name === 'some-profile');
    expect(fileBasedCall).toBeUndefined();
  });

  it('without --provider, explicit profile load is attempted before settings.defaultProfile', async () => {
    const settings: Settings = { defaultProfile: 'default-profile' };
    const service = new SettingsService();
    await expect(
      runConfig(settings, ['--profile-load', 'missing-cli-profile'], service),
    ).rejects.toThrow("Profile 'missing-cli-profile' not found");
    const defaultProfileCall = [service.getCurrentProfileName()].find(
      (name) => name === 'default-profile',
    );
    expect(defaultProfileCall).toBeUndefined();
  });

  it('applies socket-timeout from profile ephemeral settings without --provider', async () => {
    const profile = {
      version: 1,
      provider: 'openai',
      model: 'local-model.gguf',
      ephemeralSettings: {
        'socket-timeout': 300000,
      },
    };

    const { settingsOwner: configSettingsOwner } = await runConfig({}, [
      '--profile',
      JSON.stringify(profile),
    ]);

    expect(configSettingsOwner.readNamedParameter('socket-timeout')).toBe(
      300000,
    );
  });

  it('skips profile socket-timeout when --provider is explicit', async () => {
    const profile = {
      version: 1,
      provider: 'openai',
      model: 'local-model.gguf',
      ephemeralSettings: {
        'socket-timeout': 300000,
      },
    };

    const { config: config, settingsOwner: configSettingsOwner } =
      await runConfig({}, [
        '--profile',
        JSON.stringify(profile),
        '--provider',
        'gemini',
      ]);

    expect(config.getProvider()).toBe('gemini');
    expect(
      configSettingsOwner.readNamedParameter('socket-timeout'),
    ).toBeUndefined();
  });
});

describe('profileOverridePrecedenceParity: CLI model override after provider switch', () => {
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
    // Remove provider/model env vars that may leak from CI environment
    delete process.env.LLXPRT_DEFAULT_PROVIDER;
    delete process.env.LLXPRT_DEFAULT_MODEL;
    delete process.env.GEMINI_MODEL;
    delete process.env.LLXPRT_PROFILE;
    // Provide a fallback model so non-gemini providers don't fail with model.missing
    setEnv('LLXPRT_DEFAULT_MODEL', 'mock-default-model');
    process.argv = ['node', 'script.js'];
  });

  afterEach(() => {
    process.argv = originalArgv;
    restoreEnv();
    vi.restoreAllMocks();
  });

  it('--model override is reflected in final config model', async () => {
    const { config: config } = await runConfig({}, [
      '--model',
      'my-custom-model',
    ]);
    expect(config.getModel()).toBe('my-custom-model');
  });

  it('--model combined with --provider: model set on final config', async () => {
    const { config: config } = await runConfig({}, [
      '--provider',
      'openai',
      '--model',
      'gpt-4',
    ]);
    expect(config.getModel()).toBe('gpt-4');
  });

  it('selects the specified --provider in the real manager and settings owner', async () => {
    const { providerManager, settingsOwner, providerSelections } =
      await runConfig({}, ['--provider', 'openai']);
    expect(providerSelections).toContain('openai');
    expect(providerManager.getActiveProviderName()).toBe('openai');
    expect(settingsOwner.readSelectedProvider()).toBe('openai');
  });

  it('does not select a provider when none is configured', async () => {
    const { providerManager, settingsOwner, providerSelections } =
      await runConfig({});
    expect(providerSelections).toHaveLength(0);
    expect(providerManager.getActiveProviderName()).toBeUndefined();
    expect(settingsOwner.readSelectedProvider()).toBeUndefined();
  });
});
