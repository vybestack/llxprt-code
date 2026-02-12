/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ShellTool,
  EditTool,
  WriteFileTool,
  DEFAULT_GEMINI_MODEL,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  clearActiveProviderRuntimeContext,
  isRipgrepAvailable,
  type GeminiCLIExtension,
} from '@vybestack/llxprt-code-core';
import { loadCliConfig, parseArguments, type CliArgs } from './config.js';
import type { Settings } from './settings.js';
import { ExtensionStorage } from './extension.js';
import * as ServerConfig from '@vybestack/llxprt-code-core';
import { isWorkspaceTrusted } from './trustedFolders.js';
import { ExtensionEnablementManager } from './extensions/extensionEnablement.js';
import { RESUME_LATEST } from '../utils/sessionUtils.js';

vi.mock('./trustedFolders.js', () => ({
  isWorkspaceTrusted: vi.fn().mockReturnValue(true), // Default to trusted
}));

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
      return (actualFs as typeof import('fs')).statSync(p as unknown as string);
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
    settingsService: ServerConfig.SettingsService;
    config: ServerConfig.Config | null;
    runtimeId: string;
    metadata?: Record<string, unknown>;
  } | null,
  providerManager: null as ServerConfig.ProviderManager | null,
  oauthManager: null as unknown,
}));

vi.mock('../runtime/runtimeSettings.js', () => ({
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
      settingsService: ServerConfig.SettingsService,
      config?: ServerConfig.Config,
      options: { metadata?: Record<string, unknown>; runtimeId?: string } = {},
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
      runtimeSettingsState.context?.settingsService ??
      new ServerConfig.SettingsService(),
    providerManager:
      runtimeSettingsState.providerManager ??
      ({
        listProviders: () => [],
        getActiveProviderName: () => null,
        setActiveProvider: vi.fn(),
        getActiveProvider: vi.fn(() => null),
      } as unknown as ServerConfig.ProviderManager),
  })),
  getCliProviderManager: vi.fn(() => runtimeSettingsState.providerManager),
  getActiveProviderStatus: vi.fn(() => ({
    name:
      runtimeSettingsState.providerManager?.getActiveProviderName?.() ??
      runtimeSettingsState.context?.config?.getProvider?.() ??
      null,
  })),
  getCliOAuthManager: vi.fn(() => runtimeSettingsState.oauthManager ?? null),
}));

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
          memoryContent: extensionPaths?.join(',') || '',
          fileCount: extensionPaths?.length || 0,
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

beforeEach(() => {
  runtimeSettingsState.context = null;
  runtimeSettingsState.providerManager = null;
  runtimeSettingsState.oauthManager = null;
});

describe('parseArguments', () => {
  const originalArgv = process.argv;

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

  it('should allow resuming a session without prompt in non-interactive mode', async () => {
    const originalIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = false;
    process.argv = ['node', 'script.js', '--resume', 'session-id'];

    try {
      const args = await parseArguments({} as Settings);
      expect(args.resume).toBe('session-id');
    } finally {
      process.stdin.isTTY = originalIsTTY;
    }
  });

  it('should return RESUME_LATEST constant when --resume is passed without a value', async () => {
    const originalIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = true; // Make it interactive to avoid validation error
    process.argv = ['node', 'script.js', '--resume'];

    try {
      const argv = await parseArguments({} as Settings);
      expect(argv.resume).toBe(RESUME_LATEST);
      expect(argv.resume).toBe('latest');
    } finally {
      process.stdin.isTTY = originalIsTTY;
    }
  });

  it('should support comma-separated values for --allowed-tools', async () => {
    process.argv = [
      'node',
      'script.js',
      '--allowed-tools',
      'read_file,ShellTool(git status)',
    ];
    const argv = await parseArguments({} as Settings);
    expect(argv.allowedTools).toEqual(['read_file', 'ShellTool(git status)']);
  });

  it('should support comma-separated values for --allowed-mcp-server-names', async () => {
    process.argv = [
      'node',
      'script.js',
      '--allowed-mcp-server-names',
      'server1,server2',
    ];
    const argv = await parseArguments({} as Settings);
    expect(argv.allowedMcpServerNames).toEqual(['server1', 'server2']);
  });

  it('should support comma-separated values for --extensions', async () => {
    process.argv = ['node', 'script.js', '--extensions', 'ext1,ext2'];
    const argv = await parseArguments({} as Settings);
    expect(argv.extensions).toEqual(['ext1', 'ext2']);
  });
});

describe('loadCliConfig', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home/user');
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('should set showMemoryUsage to true when --show-memory-usage flag is present', async () => {
    process.argv = ['node', 'script.js', '--show-memory-usage'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {};
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
    expect(config.getShowMemoryUsage()).toBe(true);
  });

  it('should set showMemoryUsage to false when --memory flag is not present', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {};
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
    expect(config.getShowMemoryUsage()).toBe(false);
  });

  it('should set showMemoryUsage to false by default from settings if CLI flag is not present', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = { ui: { showMemoryUsage: false } };
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
    expect(config.getShowMemoryUsage()).toBe(false);
  });

  it('should prioritize CLI flag over settings for showMemoryUsage (CLI true, settings false)', async () => {
    process.argv = ['node', 'script.js', '--show-memory-usage'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = { ui: { showMemoryUsage: false } };
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
    expect(config.getShowMemoryUsage()).toBe(true);
  });

  describe('Proxy configuration', () => {
    const originalProxyEnv: { [key: string]: string | undefined } = {};
    const proxyEnvVars = [
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'http_proxy',
      'https_proxy',
    ];

    beforeEach(() => {
      for (const key of proxyEnvVars) {
        originalProxyEnv[key] = process.env[key];
        delete process.env[key];
      }
    });

    afterEach(() => {
      for (const key of proxyEnvVars) {
        if (originalProxyEnv[key]) {
          process.env[key] = originalProxyEnv[key];
        } else {
          delete process.env[key];
        }
      }
    });

    it(`should leave proxy to empty by default`, async () => {
      process.argv = ['node', 'script.js'];
      const argv = await parseArguments({} as Settings);
      const settings: Settings = {};
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
      expect(config.getProxy()).toBeFalsy();
    });

    const proxy_url = 'http://localhost:7890';
    const testCases = [
      {
        input: {
          env_name: 'https_proxy',
          proxy_url,
        },
        expected: proxy_url,
      },
      {
        input: {
          env_name: 'http_proxy',
          proxy_url,
        },
        expected: proxy_url,
      },
      {
        input: {
          env_name: 'HTTPS_PROXY',
          proxy_url,
        },
        expected: proxy_url,
      },
      {
        input: {
          env_name: 'HTTP_PROXY',
          proxy_url,
        },
        expected: proxy_url,
      },
    ];
    testCases.forEach(({ input, expected }) => {
      it(`should set proxy to ${expected} according to environment variable [${input.env_name}]`, async () => {
        vi.stubEnv(input.env_name, input.proxy_url);
        process.argv = ['node', 'script.js'];
        const argv = await parseArguments({} as Settings);
        const settings: Settings = {};
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
        expect(config.getProxy()).toBe(expected);
      });
    });

    it('should set proxy when --proxy flag is present', async () => {
      process.argv = ['node', 'script.js', '--proxy', 'http://localhost:7890'];
      const argv = await parseArguments({} as Settings);
      const settings: Settings = {};
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
      expect(config.getProxy()).toBe('http://localhost:7890');
    });

    it('should prioritize CLI flag over environment variable for proxy (CLI http://localhost:7890, environment variable http://localhost:7891)', async () => {
      vi.stubEnv('http_proxy', 'http://localhost:7891');
      process.argv = ['node', 'script.js', '--proxy', 'http://localhost:7890'];
      const argv = await parseArguments({} as Settings);
      const settings: Settings = {};
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
      expect(config.getProxy()).toBe('http://localhost:7890');
    });
  });

  it('should use default fileFilter options when unconfigured', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {};
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
    // DEFAULT_FILE_FILTERING_OPTIONS has respectGitIgnore: true and respectLlxprtIgnore: true
    expect(config.getFileFilteringRespectGitIgnore()).toBe(true);
    expect(config.getFileFilteringRespectLlxprtIgnore()).toBe(true);
  });
});

