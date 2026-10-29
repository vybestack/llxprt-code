/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
const retainedActivationOperations: Array<{ dispose(): void | Promise<void> }> =
  [];

const retainedConfigFixtures: Array<{
  config: Awaited<ReturnType<typeof loadCliConfig>>;
  settingsOwner: SessionSettingsOwner;
}> = [];

async function loadConfigFixture(
  ...args: [
    settings: CliConfigLoadInput['settings'],
    extensions: CliConfigLoadInput['extensions'],
    extensionEnablementManager: CliConfigLoadInput['extensionEnablementManager'],
    sessionId: CliConfigLoadInput['sessionId'],
    argv: CliConfigLoadInput['argv'],
    cwd?: CliConfigLoadInput['cwd'],
  ]
) {
  const store = new SettingsService();
  const settingsOwner = new SessionSettingsOwner(store);
  try {
    const config = await loadCliConfigWithPreflight({
      settings: args[0],
      extensions: args[1],
      extensionEnablementManager: args[2],
      sessionId: args[3],
      argv: args[4],
      cwd: args[5],
      settingsService: store,
      settingsOwner,
      authority: new CredentialAuthority(),
      onActivationBootstrapReady: (operation) => {
        retainedActivationOperations.push(operation);
      },
    });
    const root = { config, settingsOwner };
    retainedConfigFixtures.push(root);
    return root;
  } catch (error) {
    await settingsOwner.dispose();
    throw error;
  }
}

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
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import { loadCliConfig, type CliConfigLoadInput } from './config.js';
import { parseArguments } from './cliArgParser.js';
import type { Settings } from './settings.js';
import { ExtensionStorage } from './extension.js';
import * as ServerConfig from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { isWorkspaceTrusted } from './trustedFolders.js';
import { ExtensionEnablementManager } from './extensions/extensionEnablement.js';
import { loadCliConfigWithPreflight } from '../__tests__/load-cli-config-fixture.js';

const realTrustedFoldersModule = { ...(await import('./trustedFolders.js')) };
const realLlxprtCodeCoreModule = {
  ...(await import('@vybestack/llxprt-code-core')),
};

void vi.mock('./trustedFolders.js', () => {
  const actual = realTrustedFoldersModule;
  return {
    ...actual,
    isWorkspaceTrusted: vi.fn().mockReturnValue(true), // Default to trusted
  };
});

void vi.mock('./sandboxConfig.js', () => ({
  loadSandboxConfig: vi.fn().mockResolvedValue(undefined),
}));

