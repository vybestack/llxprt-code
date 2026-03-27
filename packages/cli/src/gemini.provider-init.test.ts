/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as gemini from './gemini.js';
import { dynamicSettingsRegistry } from './utils/dynamicSettings.js';
import type { Config } from '@vybestack/llxprt-code-core';
import { OutputFormat } from '@vybestack/llxprt-code-core';

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
});