describe('loadCliConfig telemetry', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home/user');
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('should set telemetry to false by default when no flag or setting is present', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {};
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
    expect(config.getTelemetryEnabled()).toBe(false);
  });

  it('should set telemetry to true when --telemetry flag is present', async () => {
    process.argv = ['node', 'script.js', '--telemetry'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {};
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
    expect(config.getTelemetryEnabled()).toBe(true);
  });

  it('should set telemetry to false when --no-telemetry flag is present', async () => {
    process.argv = ['node', 'script.js', '--no-telemetry'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {};
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
    expect(config.getTelemetryEnabled()).toBe(false);
  });

  it('should use telemetry value from settings if CLI flag is not present (settings true)', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = { telemetry: { enabled: true } };
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
    expect(config.getTelemetryEnabled()).toBe(true);
  });

  it('should use telemetry value from settings if CLI flag is not present (settings false)', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = { telemetry: { enabled: false } };
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
    expect(config.getTelemetryEnabled()).toBe(false);
  });

  it('should prioritize --telemetry CLI flag (true) over settings (false)', async () => {
    process.argv = ['node', 'script.js', '--telemetry'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = { telemetry: { enabled: false } };
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
    expect(config.getTelemetryEnabled()).toBe(true);
  });

  it('should prioritize --no-telemetry CLI flag (false) over settings (true)', async () => {
    process.argv = ['node', 'script.js', '--no-telemetry'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = { telemetry: { enabled: true } };
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
    expect(config.getTelemetryEnabled()).toBe(false);
  });

  it('should use telemetry OTLP endpoint from settings if CLI flag is not present', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      telemetry: { otlpEndpoint: 'http://settings.example.com' },
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
    expect(config.getTelemetryOtlpEndpoint()).toBe(
      'http://settings.example.com',
    );
  });

  it('should prioritize --telemetry-otlp-endpoint CLI flag over settings', async () => {
    process.argv = [
      'node',
      'script.js',
      '--telemetry-otlp-endpoint',
      'http://cli.example.com',
    ];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      telemetry: { otlpEndpoint: 'http://settings.example.com' },
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
    expect(config.getTelemetryOtlpEndpoint()).toBe('http://cli.example.com');
  });

  it('should use default endpoint if no OTLP endpoint is provided via CLI or settings', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = { telemetry: { enabled: true } };
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
    expect(config.getTelemetryOtlpEndpoint()).toBe('http://localhost:4317');
  });

  it('should use telemetry target from settings if CLI flag is not present', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      telemetry: { target: ServerConfig.DEFAULT_TELEMETRY_TARGET },
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
    expect(config.getTelemetryTarget()).toBe(
      ServerConfig.DEFAULT_TELEMETRY_TARGET,
    );
  });

  it('should prioritize --telemetry-target CLI flag over settings', async () => {
    process.argv = ['node', 'script.js', '--telemetry-target', 'gcp'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      telemetry: { target: ServerConfig.DEFAULT_TELEMETRY_TARGET },
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
    expect(config.getTelemetryTarget()).toBe('gcp');
  });

  it('should use default target if no target is provided via CLI or settings', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = { telemetry: { enabled: true } };
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
    expect(config.getTelemetryTarget()).toBe(
      ServerConfig.DEFAULT_TELEMETRY_TARGET,
    );
  });

  it('should use telemetry log prompts from settings if CLI flag is not present', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = { telemetry: { logPrompts: false } };
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
    expect(config.getTelemetryLogPromptsEnabled()).toBe(false);
  });

  it('should prioritize --telemetry-log-prompts CLI flag (true) over settings (false)', async () => {
    process.argv = ['node', 'script.js', '--telemetry-log-prompts'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = { telemetry: { logPrompts: false } };
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
    expect(config.getTelemetryLogPromptsEnabled()).toBe(true);
  });

  it('should prioritize --no-telemetry-log-prompts CLI flag (false) over settings (true)', async () => {
    process.argv = ['node', 'script.js', '--no-telemetry-log-prompts'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = { telemetry: { logPrompts: true } };
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
    expect(config.getTelemetryLogPromptsEnabled()).toBe(false);
  });

  it('should use default log prompts (true) if no value is provided via CLI or settings', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = { telemetry: { enabled: true } };
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
    expect(config.getTelemetryLogPromptsEnabled()).toBe(true);
  });

  // External telemetry upload turned off (GCP reporting removed), so we no longer
  // honor OTLP protocol overrides.
});

describe('Hierarchical Memory Loading (config.ts) - Placeholder Suite', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home/user');
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    // Other common mocks would be reset here.
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('should pass extension context file paths to loadServerHierarchicalMemory', async () => {
    process.argv = ['node', 'script.js'];
    const settings: Settings = {};
    const extensions: GeminiCLIExtension[] = [
      {
        path: '/path/to/ext1',
        name: 'ext1',
        version: '1.0.0',
        contextFiles: ['/path/to/ext1/GEMINI.md'],
        isActive: true,
      },
      {
        path: '/path/to/ext2',
        name: 'ext2',
        version: '1.0.0',
        contextFiles: [],
        isActive: true,
      },
      {
        path: '/path/to/ext3',
        name: 'ext3',
        version: '1.0.0',
        contextFiles: [
          '/path/to/ext3/context1.md',
          '/path/to/ext3/context2.md',
        ],
        isActive: true,
      },
    ];
    const argv = await parseArguments({} as Settings);
    await loadCliConfig(
      settings,
      extensions,

      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'session-id',
      argv,
    );
    expect(ServerConfig.loadServerHierarchicalMemory).toHaveBeenCalledWith(
      expect.any(String),
      [],
      false,
      expect.any(Object),
      expect.arrayContaining([
        expect.objectContaining({
          name: 'ext1',
          contextFiles: ['/path/to/ext1/GEMINI.md'],
        }),
        expect.objectContaining({
          name: 'ext2',
          contextFiles: [],
        }),
        expect.objectContaining({
          name: 'ext3',
          contextFiles: [
            '/path/to/ext3/context1.md',
            '/path/to/ext3/context2.md',
          ],
        }),
      ]),
      true,
      'tree',
      {
        respectGitIgnore: false,
        respectGeminiIgnore: true,
      },
      undefined, // maxDirs
      undefined, // maxDepth
    );
  });

  // NOTE TO FUTURE DEVELOPERS:
  // To re-enable tests for loadHierarchicalGeminiMemory, ensure that:
  // 1. os.homedir() is reliably mocked *before* the config.ts module is loaded
  //    and its functions (which use os.homedir()) are called.
  // 2. fs/promises and fs mocks correctly simulate file/directory existence,
  //    readability, and content based on paths derived from the mocked os.homedir().
  // 3. Spies on console functions (for logger output) are correctly set up if needed.
  // Example of a previously failing test structure:
  it.skip('should correctly use mocked homedir for global path', async () => {
    const MOCK_GEMINI_DIR_LOCAL = path.join('/mock/home/user', '.gemini');
    const MOCK_GLOBAL_PATH_LOCAL = path.join(
      MOCK_GEMINI_DIR_LOCAL,
      'GEMINI.md',
    );
    mockFs({
      [MOCK_GLOBAL_PATH_LOCAL]: { type: 'file', content: 'GlobalContentOnly' },
    });
    const memory = await loadHierarchicalGeminiMemory('/some/other/cwd', false);
    expect(memory).toBe('GlobalContentOnly');
    expect(vi.mocked(os.homedir)).toHaveBeenCalled();
    expect(fsPromises.readFile).toHaveBeenCalledWith(
      MOCK_GLOBAL_PATH_LOCAL,
      'utf-8',
    );
  });
});

