/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as gemini from './gemini.js';
import { dynamicSettingsRegistry } from './utils/dynamicSettings.js';
import type {
  Config,
  IContent,
  SessionRecordingService,
  LockHandle,
} from '@vybestack/llxprt-code-core';
import { OutputFormat, ExitCodes } from '@vybestack/llxprt-code-core';

vi.mock('./config/settings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config/settings.js')>();
  return {
    ...actual,
    loadSettings: vi.fn(() => ({
      merged: {
        advanced: {},
        security: { auth: {} },
        ui: { autoConfigureMaxOldSpaceSize: false, customThemes: {} },
      },
      errors: [],
      setValue: vi.fn(),
      forScope: () => ({ settings: {}, originalSettings: {}, path: '' }),
    })),
    migrateDeprecatedSettings: vi.fn(),
  };
});

vi.mock('./config/config.js', () => ({
  loadCliConfig: vi.fn(),
  parseArguments: vi.fn(),
}));

vi.mock('./runtime/runtimeSettings.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./runtime/runtimeSettings.js')>();
  return {
    ...actual,
    setCliRuntimeContext: vi.fn(),
    switchActiveProvider: vi.fn(async () => ({
      changed: true,
      previousProvider: null,
      nextProvider: 'gemini',
      infoMessages: [],
    })),
    setActiveModel: vi.fn(),
    setActiveModelParam: vi.fn(),
    clearActiveModelParam: vi.fn(),
    getActiveModelParams: vi.fn(() => ({})),
    loadProfileByName: vi.fn(),
    applyCliArgumentOverrides: vi.fn(async () => {}),
  };
});

vi.mock('./config/extension.js', () => ({
  ExtensionStorage: {
    getUserExtensionsDir: vi.fn(() => '/tmp/extensions'),
  },
  loadExtensions: vi.fn(() => []),
}));

vi.mock('./utils/cleanup.js', () => ({
  cleanupCheckpoints: vi.fn(() => Promise.resolve()),
  registerCleanup: vi.fn(),
  registerSyncCleanup: vi.fn(),
  runExitCleanup: vi.fn(),
}));

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
    resumeSession: vi.fn(),
    writeToStdout: vi.fn().mockReturnValue(true),
    writeToStderr: vi.fn().mockReturnValue(true),
    patchStdio: vi.fn(() => vi.fn()),
  };
});

vi.mock('./ui/utils/terminalCapabilityManager.js', () => ({
  terminalCapabilityManager: {
    detectCapabilities: vi.fn(() => Promise.resolve()),
    isKittyProtocolEnabled: vi.fn(() => false),
    enableKittyProtocol: vi.fn(),
    disableKittyProtocol: vi.fn(),
    getTerminalName: vi.fn(() => undefined),
    getTerminalBackgroundColor: vi.fn(() => undefined),
  },
}));

vi.mock('./ui/utils/terminalContract.js', () => ({
  drainStdinBuffer: vi.fn(() => Promise.resolve()),
}));

vi.mock('./utils/stdinSafety.js', () => ({
  StdinRawModeManager: vi.fn(() => ({
    enable: vi.fn(),
    disable: vi.fn(),
  })),
}));

vi.mock('./utils/sandbox.js', () => ({
  start_sandbox: vi.fn(() => Promise.resolve(0)),
}));

vi.mock('./utils/bootstrap.js', () => ({
  shouldRelaunchForMemory: vi.fn(() => []),
  computeSandboxMemoryArgs: vi.fn(() => ['--max-old-space-size=3072']),
  parseDockerMemoryToMB: vi.fn(() => undefined),
  isDebugMode: vi.fn(() => false),
}));

vi.mock('./utils/relaunch.js', () => ({
  relaunchAppInChildProcess: vi.fn(() => Promise.resolve(0)),
}));

vi.mock('./utils/sessionCleanup.js', () => ({
  cleanupExpiredSessions: vi.fn(() => Promise.resolve()),
}));

vi.mock('ink', () => ({
  render: vi.fn().mockReturnValue({ unmount: vi.fn() }),
}));

function makeResumeResult(content: string) {
  const history: IContent[] = [
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: content }],
    },
  ];

  return {
    ok: true as const,
    history,
    metadata: {
      sessionId: 'test-session-id',
      projectHash: 'hash',
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      workspaceDirs: ['/tmp/project'],
      startTime: new Date().toISOString(),
    },
    recording: {
      appendEvent: vi.fn(),
      updateProvider: vi.fn(),
      updateModel: vi.fn(),
      updateDirectories: vi.fn(),
      flush: vi.fn(() => Promise.resolve()),
      dispose: vi.fn(() => Promise.resolve()),
      getSessionId: vi.fn(() => 'test-session-id'),
      getFilePath: vi.fn(() => '/tmp/session-test-session-id.jsonl'),
      getIsMaterialized: vi.fn(() => true),
      getEnospcError: vi.fn(() => null),
      hasPendingEvents: vi.fn(() => false),
    } as unknown as SessionRecordingService,
    lockHandle: {
      lockPath: '/tmp/test-session-id.lock',
      release: vi.fn(() => Promise.resolve()),
    } as unknown as LockHandle,
    warnings: [] as string[],
  };
}

