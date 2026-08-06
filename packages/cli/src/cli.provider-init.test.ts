/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as cli from './cli.js';
import { dynamicSettingsRegistry } from './utils/dynamicSettings.js';
import type { Config, ResumeResult } from '@vybestack/llxprt-code-core';
import { OutputFormat } from '@vybestack/llxprt-code-core';

const actual = { ...(await import('./config/settings.js')) };
vi.mock('./config/settings.js', () => {
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
}));

vi.mock('./config/cliArgParser.js', () => ({
  parseArguments: vi.fn(),
}));

const actualActual = {
  ...(await import('@vybestack/llxprt-code-providers/runtime.js')),
};
vi.mock('@vybestack/llxprt-code-providers/runtime.js', () => {
  return {
    ...actualActual,
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

// Agent creation has its own dedicated behavioral coverage in
// cliAgentBootstrap.test.ts (and the single-call wiring is asserted in
// cli.test.tsx). These provider-init tests exercise the --continue /
// restoreHistory flow, so the agent composition root is mocked at its module
// boundary to keep the narrow mock Config focused on session restore.
vi.mock('./cliAgentBootstrap.js', () => ({
  createForegroundAgent: vi.fn(async () => ({
    dispose: vi.fn().mockResolvedValue(undefined),
    getMessageBus: vi.fn(() => ({ kind: 'session-bus' })),
  })),
}));

const actualActual2 = { ...(await import('@vybestack/llxprt-code-core')) };
vi.mock('@vybestack/llxprt-code-core', () => {
  return {
    ...actualActual2,
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

const preflightAgentActivationMock = vi.fn(async () => ({
  authFailed: false,
  token: { established: true },
}));

const actualActual3 = { ...(await import('@vybestack/llxprt-code-agents')) };
vi.mock('@vybestack/llxprt-code-agents', () => {
  return {
    ...actualActual3,
    preflightAgentActivation: preflightAgentActivationMock,
  };
});

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
    lockHandle: {
      lockPath: '/tmp/resumed-session.lock',
      release: vi.fn().mockResolvedValue(undefined),
    } as unknown as ResumeResult['lockHandle'],
    warnings: [],
  };
}

describe('cli main provider initialization', () => {
  const originalIsTTY = process.stdin.isTTY;
  let projectTempDir = '';

  beforeEach(async () => {
    projectTempDir = '';
    projectTempDir = await mkdtemp(join(tmpdir(), 'cli-provider-init-'));
    dynamicSettingsRegistry.reset();
    process.stdin.isTTY = true;
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    try {
      if (projectTempDir !== '') {
        await rm(projectTempDir, { recursive: true, force: true });
      }
    } finally {
      process.stdin.isTTY = originalIsTTY;
      dynamicSettingsRegistry.reset();
    }
  });

  it('initializes content generator config before interactive provider usage', async () => {
    const freshSessionId = randomUUID();
    const providerManager = {
      getActiveProvider: vi.fn().mockReturnValue({ name: 'gemini' }),
      getActiveProviderName: vi.fn().mockReturnValue('gemini'),
      getServerToolsProvider: vi.fn().mockReturnValue(null),
      hasActiveProvider: vi.fn().mockReturnValue(true),
      setActiveProvider: vi.fn().mockReturnValue(undefined),
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
      getEphemeralSetting: vi.fn(() => undefined),
      setEphemeralSetting: vi.fn(),
      getProjectRoot: vi.fn(() => '/tmp/project'),
      isInteractive: vi.fn(() => true),
      getSessionId: vi.fn(() => freshSessionId),
      adoptSessionId: vi.fn(),
      getQuestion: vi.fn(() => ''),
      getExperimentalZedIntegration: vi.fn(() => false),
      getZedIntegrationEnabled: vi.fn(() => false),
      getTrustedFolder: vi.fn(() => true),
      getProjectTempDir: vi.fn(() => projectTempDir),
      getContinueSessionRef: vi.fn(() => null),
      getWorkspaceContext: vi.fn(() => ({
        getDirectories: () => ['/tmp/project'],
      })),
      getScreenReader: vi.fn(() => false),
      getTerminalBackground: vi.fn(() => undefined),

      setTerminalBackground: vi.fn(),
      getPolicyEngine: vi.fn(() => null),
    } as unknown as Config;

    const { loadCliConfig } = await import('./config/config.js');
    const { parseArguments } = await import('./config/cliArgParser.js');
    (loadCliConfig as Mock<typeof loadCliConfig>).mockResolvedValueOnce(
      mockConfig,
    );
    (parseArguments as Mock<typeof parseArguments>).mockResolvedValueOnce({
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
    } as unknown as import('./config/cliArgParser.js').CliArgs);

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`EXIT_${code ?? 'unknown'}`);
      });
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    // main() may complete or throw from process.exit in this mocked environment.
    // We only need to verify that provider initialization runs before UI.
    try {
      await cli.main();
    } catch {
      // Ignore exits or other throws.
    }

    expect(preflightAgentActivationMock).toHaveBeenCalledTimes(1);
    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('falls back to a fresh session and does not adopt corrupted session ID when restoreHistory fails during --continue flow (issue #1873)', async () => {
    const freshSessionId = randomUUID();
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
    const resetChat = vi.fn().mockResolvedValue(undefined);
    const getAgentClient = vi.fn(() => ({ restoreHistory, resetChat }));

    const adoptSessionId = vi.fn();
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
      getEphemeralSetting: vi.fn(() => undefined),
      setEphemeralSetting: vi.fn(),
      getProjectRoot: vi.fn(() => '/tmp/project'),
      isInteractive: vi.fn(() => true),
      getSessionId: vi.fn(() => freshSessionId),
      adoptSessionId,
      getQuestion: vi.fn(() => ''),
      getExperimentalZedIntegration: vi.fn(() => false),
      getZedIntegrationEnabled: vi.fn(() => false),
      getTrustedFolder: vi.fn(() => true),
      getProjectTempDir: vi.fn(() => projectTempDir),
      getContinueSessionRef: vi.fn(() => '__CONTINUE_LATEST__'),
      getWorkspaceContext: vi.fn(() => ({
        getDirectories: () => ['/tmp/project'],
      })),
      getScreenReader: vi.fn(() => false),
      getTerminalBackground: vi.fn(() => undefined),

      getAgentClient,
      setTerminalBackground: vi.fn(),
      getPolicyEngine: vi.fn(() => null),
    } as unknown as Config;

    const resumeResult = makeResumeResult('restored user content');
    const recordingDisposeSpy = resumeResult.recording.dispose as ReturnType<
      typeof vi.fn
    >;
    const lockReleaseSpy = resumeResult.lockHandle.release as ReturnType<
      typeof vi.fn
    >;

    const coreModule = await import('@vybestack/llxprt-code-core');
    const resumeSessionMock = coreModule.resumeSession as Mock<
      typeof coreModule.resumeSession
    >;
    resumeSessionMock.mockResolvedValueOnce(resumeResult);

    const { loadCliConfig } = await import('./config/config.js');
    const { parseArguments } = await import('./config/cliArgParser.js');
    (loadCliConfig as Mock<typeof loadCliConfig>).mockResolvedValueOnce(
      mockConfig,
    );
    (parseArguments as Mock<typeof parseArguments>).mockResolvedValueOnce({
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
    } as unknown as import('./config/cliArgParser.js').CliArgs);

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

    // Issue #1873: main() must NOT throw — it should fall back to a fresh
    // session. If the try/catch didn't handle the restore error, main()
    // would throw 'restore failed on purpose'.
    expect(await cli.main()).toBeUndefined();

    // resumeSession was called to load the session
    expect(resumeSessionMock).toHaveBeenCalledTimes(1);
    // restoreHistory was attempted with the resumed content
    expect(restoreHistory).toHaveBeenCalledTimes(1);

    // Issue #1873 ACC-1: The corrupted session's ID must NOT be adopted.
    // Previously adoptSessionId was called BEFORE restoreHistory, leaving
    // the agent in a half-restored state (adopted session ID but history
    // never restored) that hangs when the user sends a prompt.
    expect(adoptSessionId).not.toHaveBeenCalled();

    // Issue #1873 ACC-3: Resources from the failed resume must be released
    // so the corrupted session file is unlocked and the recording closed.
    expect(recordingDisposeSpy).toHaveBeenCalled();
    expect(lockReleaseSpy).toHaveBeenCalled();

    // Issue #1873: restoreHistory is not atomic — it may partially populate
    // the AgentClient before throwing. resetChat ensures no half-restored
    // items persist into the fresh session.
    expect(resetChat).toHaveBeenCalledTimes(1);

    resumeSessionMock.mockReset();
    exitSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('adopts the resumed session ID and does not release resources when restoreHistory succeeds during --continue flow (issue #1873)', async () => {
    const freshSessionId = randomUUID();
    const providerManager = {
      getActiveProvider: vi.fn().mockReturnValue({ name: 'gemini' }),
      getActiveProviderName: vi.fn().mockReturnValue('gemini'),
      getServerToolsProvider: vi.fn().mockReturnValue(null),
      hasActiveProvider: vi.fn().mockReturnValue(true),
      setActiveProvider: vi.fn().mockReturnValue(undefined),
    };

    const restoreHistory = vi.fn().mockResolvedValue(undefined);
    const resetChat = vi.fn().mockResolvedValue(undefined);
    const getAgentClient = vi.fn(() => ({ restoreHistory, resetChat }));

    const adoptSessionId = vi.fn();
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
      getEphemeralSetting: vi.fn(() => undefined),
      setEphemeralSetting: vi.fn(),
      getProjectRoot: vi.fn(() => '/tmp/project'),
      isInteractive: vi.fn(() => true),
      getSessionId: vi.fn(() => freshSessionId),
      adoptSessionId,
      getQuestion: vi.fn(() => ''),
      getExperimentalZedIntegration: vi.fn(() => false),
      getZedIntegrationEnabled: vi.fn(() => false),
      getTrustedFolder: vi.fn(() => true),
      getProjectTempDir: vi.fn(() => projectTempDir),
      getContinueSessionRef: vi.fn(() => '__CONTINUE_LATEST__'),
      getWorkspaceContext: vi.fn(() => ({
        getDirectories: () => ['/tmp/project'],
      })),
      getScreenReader: vi.fn(() => false),
      getTerminalBackground: vi.fn(() => undefined),

      getAgentClient,
      setTerminalBackground: vi.fn(),
      getPolicyEngine: vi.fn(() => null),
    } as unknown as Config;

    const resumeResult = makeResumeResult('restored user content');
    const recordingDisposeSpy = resumeResult.recording.dispose as ReturnType<
      typeof vi.fn
    >;
    const lockReleaseSpy = resumeResult.lockHandle.release as ReturnType<
      typeof vi.fn
    >;

    const coreModule = await import('@vybestack/llxprt-code-core');
    const resumeSessionMock = coreModule.resumeSession as Mock<
      typeof coreModule.resumeSession
    >;
    resumeSessionMock.mockResolvedValueOnce(resumeResult);

    const { loadCliConfig } = await import('./config/config.js');
    const { parseArguments } = await import('./config/cliArgParser.js');
    (loadCliConfig as Mock<typeof loadCliConfig>).mockResolvedValueOnce(
      mockConfig,
    );
    (parseArguments as Mock<typeof parseArguments>).mockResolvedValueOnce({
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
    } as unknown as import('./config/cliArgParser.js').CliArgs);

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

    expect(await cli.main()).toBeUndefined();

    expect(resumeSessionMock).toHaveBeenCalledTimes(1);
    expect(restoreHistory).toHaveBeenCalledTimes(1);

    // On success, the resumed session ID IS adopted (correct behavior).
    expect(adoptSessionId).toHaveBeenCalledWith('resumed-session');

    // On success, resetChat is NOT called — the restored history is kept.
    expect(resetChat).not.toHaveBeenCalled();

    // On success, the resumed recording and lock are NOT disposed during
    // startup — they are held for the session lifecycle.
    expect(recordingDisposeSpy).not.toHaveBeenCalled();
    expect(lockReleaseSpy).not.toHaveBeenCalled();

    resumeSessionMock.mockReset();
    exitSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});