describe('mergeMcpServers', () => {
  beforeEach(() => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  it('should not modify the original settings object', async () => {
    const settings: Settings = {
      mcpServers: {
        'test-server': {
          url: 'http://localhost:8080',
        },
      },
    };
    const extensions: GeminiCLIExtension[] = [
      {
        path: '/path/to/ext1',
        name: 'ext1',
        version: '1.0.0',
        mcpServers: {
          'ext1-server': {
            url: 'http://localhost:8081',
          },
        },
        contextFiles: [],
        isActive: true,
      },
    ];
    const originalSettings = JSON.parse(JSON.stringify(settings));
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    await loadCliConfig(
      settings,
      extensions,
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(settings).toEqual(originalSettings);
  });
});

describe('mergeExcludeTools', () => {
  const defaultExcludes = [ShellTool.Name, EditTool.Name, WriteFileTool.Name];
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    process.stdin.isTTY = true;
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  afterEach(() => {
    process.stdin.isTTY = originalIsTTY;
    clearActiveProviderRuntimeContext();
  });

  it('should merge excludeTools from settings and extensions', async () => {
    const settings: Settings = { excludeTools: ['tool1', 'tool2'] };
    const extensions: GeminiCLIExtension[] = [
      {
        path: '/path/to/ext1',
        name: 'ext1',
        version: '1.0.0',
        excludeTools: ['tool3', 'tool4'],
        contextFiles: [],
        isActive: true,
      },
      {
        path: '/path/to/ext2',
        name: 'ext2',
        version: '1.0.0',
        excludeTools: ['tool5'],
        contextFiles: [],
        isActive: true,
      },
    ];
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      settings,
      extensions,
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.getExcludeTools()).toEqual(
      expect.arrayContaining(['tool1', 'tool2', 'tool3', 'tool4', 'tool5']),
    );
    expect(config.getExcludeTools()).toHaveLength(5);
  });

  it('should handle overlapping excludeTools between settings and extensions', async () => {
    const settings: Settings = { excludeTools: ['tool1', 'tool2'] };
    const extensions: GeminiCLIExtension[] = [
      {
        path: '/path/to/ext1',
        name: 'ext1',
        version: '1.0.0',
        excludeTools: ['tool2', 'tool3'],
        contextFiles: [],
        isActive: true,
      },
    ];
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      settings,
      extensions,
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.getExcludeTools()).toEqual(
      expect.arrayContaining(['tool1', 'tool2', 'tool3']),
    );
    expect(config.getExcludeTools()).toHaveLength(3);
  });

  it('should handle overlapping excludeTools between extensions', async () => {
    const settings: Settings = { excludeTools: ['tool1'] };
    const extensions: GeminiCLIExtension[] = [
      {
        path: '/path/to/ext1',
        name: 'ext1',
        version: '1.0.0',
        excludeTools: ['tool2', 'tool3'],
        contextFiles: [],
        isActive: true,
      },
      {
        path: '/path/to/ext2',
        name: 'ext2',
        version: '1.0.0',
        excludeTools: ['tool3', 'tool4'],
        contextFiles: [],
        isActive: true,
      },
    ];
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      settings,
      extensions,
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.getExcludeTools()).toEqual(
      expect.arrayContaining(['tool1', 'tool2', 'tool3', 'tool4']),
    );
    expect(config.getExcludeTools()).toHaveLength(4);
  });

  it('should return an empty array when no excludeTools are specified and it is interactive', async () => {
    process.stdin.isTTY = true;
    const settings: Settings = {};
    const extensions: GeminiCLIExtension[] = [];
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      settings,
      extensions,
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.getExcludeTools()).toEqual([]);
  });

  it('should return default excludes when no excludeTools are specified and it is not interactive', async () => {
    process.stdin.isTTY = false;
    const settings: Settings = {};
    const extensions: GeminiCLIExtension[] = [];
    process.argv = ['node', 'script.js', '-p', 'test'];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      settings,
      extensions,
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.getExcludeTools()).toEqual(defaultExcludes);
  });

  it('should handle settings with excludeTools but no extensions', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = { excludeTools: ['tool1', 'tool2'] };
    const extensions: GeminiCLIExtension[] = [];
    const config = await loadCliConfig(
      settings,
      extensions,
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.getExcludeTools()).toEqual(
      expect.arrayContaining(['tool1', 'tool2']),
    );
    expect(config.getExcludeTools()).toHaveLength(2);
  });

  it('should handle extensions with excludeTools but no settings', async () => {
    const settings: Settings = {};
    const extensions: GeminiCLIExtension[] = [
      {
        path: '/path/to/ext',
        name: 'ext1',
        version: '1.0.0',
        excludeTools: ['tool1', 'tool2'],
        contextFiles: [],
        isActive: true,
      },
    ];
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      settings,
      extensions,
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.getExcludeTools()).toEqual(
      expect.arrayContaining(['tool1', 'tool2']),
    );
    expect(config.getExcludeTools()).toHaveLength(2);
  });

  it('should not modify the original settings object', async () => {
    const settings: Settings = { excludeTools: ['tool1'] };
    const extensions: GeminiCLIExtension[] = [
      {
        path: '/path/to/ext',
        name: 'ext1',
        version: '1.0.0',
        excludeTools: ['tool2'],
        contextFiles: [],
        isActive: true,
      },
    ];
    const originalSettings = JSON.parse(JSON.stringify(settings));
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    await loadCliConfig(
      settings,
      extensions,
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(settings).toEqual(originalSettings);
  });
});