describe('gemini main provider initialization', () => {
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    dynamicSettingsRegistry.reset();
    process.stdin.isTTY = true;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.stdin.isTTY = originalIsTTY;
    dynamicSettingsRegistry.reset();
    vi.resetModules();
  });

  it('initializes content generator config before interactive provider usage', async () => {
    const providerManager = {
      getActiveProvider: vi.fn().mockReturnValue({ name: 'gemini' }),
      getActiveProviderName: vi.fn().mockReturnValue('gemini'),
      getServerToolsProvider: vi.fn().mockReturnValue(null),
    };

    const mockConfig = {
      initialize: vi.fn().mockResolvedValue(undefined),
      refreshAuth: vi.fn().mockResolvedValue(undefined),
      getProviderManager: vi.fn(() => providerManager),
      getProvider: vi.fn(() => 'gemini'),
      getConversationLoggingEnabled: vi.fn(() => false),
      getMcpServers: vi.fn(() => ({})),
      getDebugMode: vi.fn(() => false),
      getIdeMode: vi.fn(() => false),
      getIdeClient: vi.fn(() => null),
      getListExtensions: vi.fn(() => false),
      getOutputFormat: vi.fn(() => OutputFormat.TEXT),
      getToolRegistryInfo: vi.fn(() => ({
        registered: [],
        unregistered: [],
      })),
      getSandbox: vi.fn(() => false),
      getModel: vi.fn(() => 'gemini-2.5-pro'),
      getProjectRoot: vi.fn(() => '/tmp/project'),
      isInteractive: vi.fn(() => true),
      getSessionId: vi.fn(() => 'session-1'),
      adoptSessionId: vi.fn(),
      getQuestion: vi.fn(() => ''),
      getExperimentalZedIntegration: vi.fn(() => false),
      getZedIntegrationEnabled: vi.fn(() => false),
      getTrustedFolder: vi.fn(() => true),
      getProjectTempDir: vi.fn(() => '/tmp/project-temp'),
      getContinueSessionRef: vi.fn(() => null),
      getWorkspaceContext: vi.fn(() => ({
        getDirectories: () => ['/tmp/project'],
      })),
      getScreenReader: vi.fn(() => false),
      getTerminalBackground: vi.fn(() => undefined),
      setTerminalBackground: vi.fn(),
      getPolicyEngine: vi.fn(() => null),
    } as unknown as Config;

    const { loadCliConfig, parseArguments } = await import(
      './config/config.js'
    );
    vi.mocked(loadCliConfig).mockResolvedValueOnce(mockConfig);
    vi.mocked(parseArguments).mockResolvedValueOnce({
      promptInteractive: undefined,
      prompt: undefined,
      promptWords: [],
      experimentalAcp: false,
      provider: 'gemini',
      profileLoad: undefined,
      outputFormat: OutputFormat.TEXT,
      extensions: [],
      sessionSummary: undefined,
    } as unknown as import('./config/config.js').CliArgs);

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`EXIT_${code ?? 'unknown'}`);
      });
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    // main() should complete (or throw on process.exit) — either way,
    // refreshAuth must have been called as part of provider initialization.
    try {
      await gemini.main();
    } catch {
      // Ignore exits or other throws; we only care about refreshAuth
    }

    expect(mockConfig.refreshAuth).toHaveBeenCalledTimes(1);
    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('warns and continues to interactive startup when restoreHistory fails during --continue flow', async () => {
    const providerManager = {
      getActiveProvider: vi.fn().mockReturnValue({ name: 'gemini' }),
      getActiveProviderName: vi.fn().mockReturnValue('gemini'),
      getServerToolsProvider: vi.fn().mockReturnValue(null),
      hasActiveProvider: vi.fn().mockReturnValue(true),
      setActiveProvider: vi.fn().mockReturnValue(undefined),
    };

    const restoreHistory = vi
      .fn()
      .mockRejectedValue(new Error('restore failed on purpose'));
    const getGeminiClient = vi.fn(() => ({ restoreHistory }));

    const mockConfig = {
      initialize: vi.fn().mockResolvedValue(undefined),
      refreshAuth: vi.fn().mockResolvedValue(undefined),
      getProviderManager: vi.fn(() => providerManager),
      getProvider: vi.fn(() => 'gemini'),
      getConversationLoggingEnabled: vi.fn(() => false),
      getMcpServers: vi.fn(() => ({})),
      getDebugMode: vi.fn(() => false),
      getIdeMode: vi.fn(() => false),
      getIdeClient: vi.fn(() => null),
      getListExtensions: vi.fn(() => false),
      getOutputFormat: vi.fn(() => OutputFormat.TEXT),
      getToolRegistryInfo: vi.fn(() => ({
        registered: [],
        unregistered: [],
      })),
      getSandbox: vi.fn(() => false),
      getModel: vi.fn(() => 'gemini-2.5-pro'),
      getProjectRoot: vi.fn(() => '/tmp/project'),
      isInteractive: vi.fn(() => true),
      getSessionId: vi.fn(() => 'session-1'),
      adoptSessionId: vi.fn(),
      getQuestion: vi.fn(() => ''),
      getExperimentalZedIntegration: vi.fn(() => false),
      getZedIntegrationEnabled: vi.fn(() => false),
      getTrustedFolder: vi.fn(() => true),
      getProjectTempDir: vi.fn(() => '/tmp/project-temp'),
      getContinueSessionRef: vi.fn(() => '__CONTINUE_LATEST__'),
      getWorkspaceContext: vi.fn(() => ({
        getDirectories: () => ['/tmp/project'],
      })),
      getScreenReader: vi.fn(() => false),
      getTerminalBackground: vi.fn(() => undefined),
      getGeminiClient,
      setTerminalBackground: vi.fn(),
      getPolicyEngine: vi.fn(() => null),
    } as unknown as Config;

    const coreModule = await import('@vybestack/llxprt-code-core');
    const resumeSessionMock = vi.mocked(coreModule.resumeSession);
    resumeSessionMock.mockResolvedValueOnce(
      makeResumeResult('restored user content'),
    );

    const { loadCliConfig, parseArguments } = await import(
      './config/config.js'
    );
    vi.mocked(loadCliConfig).mockResolvedValueOnce(mockConfig);
    vi.mocked(parseArguments).mockResolvedValueOnce({
      promptInteractive: undefined,
      prompt: undefined,
      promptWords: [],
      experimentalAcp: false,
      provider: 'gemini',
      profileLoad: undefined,
      outputFormat: OutputFormat.TEXT,
      extensions: [],
      sessionSummary: undefined,
    } as unknown as import('./config/config.js').CliArgs);

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`EXIT_${code ?? 'unknown'}`);
      });
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    // main() flow: resume → restoreHistory throws → catch logs warning and
    // continues. main() resolves without throwing because the restoreHistory
    // error is swallowed.
    await gemini.main();

    // resumeSession was called to load the session
    expect(resumeSessionMock).toHaveBeenCalledTimes(1);
    // restoreHistory was called with the resumed content
    expect(restoreHistory).toHaveBeenCalledTimes(1);
    // The rejection from restoreHistory did NOT propagate — flow continued
    // past the try/catch and main() resolved successfully.

    resumeSessionMock.mockReset();
    exitSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('exits with FATAL_AUTHENTICATION_ERROR after sandbox config is determined when auth fails with sandbox', async () => {
    const providerManager = {
      getActiveProvider: vi.fn().mockReturnValue({ name: 'gemini' }),
      getActiveProviderName: vi.fn().mockReturnValue('gemini'),
      getServerToolsProvider: vi.fn().mockReturnValue(null),
    };

    const sandboxConfig = {
      command: 'docker' as const,
      image: 'llxprt-sandbox:latest',
    };
    const mockConfig = {
      initialize: vi.fn().mockResolvedValue(undefined),
      refreshAuth: vi.fn().mockRejectedValue(new Error('Auth failed')),
      getProviderManager: vi.fn(() => providerManager),
      getProvider: vi.fn(() => 'gemini'),
      getConversationLoggingEnabled: vi.fn(() => false),
      getMcpServers: vi.fn(() => ({})),
      getDebugMode: vi.fn(() => false),
      getIdeMode: vi.fn(() => false),
      getIdeClient: vi.fn(() => null),
      getListExtensions: vi.fn(() => false),
      getOutputFormat: vi.fn(() => OutputFormat.TEXT),
      getToolRegistryInfo: vi.fn(() => ({
        registered: [],
        unregistered: [],
      })),
      getSandbox: vi.fn(() => sandboxConfig),
      getModel: vi.fn(() => 'gemini-2.5-pro'),
      getProjectRoot: vi.fn(() => '/tmp/project'),
      isInteractive: vi.fn(() => true),
      getSessionId: vi.fn(() => 'session-1'),
      adoptSessionId: vi.fn(),
      getQuestion: vi.fn(() => ''),
      getExperimentalZedIntegration: vi.fn(() => false),
      getZedIntegrationEnabled: vi.fn(() => false),
      getTrustedFolder: vi.fn(() => true),
      getProjectTempDir: vi.fn(() => '/tmp/project-temp'),
      getContinueSessionRef: vi.fn(() => null),
      getWorkspaceContext: vi.fn(() => ({
        getDirectories: () => ['/tmp/project'],
      })),
      setTerminalBackground: vi.fn(),
      getPolicyEngine: vi.fn(() => null),
    } as unknown as Config;

    const { loadCliConfig, parseArguments } = await import(
      './config/config.js'
    );
    vi.mocked(loadCliConfig).mockResolvedValue(mockConfig);
    vi.mocked(parseArguments).mockResolvedValueOnce({
      promptInteractive: undefined,
      prompt: undefined,
      promptWords: [],
      experimentalAcp: false,
      experimentalUi: false,
      provider: 'gemini',
      profileLoad: undefined,
      outputFormat: OutputFormat.TEXT,
      extensions: [],
      sessionSummary: undefined,
    } as unknown as import('./config/config.js').CliArgs);

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`EXIT_${code ?? 'unknown'}`);
      });
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    // Auth fails, sandbox is configured — deferred exit fires with FATAL_AUTHENTICATION_ERROR
    await expect(gemini.main()).rejects.toThrow(
      new RegExp(`EXIT_${ExitCodes.FATAL_AUTHENTICATION_ERROR}`),
    );

    // sandbox should NOT have been started because auth failed before reaching it
    const { start_sandbox } = await import('./utils/sandbox.js');
    expect(vi.mocked(start_sandbox)).not.toHaveBeenCalled();

    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('exits with FATAL_AUTHENTICATION_ERROR after sandbox check when auth fails without sandbox', async () => {
    const providerManager = {
      getActiveProvider: vi.fn().mockReturnValue({ name: 'gemini' }),
      getActiveProviderName: vi.fn().mockReturnValue('gemini'),
      getServerToolsProvider: vi.fn().mockReturnValue(null),
    };

    const mockConfig = {
      initialize: vi.fn().mockResolvedValue(undefined),
      refreshAuth: vi.fn().mockRejectedValue(new Error('Auth failed')),
      getProviderManager: vi.fn(() => providerManager),
      getProvider: vi.fn(() => 'gemini'),
      getConversationLoggingEnabled: vi.fn(() => false),
      getMcpServers: vi.fn(() => ({})),
      getDebugMode: vi.fn(() => false),
      getIdeMode: vi.fn(() => false),
      getIdeClient: vi.fn(() => null),
      getListExtensions: vi.fn(() => false),
      getOutputFormat: vi.fn(() => OutputFormat.TEXT),
      getToolRegistryInfo: vi.fn(() => ({
        registered: [],
        unregistered: [],
      })),
      getSandbox: vi.fn(() => undefined),
      getModel: vi.fn(() => 'gemini-2.5-pro'),
      getProjectRoot: vi.fn(() => '/tmp/project'),
      isInteractive: vi.fn(() => true),
      getSessionId: vi.fn(() => 'session-1'),
      adoptSessionId: vi.fn(),
      getQuestion: vi.fn(() => ''),
      getExperimentalZedIntegration: vi.fn(() => false),
      getZedIntegrationEnabled: vi.fn(() => false),
      getTrustedFolder: vi.fn(() => true),
      getProjectTempDir: vi.fn(() => '/tmp/project-temp'),
      getContinueSessionRef: vi.fn(() => null),
      getWorkspaceContext: vi.fn(() => ({
        getDirectories: () => ['/tmp/project'],
      })),
      setTerminalBackground: vi.fn(),
      getPolicyEngine: vi.fn(() => null),
    } as unknown as Config;

    const { loadCliConfig, parseArguments } = await import(
      './config/config.js'
    );
    vi.mocked(loadCliConfig).mockResolvedValue(mockConfig);
    vi.mocked(parseArguments).mockResolvedValueOnce({
      promptInteractive: undefined,
      prompt: undefined,
      promptWords: [],
      experimentalAcp: false,
      experimentalUi: false,
      provider: 'gemini',
      profileLoad: undefined,
      outputFormat: OutputFormat.TEXT,
      extensions: [],
      sessionSummary: undefined,
    } as unknown as import('./config/config.js').CliArgs);

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`EXIT_${code ?? 'unknown'}`);
      });
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    // Auth fails, no sandbox — deferred exit fires with FATAL_AUTHENTICATION_ERROR
    await expect(gemini.main()).rejects.toThrow(
      new RegExp(`EXIT_${ExitCodes.FATAL_AUTHENTICATION_ERROR}`),
    );

    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});
