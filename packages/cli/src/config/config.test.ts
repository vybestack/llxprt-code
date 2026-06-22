/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  clearActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';
import { loadCliConfig } from './config.js';
import { parseArguments } from './cliArgParser.js';
import type { Settings } from './settings.js';
import { ExtensionStorage } from './extension.js';
import * as ServerConfig from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { isWorkspaceTrusted } from './trustedFolders.js';
import { ExtensionEnablementManager } from './extensions/extensionEnablement.js';

vi.mock('./trustedFolders.js', async () => {
  const actual = await vi.importActual<typeof import('./trustedFolders.js')>(
    './trustedFolders.js',
  );
  return {
    ...actual,
    isWorkspaceTrusted: vi.fn().mockReturnValue(true), // Default to trusted
  };
});

vi.mock('./sandboxConfig.js', () => ({
  loadSandboxConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs', async (importOriginal) => {
  const actualFs = await importOriginal<typeof import('fs')>();
  const pathMod = await import('node:path');
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

vi.mock('os', async (importOriginal) => {
  const actualOs = await importOriginal<typeof os>();
  return {
    ...actualOs,
    homedir: vi.fn(() => path.resolve(path.sep, 'mock', 'home', 'user')),
  };
});

vi.mock('open', () => ({
  default: vi.fn(),
}));

vi.mock('read-package-up', () => ({
  readPackageUp: vi.fn(() =>
    Promise.resolve({ packageJson: { version: 'test-version' } }),
  ),
}));

const runtimeSettingsState = vi.hoisted(() => ({
  context: null as {
    settingsService: SettingsService;
    config: ServerConfig.Config | null;
    runtimeId: string;
    metadata?: Record<string, unknown>;
  } | null,
  providerManager: null as ServerConfig.ProviderManager | null,
  oauthManager: null as unknown,
}));

vi.mock('@vybestack/llxprt-code-providers/runtime/runtimeSettings.js', () => {
  const getProviderManager = () =>
    runtimeSettingsState.providerManager ??
    ({
      listProviders: vi.fn(() => []),
      getActiveProviderName: vi.fn(() => null),
      setActiveProvider: vi.fn(),
      getActiveProvider: vi.fn(() => null),
      getAvailableModels: vi.fn(async () => []),
    } as unknown as ServerConfig.ProviderManager);

  return {
    registerAgentRuntimeFactories: vi.fn(),
    resetAgentRuntimeFactories: vi.fn(),
    applyProfileSnapshot: vi.fn(
      async (profile: {
        provider?: string;
        model?: string;
        baseUrl?: string;
      }) => ({
        providerName: profile.provider ?? '',
        modelName: profile.model ?? '',
        baseUrl: profile.baseUrl,
        warnings: [],
      }),
    ),
    getCliRuntimeContext: vi.fn(() => runtimeSettingsState.context),
    setCliRuntimeContext: vi.fn(
      (
        settingsService: SettingsService,
        config?: ServerConfig.Config,
        options: {
          metadata?: Record<string, unknown>;
          runtimeId?: string;
        } = {},
      ) => {
        runtimeSettingsState.context = {
          settingsService,
          config: config ?? null,
          runtimeId: options.runtimeId ?? 'mock-runtime',
          metadata: options.metadata ?? {},
        };
      },
    ),
    switchActiveProvider: vi.fn(async () => ({
      changed: true,
      previousProvider: null,
      nextProvider: 'mock-provider',
      infoMessages: [],
    })),
    registerCliProviderInfrastructure: vi.fn(
      (manager: ServerConfig.ProviderManager, oauthManager: unknown) => {
        runtimeSettingsState.providerManager = manager;
        runtimeSettingsState.oauthManager = oauthManager ?? null;
      },
    ),
    applyCliArgumentOverrides: vi.fn(async () => {}),
    getCliRuntimeConfig: vi.fn(
      () => runtimeSettingsState.context?.config ?? null,
    ),
    getCliRuntimeServices: vi.fn(() => ({
      config: runtimeSettingsState.context?.config ?? null,
      settingsService:
        runtimeSettingsState.context?.settingsService ?? new SettingsService(),
      providerManager: getProviderManager(),
    })),
    getCliProviderManager: vi.fn(() => runtimeSettingsState.providerManager),
    getCliOAuthManager: vi.fn(() => runtimeSettingsState.oauthManager ?? null),
    getActiveProviderStatus: vi.fn(() => ({
      name:
        runtimeSettingsState.providerManager?.getActiveProviderName() ??
        runtimeSettingsState.context?.config?.getProvider() ??
        null,
    })),
    listProviders: vi.fn(() => getProviderManager().listProviders()),
    getActiveProviderName: vi.fn(() =>
      getProviderManager().getActiveProviderName(),
    ),
    setActiveModel: vi.fn(async () => ({
      changed: false,
      previousModel: null,
      nextModel: null,
      infoMessages: [],
    })),
    listAvailableModels: vi.fn(async () =>
      getProviderManager().getAvailableModels(),
    ),
    getActiveModelName: vi.fn(() => null),
    getActiveModelParams: vi.fn(() => ({})),
    getEphemeralSettings: vi.fn(() => ({})),
    getEphemeralSetting: vi.fn(() => undefined),
    setEphemeralSetting: vi.fn(),
    setActiveModelParam: vi.fn(),
    clearActiveModelParam: vi.fn(),
    saveProfileSnapshot: vi.fn(async () => undefined),
    saveLoadBalancerProfile: vi.fn(async () => undefined),
    loadProfileByName: vi.fn(async () => undefined),
    deleteProfileByName: vi.fn(async () => undefined),
    listSavedProfiles: vi.fn(() => []),
    getProfileByName: vi.fn(() => undefined),
    setDefaultProfileName: vi.fn(),
    updateActiveProviderBaseUrl: vi.fn(async () => undefined),
    updateActiveProviderApiKey: vi.fn(async () => undefined),
    getRuntimeDiagnosticsSnapshot: vi.fn(() => ({})),
    getActiveToolFormatState: vi.fn(() => ({})),
    setActiveToolFormatOverride: vi.fn(),
    getActiveProviderMetrics: vi.fn(() => undefined),
    getSessionTokenUsage: vi.fn(() => undefined),
    getLoadBalancerStats: vi.fn(() => undefined),
    getLoadBalancerLastSelected: vi.fn(() => undefined),
    getAllLoadBalancerStats: vi.fn(() => ({})),
  };
});

vi.mock('@vybestack/llxprt-code-core', async () => {
  const actualServer = await vi.importActual<typeof ServerConfig>(
    '@vybestack/llxprt-code-core',
  );
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
      respectGeminiIgnore: true,
    },
    DEFAULT_FILE_FILTERING_OPTIONS: {
      respectGitIgnore: true,
      respectGeminiIgnore: true,
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

describe('when folder is NOT trusted', () => {
  beforeEach(() => {
    resetRuntimeSettingsState();
    vi.mocked(isWorkspaceTrusted).mockReturnValue(false);
  });

  it('should override --approval-mode=yolo to DEFAULT', async () => {
    process.argv = ['node', 'script.js', '--approval-mode', 'yolo'];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      {},
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.getApprovalMode()).toBe(ServerConfig.ApprovalMode.DEFAULT);
  });

  it('should override --approval-mode=auto_edit to DEFAULT', async () => {
    process.argv = ['node', 'script.js', '--approval-mode', 'auto_edit'];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      {},
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.getApprovalMode()).toBe(ServerConfig.ApprovalMode.DEFAULT);
  });

  it('should override --yolo flag to DEFAULT', async () => {
    process.argv = ['node', 'script.js', '--yolo'];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      {},
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.getApprovalMode()).toBe(ServerConfig.ApprovalMode.DEFAULT);
  });

  it('should remain DEFAULT when --approval-mode=default', async () => {
    process.argv = ['node', 'script.js', '--approval-mode', 'default'];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      {},
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.getApprovalMode()).toBe(ServerConfig.ApprovalMode.DEFAULT);
  });
});

describe('parseArguments', () => {
  const originalArgv = process.argv;

  beforeEach(() => resetRuntimeSettingsState());

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('should throw an error when both --prompt and --prompt-interactive are used together', async () => {
    process.argv = [
      'node',
      'script.js',
      '--prompt',
      'test prompt',
      '--prompt-interactive',
      'interactive prompt',
    ];

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    const mockConsoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await expect(parseArguments({} as Settings)).rejects.toThrow(
      'process.exit called',
    );

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        'Cannot use both --prompt (-p) and --prompt-interactive (-i) together',
      ),
    );

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  it('should throw an error when using short flags -p and -i together', async () => {
    process.argv = [
      'node',
      'script.js',
      '-p',
      'test prompt',
      '-i',
      'interactive prompt',
    ];

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    const mockConsoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await expect(parseArguments({} as Settings)).rejects.toThrow(
      'process.exit called',
    );

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        'Cannot use both --prompt (-p) and --prompt-interactive (-i) together',
      ),
    );

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  it('should allow --prompt without --prompt-interactive', async () => {
    process.argv = ['node', 'script.js', '--prompt', 'test prompt'];
    const argv = await parseArguments({} as Settings);
    expect(argv.prompt).toBe('test prompt');
    expect(argv.promptInteractive).toBeUndefined();
  });

  it('should allow --prompt-interactive without --prompt', async () => {
    process.argv = [
      'node',
      'script.js',
      '--prompt-interactive',
      'interactive prompt',
    ];
    const argv = await parseArguments({} as Settings);
    expect(argv.promptInteractive).toBe('interactive prompt');
    expect(argv.prompt).toBeUndefined();
  });

  it('should allow -i flag as alias for --prompt-interactive', async () => {
    process.argv = ['node', 'script.js', '-i', 'interactive prompt'];
    const argv = await parseArguments({} as Settings);
    expect(argv.promptInteractive).toBe('interactive prompt');
    expect(argv.prompt).toBeUndefined();
  });

  it('should convert positional query argument to prompt by default', async () => {
    process.argv = ['node', 'script.js', 'Hi Gemini'];
    const argv = await parseArguments({} as Settings);
    expect(argv.query).toBe('Hi Gemini');
    expect(argv.prompt).toBe('Hi Gemini');
    expect(argv.promptInteractive).toBeUndefined();
  });

  it('should map @path to prompt (one-shot) when it starts with @', async () => {
    process.argv = ['node', 'script.js', '@path ./file.md'];
    const argv = await parseArguments({} as Settings);
    expect(argv.query).toBe('@path ./file.md');
    expect(argv.prompt).toBe('@path ./file.md');
    expect(argv.promptInteractive).toBeUndefined();
  });

  it('should map @path to prompt even when config flags are present', async () => {
    // @path queries should now go to one-shot mode regardless of other flags
    process.argv = [
      'node',
      'script.js',
      '@path',
      './file.md',
      '--model',
      'gemini-2.5-pro',
    ];
    const argv = await parseArguments({} as Settings);
    expect(argv.query).toBe('@path ./file.md');
    expect(argv.prompt).toBe('@path ./file.md'); // Should map to one-shot
    expect(argv.promptInteractive).toBeUndefined();
    expect(argv.model).toBe('gemini-2.5-pro');
  });

  it('maps unquoted positional @path + arg to prompt (one-shot)', async () => {
    // Simulate: gemini @path ./file.md
    process.argv = ['node', 'script.js', '@path', './file.md'];
    const argv = await parseArguments({} as Settings);
    // After normalization, query is a single string
    expect(argv.query).toBe('@path ./file.md');
    // And it's mapped to one-shot prompt when no -p/-i flags are set
    expect(argv.prompt).toBe('@path ./file.md');
    expect(argv.promptInteractive).toBeUndefined();
  });

  it('should handle multiple @path arguments in a single command (one-shot)', async () => {
    // Simulate: gemini @path ./file1.md @path ./file2.md
    process.argv = [
      'node',
      'script.js',
      '@path',
      './file1.md',
      '@path',
      './file2.md',
    ];
    const argv = await parseArguments({} as Settings);
    // After normalization, all arguments are joined with spaces
    expect(argv.query).toBe('@path ./file1.md @path ./file2.md');
    // And it's mapped to one-shot prompt
    expect(argv.prompt).toBe('@path ./file1.md @path ./file2.md');
    expect(argv.promptInteractive).toBeUndefined();
  });

  it('should handle mixed quoted and unquoted @path arguments (one-shot)', async () => {
    // Simulate: gemini "@path ./file1.md" @path ./file2.md "additional text"
    process.argv = [
      'node',
      'script.js',
      '@path ./file1.md',
      '@path',
      './file2.md',
      'additional text',
    ];
    const argv = await parseArguments({} as Settings);
    // After normalization, all arguments are joined with spaces
    expect(argv.query).toBe(
      '@path ./file1.md @path ./file2.md additional text',
    );
    // And it's mapped to one-shot prompt
    expect(argv.prompt).toBe(
      '@path ./file1.md @path ./file2.md additional text',
    );
    expect(argv.promptInteractive).toBeUndefined();
  });

  it('should map @path to prompt with ambient flags (debug)', async () => {
    // Ambient flags like debug should NOT affect routing
    process.argv = ['node', 'script.js', '@path', './file.md', '--debug'];
    const argv = await parseArguments({} as Settings);
    expect(argv.query).toBe('@path ./file.md');
    expect(argv.prompt).toBe('@path ./file.md'); // Should map to one-shot
    expect(argv.promptInteractive).toBeUndefined();
    expect(argv.debug).toBe(true);
  });

  it('should map any @command to prompt (one-shot)', async () => {
    // Test that all @commands now go to one-shot mode
    const testCases = [
      '@path ./file.md',
      '@include src/',
      '@search pattern',
      '@web query',
      '@git status',
    ];

    for (const testQuery of testCases) {
      process.argv = ['node', 'script.js', testQuery];
      const argv = await parseArguments({} as Settings);
      expect(argv.query).toBe(testQuery);
      expect(argv.prompt).toBe(testQuery);
      expect(argv.promptInteractive).toBeUndefined();
    }
  });

  it('should handle @command with leading whitespace', async () => {
    // Test that trim() + routing handles leading whitespace correctly
    process.argv = ['node', 'script.js', '  @path ./file.md'];
    const argv = await parseArguments({} as Settings);
    expect(argv.query).toBe('  @path ./file.md');
    expect(argv.prompt).toBe('  @path ./file.md');
    expect(argv.promptInteractive).toBeUndefined();
  });

  it('should throw an error when both --yolo and --approval-mode are used together', async () => {
    process.argv = [
      'node',
      'script.js',
      '--yolo',
      '--approval-mode',
      'default',
    ];

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    const mockConsoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await expect(parseArguments({} as Settings)).rejects.toThrow(
      'process.exit called',
    );

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        'Cannot use both --yolo (-y) and --approval-mode together. Use --approval-mode=yolo instead.',
      ),
    );

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  it('should throw an error when using short flags -y and --approval-mode together', async () => {
    process.argv = ['node', 'script.js', '-y', '--approval-mode', 'yolo'];

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    const mockConsoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await expect(parseArguments({} as Settings)).rejects.toThrow(
      'process.exit called',
    );

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        'Cannot use both --yolo (-y) and --approval-mode together. Use --approval-mode=yolo instead.',
      ),
    );

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  it('should allow --approval-mode without --yolo', async () => {
    process.argv = ['node', 'script.js', '--approval-mode', 'auto_edit'];
    const argv = await parseArguments({} as Settings);
    expect(argv.approvalMode).toBe('auto_edit');
    expect(argv.yolo).toBe(false);
  });

  it('should allow --yolo without --approval-mode', async () => {
    process.argv = ['node', 'script.js', '--yolo'];
    const argv = await parseArguments({} as Settings);
    expect(argv.yolo).toBe(true);
    expect(argv.approvalMode).toBeUndefined();
  });

  it('should reject invalid --approval-mode values', async () => {
    process.argv = ['node', 'script.js', '--approval-mode', 'invalid'];

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    const mockConsoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await expect(parseArguments({} as Settings)).rejects.toThrow(
      'process.exit called',
    );
    const errorOutput = mockConsoleError.mock.calls
      .map(([msg]) => String(msg))
      .join('\n');
    expect(errorOutput).toMatch(/Invalid values/i);

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  it('should preserve bare --continue sentinel without coercing to string true', async () => {
    process.argv = ['node', 'script.js', '--continue'];
    const argv = await parseArguments({} as Settings);

    expect(argv.continue === '' || argv.continue === true).toBe(true);
    expect(argv.continue).not.toBe('true');
  });

  it('should normalize bare --continue to true through loadCliConfig', async () => {
    process.argv = ['node', 'script.js', '--continue'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {};

    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    try {
      const config = await loadCliConfig(
        settings,
        [],
        new ExtensionEnablementManager(
          ExtensionStorage.getUserExtensionsDir(),
          argv.extensions,
        ),
        'test-session',
        argv,
      );

      expect(config.isContinueSession()).toBe(true);
      expect(config.getContinueSessionRef()).toBe('__CONTINUE_LATEST__');
    } finally {
      clearActiveProviderRuntimeContext();
    }
  });

  it('should preserve explicit --continue session id string', async () => {
    process.argv = ['node', 'script.js', '--continue', 'session-123'];
    const argv = await parseArguments({} as Settings);
    expect(argv.continue).toBe('session-123');
  });

  it('should not consume following flag as --continue session id', async () => {
    process.argv = ['node', 'script.js', '--continue', '--debug'];
    const argv = await parseArguments({} as Settings);
    expect(argv.continue === '' || argv.continue === true).toBe(true);
    expect(argv.debug).toBe(true);
  });

  it('should support comma-separated values for --allowed-tools', async () => {
    process.argv = [
      'node',
      'script.js',
      '--allowed-tools',
      'read_file,ShellTool(git status)',
    ];
    const argv = await parseArguments({} as Settings);
    expect(argv.allowedTools).toStrictEqual([
      'read_file',
      'ShellTool(git status)',
    ]);
  });

  it('should support comma-separated values for --allowed-mcp-server-names', async () => {
    process.argv = [
      'node',
      'script.js',
      '--allowed-mcp-server-names',
      'server1,server2',
    ];
    const argv = await parseArguments({} as Settings);
    expect(argv.allowedMcpServerNames).toStrictEqual(['server1', 'server2']);
  });

  it('should support comma-separated values for --extensions', async () => {
    process.argv = ['node', 'script.js', '--extensions', 'ext1,ext2'];
    const argv = await parseArguments({} as Settings);
    expect(argv.extensions).toStrictEqual(['ext1', 'ext2']);
  });
});

describe('loadCliConfig', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    resetRuntimeSettingsState();
    vi.clearAllMocks();
    vi.mocked(os.homedir).mockReturnValue(
      path.resolve(path.sep, 'mock', 'home', 'user'),
    );
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    vi.spyOn(process, 'cwd').mockReturnValue(
      path.resolve(path.sep, 'home', 'user', 'project'),
    );
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('should combine and resolve paths from settings and CLI arguments', async () => {
    const mockCwd = path.resolve(path.sep, 'home', 'user', 'project');
    process.argv = [
      'node',
      'script.js',
      '--include-directories',
      `${path.resolve(path.sep, 'cli', 'path1')},${path.join(mockCwd, 'cli', 'path2')}`,
    ];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      includeDirectories: [
        path.resolve(path.sep, 'settings', 'path1'),
        path.join(os.homedir(), 'settings', 'path2'),
        path.join(mockCwd, 'settings', 'path3'),
      ],
      experimental: {
        jitContext: false,
      },
    };
    const config = await loadCliConfig(
      settings,
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    const expectedIncludeDirectories = [
      path.resolve(path.sep, 'settings', 'path1'),
      path.join(os.homedir(), 'settings', 'path2'),
      path.join(mockCwd, 'settings', 'path3'),
      path.resolve(path.sep, 'cli', 'path1'),
      path.join(mockCwd, 'cli', 'path2'),
    ];
    const loadMemoryMock = vi.mocked(ServerConfig.loadServerHierarchicalMemory);
    expect(loadMemoryMock).toHaveBeenCalled();
    expect(loadMemoryMock.mock.calls.at(-1)?.[0]).toBe(process.cwd());
    expect(loadMemoryMock.mock.calls.at(-1)?.[1]).toStrictEqual(
      expectedIncludeDirectories,
    );
    expect(config.shouldLoadMemoryFromIncludeDirectories()).toBe(true);
  });
});