describe('Approval mode tool exclusion logic', () => {
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    process.stdin.isTTY = false; // Ensure non-interactive mode
    vi.mocked(isWorkspaceTrusted).mockReturnValue(true);
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  afterEach(() => {
    process.stdin.isTTY = originalIsTTY;
    clearActiveProviderRuntimeContext();
  });

  it('should exclude all interactive tools in non-interactive mode with default approval mode', async () => {
    process.argv = ['node', 'script.js', '-p', 'test'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {};
    const extensions: GeminiCLIExtension[] = [];

    const config = await loadCliConfig(
      settings,
      extensions,
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );

    const excludedTools = config.getExcludeTools();
    expect(excludedTools).toContain(ShellTool.Name);
    expect(excludedTools).toContain(EditTool.Name);
    expect(excludedTools).toContain(WriteFileTool.Name);
  });

  it('should exclude all interactive tools in non-interactive mode with explicit default approval mode', async () => {
    process.argv = [
      'node',
      'script.js',
      '--approval-mode',
      'default',
      '-p',
      'test',
    ];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {};
    const extensions: GeminiCLIExtension[] = [];

    const config = await loadCliConfig(
      settings,
      extensions,
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );

    const excludedTools = config.getExcludeTools();
    expect(excludedTools).toContain(ShellTool.Name);
    expect(excludedTools).toContain(EditTool.Name);
    expect(excludedTools).toContain(WriteFileTool.Name);
  });

  it('should exclude only shell tools in non-interactive mode with auto_edit approval mode', async () => {
    process.argv = [
      'node',
      'script.js',
      '--approval-mode',
      'auto_edit',
      '-p',
      'test',
    ];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {};
    const extensions: GeminiCLIExtension[] = [];

    const config = await loadCliConfig(
      settings,
      extensions,
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );

    const excludedTools = config.getExcludeTools();
    expect(excludedTools).toContain(ShellTool.Name);
    expect(excludedTools).not.toContain(EditTool.Name);
    expect(excludedTools).not.toContain(WriteFileTool.Name);
  });

  it('should exclude no interactive tools in non-interactive mode with yolo approval mode', async () => {
    process.argv = [
      'node',
      'script.js',
      '--approval-mode',
      'yolo',
      '-p',
      'test',
    ];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {};
    const extensions: GeminiCLIExtension[] = [];

    const config = await loadCliConfig(
      settings,
      extensions,
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );

    const excludedTools = config.getExcludeTools();
    expect(excludedTools).not.toContain(ShellTool.Name);
    expect(excludedTools).not.toContain(EditTool.Name);
    expect(excludedTools).not.toContain(WriteFileTool.Name);
  });

  it('should exclude no interactive tools in non-interactive mode with legacy yolo flag', async () => {
    process.argv = ['node', 'script.js', '--yolo', '-p', 'test'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {};
    const extensions: GeminiCLIExtension[] = [];

    const config = await loadCliConfig(
      settings,
      extensions,
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );

    const excludedTools = config.getExcludeTools();
    expect(excludedTools).not.toContain(ShellTool.Name);
    expect(excludedTools).not.toContain(EditTool.Name);
    expect(excludedTools).not.toContain(WriteFileTool.Name);
  });

  it('should not exclude interactive tools in interactive mode regardless of approval mode', async () => {
    process.stdin.isTTY = true; // Interactive mode

    const testCases = [
      { args: ['node', 'script.js'] }, // default
      { args: ['node', 'script.js', '--approval-mode', 'default'] },
      { args: ['node', 'script.js', '--approval-mode', 'auto_edit'] },
      { args: ['node', 'script.js', '--approval-mode', 'yolo'] },
      { args: ['node', 'script.js', '--yolo'] },
    ];

    for (const testCase of testCases) {
      process.argv = testCase.args;
      const argv = await parseArguments({} as Settings);
      const settings: Settings = {};
      const extensions: GeminiCLIExtension[] = [];

      const config = await loadCliConfig(
        settings,
        extensions,
        new ExtensionEnablementManager(
          ExtensionStorage.getUserExtensionsDir(),
          argv.extensions,
        ),
        'test-session',
        argv,
      );

      const excludedTools = config.getExcludeTools();
      expect(excludedTools).not.toContain(ShellTool.Name);
      expect(excludedTools).not.toContain(EditTool.Name);
      expect(excludedTools).not.toContain(WriteFileTool.Name);
    }
  });

  it('should merge approval mode exclusions with settings exclusions in auto_edit mode', async () => {
    process.argv = [
      'node',
      'script.js',
      '--approval-mode',
      'auto_edit',
      '-p',
      'test',
    ];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = { excludeTools: ['custom_tool'] };
    const extensions: GeminiCLIExtension[] = [];

    const config = await loadCliConfig(
      settings,
      extensions,
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );

    const excludedTools = config.getExcludeTools();
    expect(excludedTools).toContain('custom_tool'); // From settings
    expect(excludedTools).toContain(ShellTool.Name); // From approval mode
    expect(excludedTools).not.toContain(EditTool.Name); // Should be allowed in auto_edit
    expect(excludedTools).not.toContain(WriteFileTool.Name); // Should be allowed in auto_edit
  });

  it('should throw an error if YOLO mode is attempted when disableYoloMode is true', async () => {
    process.argv = ['node', 'script.js', '--yolo'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      security: {
        disableYoloMode: true,
      },
    };
    const extensions: GeminiCLIExtension[] = [];

    await expect(
      loadCliConfig(
        settings,
        extensions,
        new ExtensionEnablementManager(
          ExtensionStorage.getUserExtensionsDir(),
          argv.extensions,
        ),
        'test-session',
        argv,
      ),
    ).rejects.toThrow(
      'Cannot start in YOLO mode when it is disabled by settings',
    );
  });

  it('should throw an error for invalid approval mode values in loadCliConfig', async () => {
    // Create a mock argv with an invalid approval mode that bypasses argument parsing validation
    const invalidArgv: Partial<CliArgs> & { approvalMode: string } = {
      approvalMode: 'invalid_mode',
      promptInteractive: '',
      prompt: '',
      yolo: false,
    };

    const settings: Settings = {};
    const extensions: GeminiCLIExtension[] = [];
    await expect(
      loadCliConfig(
        settings,
        extensions,
        new ExtensionEnablementManager(
          ExtensionStorage.getUserExtensionsDir(),
          invalidArgv.extensions,
        ),
        'test-session',
        invalidArgv as CliArgs,
      ),
    ).rejects.toThrow(
      'Invalid approval mode: invalid_mode. Valid values are: yolo, auto_edit, default',
    );
  });
});

describe('loadCliConfig with allowed-mcp-server-names', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home/user');
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  const baseSettings: Settings = {
    mcpServers: {
      server1: { url: 'http://localhost:8080' },
      server2: { url: 'http://localhost:8081' },
      server3: { url: 'http://localhost:8082' },
    },
  };

  it('should allow all MCP servers if the flag is not provided', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      baseSettings,
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.getMcpServers()).toEqual(baseSettings.mcpServers);
  });

  it('should allow only the specified MCP server', async () => {
    process.argv = [
      'node',
      'script.js',
      '--allowed-mcp-server-names',
      'server1',
    ];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      baseSettings,
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.getMcpServers()).toEqual({
      server1: { url: 'http://localhost:8080' },
    });
  });

  it('should allow multiple specified MCP servers', async () => {
    process.argv = [
      'node',
      'script.js',
      '--allowed-mcp-server-names',
      'server1',
      '--allowed-mcp-server-names',
      'server3',
    ];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      baseSettings,
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.getMcpServers()).toEqual({
      server1: { url: 'http://localhost:8080' },
      server3: { url: 'http://localhost:8082' },
    });
  });

  it('should handle server names that do not exist', async () => {
    process.argv = [
      'node',
      'script.js',
      '--allowed-mcp-server-names',
      'server1',
      '--allowed-mcp-server-names',
      'server4',
    ];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      baseSettings,
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.getMcpServers()).toEqual({
      server1: { url: 'http://localhost:8080' },
    });
  });

  it('should allow no MCP servers if the flag is provided but empty', async () => {
    process.argv = ['node', 'script.js', '--allowed-mcp-server-names', ''];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      baseSettings,
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.getMcpServers()).toEqual({});
  });

  it('should read allowMCPServers from settings', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      ...baseSettings,
      allowMCPServers: ['server1', 'server2'],
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
    expect(config.getMcpServers()).toEqual({
      server1: { url: 'http://localhost:8080' },
      server2: { url: 'http://localhost:8081' },
    });
  });

  it('should read excludeMCPServers from settings', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      ...baseSettings,
      excludeMCPServers: ['server1', 'server2'],
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
    expect(config.getMcpServers()).toEqual({
      server3: { url: 'http://localhost:8082' },
    });
  });

  it('should override allowMCPServers with excludeMCPServers if overlapping', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      ...baseSettings,
      excludeMCPServers: ['server1'],
      allowMCPServers: ['server1', 'server2'],
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
    expect(config.getMcpServers()).toEqual({
      server2: { url: 'http://localhost:8081' },
    });
  });

  it('should prioritize mcp server flag if set', async () => {
    process.argv = [
      'node',
      'script.js',
      '--allowed-mcp-server-names',
      'server1',
    ];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      ...baseSettings,
      excludeMCPServers: ['server1'],
      allowMCPServers: ['server2'],
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
    expect(config.getMcpServers()).toEqual({
      server1: { url: 'http://localhost:8080' },
    });
  });

  it('should prioritize CLI flag over both allowed and excluded settings', async () => {
    process.argv = [
      'node',
      'script.js',
      '--allowed-mcp-server-names',
      'server2',
      '--allowed-mcp-server-names',
      'server3',
    ];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      ...baseSettings,
      allowMCPServers: ['server1', 'server2'], // Should be ignored
      excludeMCPServers: ['server3'], // Should be ignored
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
    expect(config.getMcpServers()).toEqual({
      server2: { url: 'http://localhost:8081' },
      server3: { url: 'http://localhost:8082' },
    });
  });
});

