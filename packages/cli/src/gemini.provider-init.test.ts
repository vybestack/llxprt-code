/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as gemini from './gemini.js';
import { dynamicSettingsRegistry } from './utils/dynamicSettings.js';
import type { Config, ResumeResult } from '@vybestack/llxprt-code-core';
import { OutputFormat } from '@vybestack/llxprt-code-core';

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
    resumeSession: vi.fn(),
  };
});

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
  runExitCleanup: vi.fn(),
}));

vi.mock('./ui/utils/kittyProtocolDetector.js', () => ({
  detectAndEnableKittyProtocol: vi.fn(() => Promise.resolve()),
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
  isDebugMode: vi.fn(() => false),
}));

vi.mock('./utils/relaunch.js', () => ({
  relaunchAppInChildProcess: vi.fn(() => Promise.resolve(0)),
}));

vi.mock('./utils/sessionCleanup.js', () => ({
  cleanupExpiredSessions: vi.fn(() => Promise.resolve()),
}));

function makeResumeResult(historyText = 'resumed'): ResumeResult {
  return {
    ok: true,
    history: [
      { speaker: 'human', blocks: [{ type: 'text', text: historyText }] },
    ],
    metadata: {
      sessionId: 'resumed-session',
      projectHash: 'project-hash',
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      workspaceDirs: ['/tmp/project'],
      startTime: new Date().toISOString(),
    },
    recording: {
      dispose: vi.fn().mockResolvedValue(undefined),
      flush: vi.fn().mockResolvedValue(undefined),
      isActive: vi.fn().mockReturnValue(true),
      getFilePath: vi.fn().mockReturnValue('/tmp/session.jsonl'),
      getSessionId: vi.fn().mockReturnValue('resumed-session'),
      recordContent: vi.fn(),
      recordCompressed: vi.fn(),
      recordRewind: vi.fn(),
      recordProviderSwitch: vi.fn(),
      recordSessionEvent: vi.fn(),
      recordDirectoriesChanged: vi.fn(),
      initializeForResume: vi.fn(),
      enqueue: vi.fn(),
    } as unknown as ResumeResult['recording'],
    warnings: [],
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
      getQuestion: vi.fn(() => ''),
      getExperimentalZedIntegration: vi.fn(() => false),
      getZedIntegrationEnabled: vi.fn(() => false),
      getTrustedFolder: vi.fn(() => true),
      getProjectTempDir: vi.fn(() => '/tmp/project-temp'),
      getContinueSessionRef: vi.fn(() => null),
      getWorkspaceContext: vi.fn(() => ({
        getDirectories: () => ['/tmp/project'],
      })),
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
      experimentalUi: true,
      provider: 'gemini',
      profileLoad: undefined,
      outputFormat: OutputFormat.TEXT,
      extensions: [],
      sessionSummary: undefined,
    } as unknown as import('./config/config.js').CliArgs);

    const startInteractiveSpy = vi
      .spyOn(gemini, 'startInteractiveUI')
      .mockImplementation(async () => {
        throw new Error('STOP_INTERACTIVE');
      });

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`EXIT_${code ?? 'unknown'}`);
      });
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await expect(gemini.main()).rejects.toThrow(/STOP_INTERACTIVE|EXIT_1/);

    expect(mockConfig.refreshAuth).toHaveBeenCalledTimes(1);
    startInteractiveSpy.mockRestore();
    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('warns and continues to interactive startup when restoreHistory fails during --continue flow', async () => {
    const providerManager = {
      getActiveProvider: vi.fn().mockReturnValue({ name: 'gemini' }),
      getActiveProviderName: vi.fn().mockReturnValue('gemini'),
      getServerToolsProvider: vi.fn().mockReturnValue(null),
      hasActiveProvider: vi.fn().mockReturnValue(true),
      setActiveProvider: vi.fn().mockResolvedValue(undefined),
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
      getGeminiClient,
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
      experimentalUi: true,
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

    // main() flow: resume → restoreHistory throws → catch swallows error →
    // continues to experimentalUi bun check → process.exit(1) → EXIT_1.
    // If the try/catch didn't swallow the restore error, main() would
    // throw 'restore failed on purpose' instead of reaching EXIT_1.
    await expect(gemini.main()).rejects.toThrow(/EXIT_1/);

    // resumeSession was called to load the session
    expect(resumeSessionMock).toHaveBeenCalledTimes(1);
    // restoreHistory was called with the resumed content
    expect(restoreHistory).toHaveBeenCalledTimes(1);
    // The rejection from restoreHistory did NOT propagate — flow continued
    // past the try/catch to the experimentalUi bun check (EXIT_1 proves
    // this; the restore error message 'restore failed on purpose' never
    // escaped main()).

    resumeSessionMock.mockReset();
    exitSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});