const pathMod = await import('node:path');
const actualFs = { ...(await import('fs')) };
void vi.mock('fs', () => {
  const mockHome = pathMod.resolve(pathMod.sep, 'mock', 'home', 'user');
  const MOCK_CWD1 = process.cwd();
  const MOCK_CWD2 = pathMod.resolve(pathMod.sep, 'home', 'user', 'project');

  const mockPaths = new Set([
    MOCK_CWD1,
    MOCK_CWD2,
    pathMod.resolve(pathMod.sep, 'cli', 'path1'),
    pathMod.resolve(pathMod.sep, 'settings', 'path1'),
    pathMod.join(mockHome, 'settings', 'path2'),
    pathMod.join(MOCK_CWD2, 'cli', 'path2'),
    pathMod.join(MOCK_CWD2, 'settings', 'path3'),
  ]);

  return {
    ...actualFs,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn((p) => mockPaths.has(p.toString())),
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

void vi.mock('open', () => ({
  default: vi.fn(),
}));

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
  providerManager: null as ServerConfig.RuntimeProviderManager | null,
  oauthManager: null as unknown,
};

void vi.mock('@vybestack/llxprt-code-core', () => {
  const actualServer = realLlxprtCodeCoreModule;
  return {
    ...actualServer,
    IdeClient: {
      getInstance: vi.fn().mockResolvedValue({
        getConnectionStatus: vi.fn(),
        initialize: vi.fn(),
        shutdown: vi.fn(),
      }),
    },
    loadEnvironment: vi.fn(),
    loadServerHierarchicalMemory: vi.fn(
      (cwd, dirs, debug, fileService, extensionPaths, _maxDirs) =>
        Promise.resolve({
          // Intentional truthy fallback for empty string
          memoryContent:
            Array.isArray(extensionPaths) && extensionPaths.length > 0
              ? extensionPaths.join(',')
              : '',
          fileCount: extensionPaths?.length ?? 0,
          filePaths: [],
        }),
    ),
    DEFAULT_MEMORY_FILE_FILTERING_OPTIONS: {
      respectGitIgnore: false,
      respectLlxprtIgnore: true,
    },
    DEFAULT_FILE_FILTERING_OPTIONS: {
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    },
    // Mock isRipgrepAvailable to return true by default (ripgrep is bundled)
    isRipgrepAvailable: vi.fn().mockResolvedValue(true),
  };
});

function resetRuntimeSettingsState(): void {
  runtimeSettingsState.context = null;
  runtimeSettingsState.providerManager = null;
  runtimeSettingsState.oauthManager = null;
}

function hasNoDisabledTools(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (Array.isArray(value) && value.length === 0)
  );
}

function normalizeDisabledTools(
  value: readonly string[] | undefined,
): readonly string[] {
  return value ?? [];
}

describe('defaultDisabledTools', () => {
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
    const retiring = retainedConfigFixtures.splice(0);
    const results = await Promise.allSettled(
      retiring.map(async ({ config, settingsOwner }) => {
        await settingsOwner.dispose();
        await config.dispose();
      }),
    );
    const errors = results.flatMap((r) =>
      r.status === 'rejected' ? [r.reason] : [],
    );
    if (errors.length > 0)
      throw new AggregateError(errors, 'Config fixture cleanup');
  });

  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    resetRuntimeSettingsState();
    process.stdin.isTTY = true;
  });

  afterEach(() => {
    process.stdin.isTTY = originalIsTTY;
  });

  it('should seed tools.disabled with defaultDisabledTools', async () => {
    const settings: Settings = {
      defaultDisabledTools: ['read_file'],
    };
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const { settingsOwner: configSettingsOwner } = await loadConfigFixture(
      settings,
      [],
      new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir(), {
        enabledOverride: argv.extensions,
      }),
      'test-session',
      argv,
    );
    const disabled = configSettingsOwner.readNamedParameter('tools.disabled');
    expect(disabled).toStrictEqual(expect.arrayContaining(['read_file']));
  });

  it('should seed tools.disabled with both default-disabled tools', async () => {
    const settings: Settings = {
      defaultDisabledTools: ['read_file', 'glob'],
    };
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const { settingsOwner: configSettingsOwner } = await loadConfigFixture(
      settings,
      [],
      new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir(), {
        enabledOverride: argv.extensions,
      }),
      'test-session',
      argv,
    );
    const disabled = configSettingsOwner.readNamedParameter('tools.disabled');
    expect(disabled).toStrictEqual(
      expect.arrayContaining(['read_file', 'glob']),
    );
  });

  it('should merge defaultDisabledTools with existing tools.disabled', async () => {
    const settings: Settings = {
      defaultDisabledTools: ['read_file'],
    };
    process.argv = ['node', 'script.js', '--set', 'tools.disabled=["glob"]'];
    const argv = await parseArguments({} as Settings);
    const { settingsOwner: configSettingsOwner } = await loadConfigFixture(
      settings,
      [],
      new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir(), {
        enabledOverride: argv.extensions,
      }),
      'test-session',
      argv,
    );
    const currentDisabled = configSettingsOwner.readNamedParameter(
      'tools.disabled',
    ) as string[] | undefined;
    expect(currentDisabled).toStrictEqual(
      expect.arrayContaining(['glob', 'read_file']),
    );
  });

  it('should not duplicate tools already in tools.disabled', async () => {
    const settings: Settings = {
      defaultDisabledTools: ['read_file'],
    };
    process.argv = [
      'node',
      'script.js',
      '--set',
      'tools.disabled=["read_file"]',
    ];
    const argv = await parseArguments({} as Settings);
    const { settingsOwner: configSettingsOwner } = await loadConfigFixture(
      settings,
      [],
      new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir(), {
        enabledOverride: argv.extensions,
      }),
      'test-session',
      argv,
    );
    const disabled = configSettingsOwner.readNamedParameter(
      'tools.disabled',
    ) as string[];
    const readFileCount = disabled.filter((t) => t === 'read_file').length;
    expect(readFileCount).toBe(1);
  });

  it('should not seed tools.disabled when defaultDisabledTools is empty', async () => {
    const settings: Settings = {
      defaultDisabledTools: [],
    };
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const { settingsOwner: configSettingsOwner } = await loadConfigFixture(
      settings,
      [],
      new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir(), {
        enabledOverride: argv.extensions,
      }),
      'test-session',
      argv,
    );
    const disabled = configSettingsOwner.readNamedParameter('tools.disabled');
    // Should be either undefined, null, or empty array
    expect(hasNoDisabledTools(disabled)).toBe(true);
  });

  it('should not seed tools.disabled when defaultDisabledTools is undefined', async () => {
    const settings: Settings = {
      defaultDisabledTools: undefined,
    };
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const { settingsOwner: configSettingsOwner } = await loadConfigFixture(
      settings,
      [],
      new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir(), {
        enabledOverride: argv.extensions,
      }),
      'test-session',
      argv,
    );
    const disabled = configSettingsOwner.readNamedParameter('tools.disabled');
    // Should be either undefined, null, or empty array
    expect(hasNoDisabledTools(disabled)).toBe(true);
  });

  it('should not affect excludeTools (tool remains discoverable)', async () => {
    const settings: Settings = {
      defaultDisabledTools: ['read_file'],
    };
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const { config: config, settingsOwner: configSettingsOwner } =
      await loadConfigFixture(
        settings,
        [],
        new ExtensionEnablementManager(
          ExtensionStorage.getUserExtensionsDir(),
          { enabledOverride: argv.extensions },
        ),
        'test-session',
        argv,
      );
    // read_file should NOT be in excludeTools
    expect(config.getExcludeTools()).not.toContain('read_file');
    // But it SHOULD be in tools.disabled
    const disabled = configSettingsOwner.readNamedParameter(
      'tools.disabled',
    ) as string[];
    expect(disabled).toContain('read_file');
  });

  it('should not re-disable a tool that the user has explicitly allowed', async () => {
    const settings: Settings = {
      defaultDisabledTools: ['read_file'],
    };
    process.argv = [
      'node',
      'script.js',
      '--set',
      'tools.allowed=["read_file"]',
    ];
    const argv = await parseArguments({} as Settings);
    const { settingsOwner: configSettingsOwner } = await loadConfigFixture(
      settings,
      [],
      new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir(), {
        enabledOverride: argv.extensions,
      }),
      'test-session',
      argv,
    );
    const disabled = configSettingsOwner.readNamedParameter(
      'tools.disabled',
    ) as string[] | undefined;
    // read_file is in tools.allowed, so it must NOT be added to tools.disabled
    expect(normalizeDisabledTools(disabled)).not.toContain('read_file');
  });
});