describe('loadCliConfig extensions', () => {
  beforeEach(() => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  const mockExtensions: GeminiCLIExtension[] = [
    {
      path: '/path/to/ext1',
      name: 'ext1',
      version: '1.0.0',
      contextFiles: ['/path/to/ext1.md'],
      isActive: true,
    },
    {
      path: '/path/to/ext2',
      name: 'ext2',
      version: '1.0.0',
      contextFiles: ['/path/to/ext2.md'],
      isActive: true,
    },
  ];

  it('should not filter extensions if --extensions flag is not used', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {};
    const config = await loadCliConfig(
      settings,
      mockExtensions,
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.getExtensionContextFilePaths()).toEqual([
      '/path/to/ext1.md',
      '/path/to/ext2.md',
    ]);
  });

  it('should filter extensions if --extensions flag is used', async () => {
    process.argv = ['node', 'script.js', '--extensions', 'ext1'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {};
    const config = await loadCliConfig(
      settings,
      mockExtensions,
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.getExtensionContextFilePaths()).toEqual(['/path/to/ext1.md']);
  });
});

describe('loadCliConfig model selection', () => {
  beforeEach(() => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  it('selects a model from settings.json if provided', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      {
        model: 'gemini-2.5-pro',
      },
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );

    expect(config.getModel()).toBe('gemini-2.5-pro');
  });

  // Skip: llxprt-code always configures a default model via LLXPRT_DEFAULT_MODEL env var
  // This test is for gemini-cli which falls back to DEFAULT_GEMINI_MODEL
  it.skip('uses the default gemini model if nothing is set', async () => {
    // Save and clear environment variables that might override the defaults
    const savedModel = process.env.LLXPRT_DEFAULT_MODEL;
    const savedProvider = process.env.LLXPRT_DEFAULT_PROVIDER;
    delete process.env.LLXPRT_DEFAULT_MODEL;
    delete process.env.LLXPRT_DEFAULT_PROVIDER;

    try {
      process.argv = ['node', 'script.js']; // No model set.
      const argv = await parseArguments({} as Settings);
      const config = await loadCliConfig(
        {
          // No model set.
        },
        [],
        new ExtensionEnablementManager(
          ExtensionStorage.getUserExtensionsDir(),
          argv.extensions,
        ),
        'test-session',
        argv,
      );

      expect(config.getModel()).toBe(DEFAULT_GEMINI_MODEL);
    } finally {
      // Restore environment variables
      if (savedModel !== undefined) {
        process.env.LLXPRT_DEFAULT_MODEL = savedModel;
      }
      if (savedProvider !== undefined) {
        process.env.LLXPRT_DEFAULT_PROVIDER = savedProvider;
      }
    }
  });

  it('always prefers model from argv', async () => {
    process.argv = ['node', 'script.js', '--model', 'gemini-2.5-flash-preview'];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      {
        model: 'gemini-2.5-pro',
      },
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );

    expect(config.getModel()).toBe('gemini-2.5-flash-preview');
  });

  it('selects the model from argv if provided', async () => {
    process.argv = ['node', 'script.js', '--model', 'gemini-2.5-flash-preview'];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      {
        // No model provided via settings.
      },
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );

    expect(config.getModel()).toBe('gemini-2.5-flash-preview');
  });
});

describe('loadCliConfig folderTrust', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home/user');
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('should be false when folderTrust is false', async () => {
    process.argv = ['node', 'script.js'];
    const settings: Settings = {
      folderTrust: false,
    };
    const argv = await parseArguments({} as Settings);
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
    expect(config.getFolderTrust()).toBe(false);
  });

  it('should be true when folderTrust is true', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      folderTrust: true,
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
    expect(config.getFolderTrust()).toBe(true);
  });

  it('should be false by default', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {};
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
    expect(config.getFolderTrust()).toBe(false);
  });
});

describe('loadCliConfig with includeDirectories', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetAllMocks();
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
    const expected = [
      mockCwd,
      path.resolve(path.sep, 'cli', 'path1'),
      path.join(mockCwd, 'cli', 'path2'),
      path.resolve(path.sep, 'settings', 'path1'),
      path.join(os.homedir(), 'settings', 'path2'),
      path.join(mockCwd, 'settings', 'path3'),
    ];
    expect(config.getWorkspaceContext().getDirectories()).toEqual(
      expect.arrayContaining(expected),
    );
    expect(config.getWorkspaceContext().getDirectories()).toHaveLength(
      expected.length,
    );
  });
});

describe('loadCliConfig chatCompression', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home/user');
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('should pass chatCompression settings to the core config', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      chatCompression: {
        contextPercentageThreshold: 0.5,
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
    expect(config.getChatCompression()).toEqual({
      contextPercentageThreshold: 0.5,
    });
  });

  it('should have undefined chatCompression if not in settings', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {};
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
    expect(config.getChatCompression()).toBeUndefined();
  });
});

describe('loadCliConfig useRipgrep', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home/user');
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    // Default: ripgrep is available
    vi.mocked(isRipgrepAvailable).mockResolvedValue(true);
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('should auto-enable ripgrep when available and not set in settings', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {};
    vi.mocked(isRipgrepAvailable).mockResolvedValue(true);
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
    expect(config.getUseRipgrep()).toBe(true);
  });

  it('should be false when ripgrep not available and not set in settings', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {};
    vi.mocked(isRipgrepAvailable).mockResolvedValue(false);
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
    expect(config.getUseRipgrep()).toBe(false);
  });

  it('should be false when useRipgrep is set to false in settings, even if ripgrep available', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = { useRipgrep: false };
    vi.mocked(isRipgrepAvailable).mockResolvedValue(true);
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
    expect(config.getUseRipgrep()).toBe(false);
  });

  it('should be true when useRipgrep is explicitly set to true in settings', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = { useRipgrep: true };
    vi.mocked(isRipgrepAvailable).mockResolvedValue(false);
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
    expect(config.getUseRipgrep()).toBe(true);
  });
});

describe('screenReader configuration', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home/user');
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('should use screenReader value from settings if CLI flag is not present (settings true)', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      accessibility: { screenReader: true },
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
    expect(config.getScreenReader()).toBe(true);
  });

  it('should use screenReader value from settings if CLI flag is not present (settings false)', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      accessibility: { screenReader: false },
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
    expect(config.getScreenReader()).toBe(false);
  });

  it('should prioritize --screen-reader CLI flag (true) over settings (false)', async () => {
    process.argv = ['node', 'script.js', '--screen-reader'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      accessibility: { screenReader: false },
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
    expect(config.getScreenReader()).toBe(true);
  });

  it('should be false by default when no flag or setting is present', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {};
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
    expect(config.getScreenReader()).toBe(false);
  });
});

describe('loadCliConfig tool exclusions', () => {
  const originalArgv = process.argv;
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home/user');
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    process.stdin.isTTY = true;
    vi.mocked(isWorkspaceTrusted).mockReturnValue({
      isTrusted: true,
      source: undefined,
    });
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.stdin.isTTY = originalIsTTY;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('should not exclude interactive tools in interactive mode without YOLO', async () => {
    process.stdin.isTTY = true;
    process.argv = ['node', 'script.js'];
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
    expect(config.getExcludeTools()).not.toContain('run_shell_command');
    expect(config.getExcludeTools()).not.toContain('replace');
    expect(config.getExcludeTools()).not.toContain('write_file');
  });

  it('should not exclude interactive tools in interactive mode with YOLO', async () => {
    process.stdin.isTTY = true;
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
    expect(config.getExcludeTools()).not.toContain('run_shell_command');
    expect(config.getExcludeTools()).not.toContain('replace');
    expect(config.getExcludeTools()).not.toContain('write_file');
  });

  it('should exclude interactive tools in non-interactive mode without YOLO', async () => {
    process.stdin.isTTY = false;
    process.argv = ['node', 'script.js', '-p', 'test'];
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
    expect(config.getExcludeTools()).toContain('run_shell_command');
    expect(config.getExcludeTools()).toContain('replace');
    expect(config.getExcludeTools()).toContain('write_file');
  });

  it('should not exclude interactive tools in non-interactive mode with YOLO', async () => {
    process.stdin.isTTY = false;
    process.argv = ['node', 'script.js', '-p', 'test', '--yolo'];
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
    expect(config.getExcludeTools()).not.toContain('run_shell_command');
    expect(config.getExcludeTools()).not.toContain('replace');
    expect(config.getExcludeTools()).not.toContain('write_file');
  });

  it('should not exclude shell tool in non-interactive mode when --allowed-tools="ShellTool" is set', async () => {
    process.stdin.isTTY = false;
    process.argv = [
      'node',
      'script.js',
      '-p',
      'test',
      '--allowed-tools',
      'ShellTool',
    ];
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
    expect(config.getExcludeTools()).not.toContain(ShellTool.Name);
  });

  it('should not exclude shell tool in non-interactive mode when --allowed-tools="run_shell_command" is set', async () => {
    process.stdin.isTTY = false;
    process.argv = [
      'node',
      'script.js',
      '-p',
      'test',
      '--allowed-tools',
      'run_shell_command',
    ];
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
    expect(config.getExcludeTools()).not.toContain(ShellTool.Name);
  });

  it('should not exclude shell tool in non-interactive mode when --allowed-tools="ShellTool(wc)" is set', async () => {
    process.stdin.isTTY = false;
    process.argv = [
      'node',
      'script.js',
      '-p',
      'test',
      '--allowed-tools',
      'ShellTool(wc)',
    ];
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
    expect(config.getExcludeTools()).not.toContain(ShellTool.Name);
  });
});

describe('loadCliConfig interactive', () => {
  const originalArgv = process.argv;
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home/user');
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    process.stdin.isTTY = true;
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.stdin.isTTY = originalIsTTY;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('should be interactive if isTTY and no prompt', async () => {
    process.stdin.isTTY = true;
    process.argv = ['node', 'script.js'];
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
    expect(config.isInteractive()).toBe(true);
  });

  it('should be interactive if prompt-interactive is set', async () => {
    process.stdin.isTTY = false;
    process.argv = ['node', 'script.js', '--prompt-interactive', 'test'];
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
    expect(config.isInteractive()).toBe(true);
  });

  it('should not be interactive if not isTTY and no prompt', async () => {
    process.stdin.isTTY = false;
    process.argv = ['node', 'script.js'];
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
    expect(config.isInteractive()).toBe(false);
  });

  it('should not be interactive if prompt is set', async () => {
    process.stdin.isTTY = true;
    process.argv = ['node', 'script.js', '--prompt', 'test'];
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
    expect(config.isInteractive()).toBe(false);
  });

  it('should not be interactive if positional prompt words are provided with other flags', async () => {
    process.stdin.isTTY = true;
    process.argv = ['node', 'script.js', '--model', 'gemini-2.5-pro', 'Hello'];
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
    expect(config.isInteractive()).toBe(false);
  });

  it('should not be interactive if positional prompt words are provided with multiple flags', async () => {
    process.stdin.isTTY = true;
    process.argv = [
      'node',
      'script.js',
      '--model',
      'gemini-2.5-pro',
      '--yolo',
      'Hello world',
    ];
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
    expect(config.isInteractive()).toBe(false);
  });

  it('should not be interactive if positional prompt words are provided with extensions flag', async () => {
    process.stdin.isTTY = true;
    process.argv = ['node', 'script.js', '-e', 'none', 'hello'];
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
    expect(config.isInteractive()).toBe(false);
    expect(argv.query).toBe('hello');
    expect(argv.extensions).toEqual(['none']);
  });

  it('should handle multiple positional words correctly', async () => {
    process.stdin.isTTY = true;
    process.argv = ['node', 'script.js', 'hello world how are you'];
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
    expect(config.isInteractive()).toBe(false);
    expect(argv.query).toBe('hello world how are you');
    expect(argv.prompt).toBe('hello world how are you');
  });

  it('should handle multiple positional words with flags', async () => {
    process.stdin.isTTY = true;
    process.argv = [
      'node',
      'script.js',
      '--model',
      'gemini-2.5-pro',
      'write',
      'a',
      'function',
      'to',
      'sort',
      'array',
    ];
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
    expect(config.isInteractive()).toBe(false);
    expect(argv.query).toBe('write a function to sort array');
    expect(argv.model).toBe('gemini-2.5-pro');
  });

  it('should handle empty positional arguments', async () => {
    process.stdin.isTTY = true;
    process.argv = ['node', 'script.js', ''];
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
    expect(config.isInteractive()).toBe(true);
    expect(argv.query).toBeUndefined();
  });

  it('should handle extensions flag with positional arguments correctly', async () => {
    process.stdin.isTTY = true;
    process.argv = [
      'node',
      'script.js',
      '-e',
      'none',
      'hello',
      'world',
      'how',
      'are',
      'you',
    ];
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
    expect(config.isInteractive()).toBe(false);
    expect(argv.query).toBe('hello world how are you');
    expect(argv.extensions).toEqual(['none']);
  });

  it('should be interactive if no positional prompt words are provided with flags', async () => {
    process.stdin.isTTY = true;
    process.argv = ['node', 'script.js', '--model', 'gemini-2.5-pro'];
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
    expect(config.isInteractive()).toBe(true);
  });
});