describe('loadCliConfig disableYoloMode', () => {
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
    const retiring = retainedConfigFixtures.splice(0);
    const results = await Promise.allSettled(
      retiring.map(async ({ config, settingsOwner }) => {
        await settingsOwner.dispose();
        await config.dispose();
      }),
    );
    const errors = results.flatMap((r) =>
      r.status === 'rejected' ? [r.reason] : [],
    );
    if (errors.length > 0)
      throw new AggregateError(errors, 'Config fixture cleanup');
  });

  beforeEach(() => {
    resetRuntimeSettingsState();
    vi.clearAllMocks();
    (os.homedir as Mock<typeof os.homedir>).mockReturnValue('/mock/home/user');
    setEnv('GEMINI_API_KEY', 'test-api-key');
    (isWorkspaceTrusted as Mock<typeof isWorkspaceTrusted>).mockReturnValue(
      true,
    );
  });

  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
  });

  it('should allow auto_edit mode even if yolo mode is disabled', async () => {
    process.argv = ['node', 'script.js', '--approval-mode=auto_edit'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      security: { disableYoloMode: true },
    };
    const { config: config } = await loadConfigFixture(
      settings,
      [],
      new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir(), {
        enabledOverride: argv.extensions,
      }),
      'test-session',
      argv,
    );
    expect(config.getApprovalMode()).toBe(ApprovalMode.AUTO_EDIT);
  });

  it('should throw if YOLO mode is attempted when disableYoloMode is true', async () => {
    process.argv = ['node', 'script.js', '--yolo'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      security: { disableYoloMode: true },
    };
    await expect(
      loadConfigFixture(
        settings,
        [],
        new ExtensionEnablementManager(
          ExtensionStorage.getUserExtensionsDir(),
          { enabledOverride: argv.extensions },
        ),
        'test-session',
        argv,
      ),
    ).rejects.toThrow(
      'Cannot start in YOLO mode since it is disabled by your admin',
    );
  });
});

describe('loadCliConfig secureModeEnabled', () => {
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
    const retiring = retainedConfigFixtures.splice(0);
    const results = await Promise.allSettled(
      retiring.map(async ({ config, settingsOwner }) => {
        await settingsOwner.dispose();
        await config.dispose();
      }),
    );
    const errors = results.flatMap((r) =>
      r.status === 'rejected' ? [r.reason] : [],
    );
    if (errors.length > 0)
      throw new AggregateError(errors, 'Config fixture cleanup');
  });

  beforeEach(() => {
    resetRuntimeSettingsState();
    vi.clearAllMocks();
    (os.homedir as Mock<typeof os.homedir>).mockReturnValue('/mock/home/user');
    setEnv('GEMINI_API_KEY', 'test-api-key');
    (isWorkspaceTrusted as Mock<typeof isWorkspaceTrusted>).mockReturnValue(
      true,
    );
  });

  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
  });

  it('should throw an error if YOLO mode is attempted when secureModeEnabled is true', async () => {
    process.argv = ['node', 'script.js', '--yolo'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      admin: { secureModeEnabled: true },
    };
    await expect(
      loadConfigFixture(
        settings,
        [],
        new ExtensionEnablementManager(
          ExtensionStorage.getUserExtensionsDir(),
          { enabledOverride: argv.extensions },
        ),
        'test-session',
        argv,
      ),
    ).rejects.toThrow(
      'Cannot start in YOLO mode since it is disabled by your admin',
    );
  });
});