describe('loadCliConfig approval mode', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home/user');
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    process.argv = ['node', 'script.js']; // Reset argv for each test
    vi.mocked(isWorkspaceTrusted).mockReturnValue({
      isTrusted: true,
      source: undefined,
    });
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('should default to DEFAULT approval mode when no flags are set', async () => {
    process.argv = ['node', 'script.js'];
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

  it('should set YOLO approval mode when --yolo flag is used', async () => {
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
    expect(config.getApprovalMode()).toBe(ServerConfig.ApprovalMode.YOLO);
  });

  it('should set YOLO approval mode when -y flag is used', async () => {
    process.argv = ['node', 'script.js', '-y'];
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
    expect(config.getApprovalMode()).toBe(ServerConfig.ApprovalMode.YOLO);
  });

  it('should set DEFAULT approval mode when --approval-mode=default', async () => {
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

  it('should set AUTO_EDIT approval mode when --approval-mode=auto_edit', async () => {
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
    expect(config.getApprovalMode()).toBe(ServerConfig.ApprovalMode.AUTO_EDIT);
  });

  it('should set YOLO approval mode when --approval-mode=yolo', async () => {
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
    expect(config.getApprovalMode()).toBe(ServerConfig.ApprovalMode.YOLO);
  });

  it('should prioritize --approval-mode over --yolo when both would be valid (but validation prevents this)', async () => {
    // Note: This test documents the intended behavior, but in practice the validation
    // prevents both flags from being used together
    process.argv = ['node', 'script.js', '--approval-mode', 'default'];
    const argv = await parseArguments({} as Settings);
    // Manually set yolo to true to simulate what would happen if validation didn't prevent it
    argv.yolo = true;
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

  it('should fall back to --yolo behavior when --approval-mode is not set', async () => {
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
    expect(config.getApprovalMode()).toBe(ServerConfig.ApprovalMode.YOLO);
  });

  // --- Untrusted Folder Scenarios ---
  describe('when folder is NOT trusted', () => {
    beforeEach(() => {
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
});

describe('loadCliConfig fileFiltering', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home/user');
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    process.argv = ['node', 'script.js']; // Reset argv for each test
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  const testCases: Array<{
    property: keyof NonNullable<Settings['fileFiltering']>;
    getter: (config: ServerConfig.Config) => boolean;
    value: boolean;
  }> = [
    {
      property: 'disableFuzzySearch',
      getter: (c) => c.getFileFilteringDisableFuzzySearch(),
      value: true,
    },
    {
      property: 'disableFuzzySearch',
      getter: (c) => c.getFileFilteringDisableFuzzySearch(),
      value: false,
    },
    {
      property: 'respectGitIgnore',
      getter: (c) => c.getFileFilteringRespectGitIgnore(),
      value: true,
    },
    {
      property: 'respectGitIgnore',
      getter: (c) => c.getFileFilteringRespectGitIgnore(),
      value: false,
    },
    {
      property: 'respectLlxprtIgnore',
      getter: (c) => c.getFileFilteringRespectLlxprtIgnore(),
      value: true,
    },
    {
      property: 'respectLlxprtIgnore',
      getter: (c) => c.getFileFilteringRespectLlxprtIgnore(),
      value: false,
    },
    {
      property: 'enableRecursiveFileSearch',
      getter: (c) => c.getEnableRecursiveFileSearch(),
      value: true,
    },
    {
      property: 'enableRecursiveFileSearch',
      getter: (c) => c.getEnableRecursiveFileSearch(),
      value: false,
    },
  ];

  it.each(testCases)(
    'should pass $property from settings to config when $value',
    async ({ property, getter, value }) => {
      const settings: Settings = {
        fileFiltering: { [property]: value },
      };
      const argv = await parseArguments(settings);
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
      expect(getter(config)).toBe(value);
    },
  );
});

describe('parseArguments with positional prompt', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('should throw an error when both a positional prompt and the --prompt flag are used', async () => {
    process.argv = [
      'node',
      'script.js',
      'positional',
      'prompt',
      '--prompt',
      'test prompt',
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
        'Cannot use both a positional prompt and the --prompt (-p) flag together',
      ),
    );

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  it('should correctly parse a positional prompt', async () => {
    process.argv = ['node', 'script.js', 'positional', 'prompt'];
    const argv = await parseArguments({} as Settings);
    expect(argv.promptWords).toEqual(['positional', 'prompt']);
  });

  it('should correctly parse positional query argument', async () => {
    process.argv = ['node', 'script.js', 'test', 'query'];
    const argv = await parseArguments({} as Settings);
    expect(argv.query).toBe('test query');
  });

  it('should correctly parse a prompt from the --prompt flag', async () => {
    process.argv = ['node', 'script.js', '--prompt', 'test prompt'];
    const argv = await parseArguments({} as Settings);
    expect(argv.prompt).toBe('test prompt');
  });
});

// TODO: These tests need provider runtime setup (activateIsolatedRuntimeContext)
describe.skip('Telemetry configuration via environment variables', () => {
  it('should prioritize GEMINI_TELEMETRY_ENABLED over settings', async () => {
    vi.stubEnv('GEMINI_TELEMETRY_ENABLED', 'true');
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = { telemetry: { enabled: false } };
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
    expect(config.getTelemetryEnabled()).toBe(true);
  });

  it('should prioritize GEMINI_TELEMETRY_TARGET over settings', async () => {
    vi.stubEnv('GEMINI_TELEMETRY_TARGET', 'gcp');
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      telemetry: { target: ServerConfig.TelemetryTarget.LOCAL },
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
    expect(config.getTelemetryTarget()).toBe('gcp');
  });

  it('should throw when GEMINI_TELEMETRY_TARGET is invalid', async () => {
    vi.stubEnv('GEMINI_TELEMETRY_TARGET', 'bogus');
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      telemetry: { target: ServerConfig.TelemetryTarget.GCP },
    };
    await expect(
      loadCliConfig(
        settings,
        [],
        new ExtensionEnablementManager(
          ExtensionStorage.getUserExtensionsDir(),
          argv.extensions,
        ),
        'test-session',
        argv,
      ),
    ).rejects.toThrow(
      /Invalid telemetry configuration: .*Invalid telemetry target/i,
    );
    vi.unstubAllEnvs();
  });

  it('should prioritize GEMINI_TELEMETRY_OTLP_ENDPOINT over settings and default env var', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://default.env.com');
    vi.stubEnv('GEMINI_TELEMETRY_OTLP_ENDPOINT', 'http://gemini.env.com');
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      telemetry: { otlpEndpoint: 'http://settings.com' },
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
    expect(config.getTelemetryOtlpEndpoint()).toBe('http://gemini.env.com');
  });

  it('should prioritize GEMINI_TELEMETRY_OTLP_PROTOCOL over settings', async () => {
    vi.stubEnv('GEMINI_TELEMETRY_OTLP_PROTOCOL', 'http');
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = { telemetry: { otlpProtocol: 'grpc' } };
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
    expect(config.getTelemetryOtlpProtocol()).toBe('http');
  });

  it('should prioritize GEMINI_TELEMETRY_LOG_PROMPTS over settings', async () => {
    vi.stubEnv('GEMINI_TELEMETRY_LOG_PROMPTS', 'false');
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = { telemetry: { logPrompts: true } };
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
    expect(config.getTelemetryLogPromptsEnabled()).toBe(false);
  });

  it('should prioritize GEMINI_TELEMETRY_OUTFILE over settings', async () => {
    vi.stubEnv('GEMINI_TELEMETRY_OUTFILE', '/gemini/env/telemetry.log');
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      telemetry: { outfile: '/settings/telemetry.log' },
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
    expect(config.getTelemetryOutfile()).toBe('/gemini/env/telemetry.log');
  });

  it('should prioritize GEMINI_TELEMETRY_USE_COLLECTOR over settings', async () => {
    vi.stubEnv('GEMINI_TELEMETRY_USE_COLLECTOR', 'true');
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = { telemetry: { useCollector: false } };
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
    expect(config.getTelemetryUseCollector()).toBe(true);
  });

  it('should use settings value when GEMINI_TELEMETRY_ENABLED is not set', async () => {
    vi.stubEnv('GEMINI_TELEMETRY_ENABLED', undefined);
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = { telemetry: { enabled: true } };
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
    expect(config.getTelemetryEnabled()).toBe(true);
  });

  it('should use settings value when GEMINI_TELEMETRY_TARGET is not set', async () => {
    vi.stubEnv('GEMINI_TELEMETRY_TARGET', undefined);
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      telemetry: { target: ServerConfig.TelemetryTarget.LOCAL },
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
    expect(config.getTelemetryTarget()).toBe('local');
  });

  it("should treat GEMINI_TELEMETRY_ENABLED='1' as true", async () => {
    vi.stubEnv('GEMINI_TELEMETRY_ENABLED', '1');
    process.argv = ['node', 'script.js'];
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
    expect(config.getTelemetryEnabled()).toBe(true);
  });

  it("should treat GEMINI_TELEMETRY_ENABLED='0' as false", async () => {
    vi.stubEnv('GEMINI_TELEMETRY_ENABLED', '0');
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      { telemetry: { enabled: true } },
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.getTelemetryEnabled()).toBe(false);
  });

  it("should treat GEMINI_TELEMETRY_LOG_PROMPTS='1' as true", async () => {
    vi.stubEnv('GEMINI_TELEMETRY_LOG_PROMPTS', '1');
    process.argv = ['node', 'script.js'];
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
    expect(config.getTelemetryLogPromptsEnabled()).toBe(true);
  });

  it("should treat GEMINI_TELEMETRY_LOG_PROMPTS='false' as false", async () => {
    vi.stubEnv('GEMINI_TELEMETRY_LOG_PROMPTS', 'false');
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      { telemetry: { logPrompts: true } },
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.getTelemetryLogPromptsEnabled()).toBe(false);
  });
});

describe('defaultDisabledTools', () => {
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    process.stdin.isTTY = true;
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  afterEach(() => {
    process.stdin.isTTY = originalIsTTY;
    clearActiveProviderRuntimeContext();
  });

  it('should seed tools.disabled with defaultDisabledTools', async () => {
    const settings: Settings = {
      defaultDisabledTools: ['google_web_fetch'],
    };
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
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
    const disabled = config.getEphemeralSetting('tools.disabled');
    expect(disabled).toEqual(expect.arrayContaining(['google_web_fetch']));
  });

  it('should merge defaultDisabledTools with existing tools.disabled', async () => {
    const settings: Settings = {
      defaultDisabledTools: ['google_web_fetch'],
    };
    process.argv = [
      'node',
      'script.js',
      '--set',
      'tools.disabled=["read_file"]',
    ];
    const argv = await parseArguments({} as Settings);
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
    const currentDisabled =
      (config.getEphemeralSetting('tools.disabled') as string[]) || [];
    expect(currentDisabled).toEqual(
      expect.arrayContaining(['read_file', 'google_web_fetch']),
    );
  });

  it('should not duplicate tools already in tools.disabled', async () => {
    const settings: Settings = {
      defaultDisabledTools: ['google_web_fetch'],
    };
    process.argv = [
      'node',
      'script.js',
      '--set',
      'tools.disabled=["google_web_fetch"]',
    ];
    const argv = await parseArguments({} as Settings);
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
    const disabled = config.getEphemeralSetting('tools.disabled') as string[];
    const googleWebFetchCount = disabled.filter(
      (t) => t === 'google_web_fetch',
    ).length;
    expect(googleWebFetchCount).toBe(1);
  });

  it('should not seed tools.disabled when defaultDisabledTools is empty', async () => {
    const settings: Settings = {
      defaultDisabledTools: [],
    };
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
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
    const disabled = config.getEphemeralSetting('tools.disabled');
    // Should be either undefined, null, or empty array
    expect(
      !disabled || (Array.isArray(disabled) && disabled.length === 0),
    ).toBe(true);
  });

  it('should not seed tools.disabled when defaultDisabledTools is undefined', async () => {
    const settings: Settings = {
      defaultDisabledTools: undefined,
    };
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
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
    const disabled = config.getEphemeralSetting('tools.disabled');
    // Should be either undefined, null, or empty array
    expect(
      !disabled || (Array.isArray(disabled) && disabled.length === 0),
    ).toBe(true);
  });

  it('should not affect excludeTools (tool remains discoverable)', async () => {
    const settings: Settings = {
      defaultDisabledTools: ['google_web_fetch'],
    };
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
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
    // google_web_fetch should NOT be in excludeTools
    expect(config.getExcludeTools()).not.toContain('google_web_fetch');
    // But it SHOULD be in tools.disabled
    const disabled = config.getEphemeralSetting('tools.disabled') as string[];
    expect(disabled).toContain('google_web_fetch');
  });

  it('should not re-disable a tool that the user has explicitly allowed', async () => {
    const settings: Settings = {
      defaultDisabledTools: ['google_web_fetch'],
    };
    process.argv = [
      'node',
      'script.js',
      '--set',
      'tools.allowed=["google_web_fetch"]',
    ];
    const argv = await parseArguments({} as Settings);
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
    const disabled = config.getEphemeralSetting('tools.disabled') as
      | string[]
      | undefined;
    // google_web_fetch is in tools.allowed, so it must NOT be added to tools.disabled
    expect(disabled ?? []).not.toContain('google_web_fetch');
  });
});
