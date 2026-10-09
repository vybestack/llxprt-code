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
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as cli from './cli.js';
import { dynamicSettingsRegistry } from './utils/dynamicSettings.js';
import type { Config, ResumeResult } from '@vybestack/llxprt-code-core';
import { OutputFormat } from '@vybestack/llxprt-code-core';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { createTestSessionMediaConfig } from './__tests__/sessionMediaConfig.js';

const actual = { ...(await import('./config/settings.js')) };
void vi.mock('./config/settings.js', () => ({
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
}));

void vi.mock('./config/config.js', () => ({ loadCliConfig: vi.fn() }));
void vi.mock('./config/cliArgParser.js', () => ({ parseArguments: vi.fn() }));

const actualRuntime = {
  ...(await import('@vybestack/llxprt-code-providers/runtime.js')),
};
void vi.mock('@vybestack/llxprt-code-providers/runtime.js', () => ({
  ...actualRuntime,
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
}));

void vi.mock('./config/extension.js', () => ({
  ExtensionStorage: { getUserExtensionsDir: vi.fn(() => '/tmp/extensions') },
  loadExtensions: vi.fn(() => []),
}));
void vi.mock('./utils/cleanup.js', () => ({
  cleanupCheckpoints: vi.fn(() => Promise.resolve()),
  registerCleanup: vi.fn(),
  registerSyncCleanup: vi.fn(),
  runExitCleanup: vi.fn(),
}));

// Agent creation has dedicated coverage in cliAgentBootstrap.test.ts.
void vi.mock('./cliAgentBootstrap.js', () => ({
  createForegroundAgent: vi.fn(async () => ({
    dispose: vi.fn().mockResolvedValue(undefined),
    getMessageBus: vi.fn(() => ({ kind: 'session-bus' })),
  })),
}));

const actualCore = { ...(await import('@vybestack/llxprt-code-core')) };
void vi.mock('@vybestack/llxprt-code-core', () => ({
  ...actualCore,
  resumeSession: vi.fn(),
  writeToStdout: vi.fn().mockReturnValue(true),
  writeToStderr: vi.fn().mockReturnValue(true),
  patchStdio: vi.fn(() => vi.fn()),
}));
void vi.mock('./ui/utils/terminalCapabilityManager.js', () => ({
  terminalCapabilityManager: {
    detectCapabilities: vi.fn(() => Promise.resolve()),
    isKittyProtocolEnabled: vi.fn(() => false),
    enableKittyProtocol: vi.fn(),
    disableKittyProtocol: vi.fn(),
    getTerminalName: vi.fn(() => undefined),
    getTerminalBackgroundColor: vi.fn(() => undefined),
  },
}));
void vi.mock('./ui/utils/terminalContract.js', () => ({
  drainStdinBuffer: vi.fn(() => Promise.resolve()),
}));
void vi.mock('./utils/stdinSafety.js', () => ({
  StdinRawModeManager: vi.fn(() => ({ enable: vi.fn(), disable: vi.fn() })),
}));
void vi.mock('./utils/sandbox.js', () => ({
  start_sandbox: vi.fn(() => Promise.resolve(0)),
}));
void vi.mock('./utils/bootstrap.js', () => ({
  shouldRelaunchForMemory: vi.fn(() => []),
  computeSandboxMemoryArgs: vi.fn(() => ['--max-old-space-size=3072']),
  parseDockerMemoryToMB: vi.fn(() => undefined),
  isDebugMode: vi.fn(() => false),
}));
void vi.mock('./utils/relaunch.js', () => ({
  relaunchAppInChildProcess: vi.fn(() => Promise.resolve(0)),
}));
void vi.mock('./utils/sessionCleanup.js', () => ({
  cleanupExpiredSessions: vi.fn(() => Promise.resolve()),
}));
void vi.mock('ink', () => ({
  render: vi.fn().mockReturnValue({ unmount: vi.fn() }),
}));

const preflightAgentActivationMock = vi.fn(async () => ({
  authFailed: false,
  token: { established: true },
}));
const actualAgents = { ...(await import('@vybestack/llxprt-code-agents')) };
void vi.mock('@vybestack/llxprt-code-agents', () => ({
  ...actualAgents,
  preflightAgentActivation: preflightAgentActivationMock,
}));

let projectTempDir: string;
let sessionMediaConfig: ReturnType<typeof createTestSessionMediaConfig>;
let resumed: ResumeResult | null;
const originalIsTTY = process.stdin.isTTY;

function makeConfig(continueRef: string | null, agentClient?: object): Config {
  const freshSessionId = randomUUID();
  const providerManager = {
    getActiveProvider: vi.fn().mockReturnValue({ name: 'gemini' }),
    getActiveProviderName: vi.fn().mockReturnValue('gemini'),
    hasActiveProvider: vi.fn().mockReturnValue(true),
    setActiveProvider: vi.fn(),
  };
  return {
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
    getToolRegistryInfo: vi.fn(() => ({ registered: [], unregistered: [] })),
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
    ...sessionMediaConfig,
    getContinueSessionRef: vi.fn(() => continueRef),
    getWorkspaceContext: vi.fn(() => ({
      getDirectories: () => ['/tmp/project'],
    })),
    getScreenReader: vi.fn(() => false),
    getTerminalBackground: vi.fn(() => undefined),
    getAgentClient: vi.fn(() => agentClient),
    setTerminalBackground: vi.fn(),
    getPolicyEngine: vi.fn(() => null),
    getTelemetrySettings: vi.fn(() => ({
      perf: { enabled: false, memory: false },
    })),
  } as unknown as Config;
}

async function configureMain(config: Config): Promise<void> {
  const { loadCliConfig } = await import('./config/config.js');
  const { parseArguments } = await import('./config/cliArgParser.js');
  (loadCliConfig as Mock<typeof loadCliConfig>).mockResolvedValueOnce(config);
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
}

function silenceMainExits(): void {
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`EXIT_${code ?? 'unknown'}`);
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

async function makeRecordedResume(): Promise<ResumeResult> {
  const chatsDir = join(projectTempDir, 'chats');
  const recording = new actualCore.SessionRecordingService({
    chatsDir,
    sessionId: 'resumed-session',
    projectHash: actualCore.getProjectHash('/tmp/project'),
    provider: 'gemini',
    model: 'gemini-2.5-pro',
    workspaceDirs: ['/tmp/project'],
  });
  recording.recordContent({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'restored user content' }],
  });
  await recording.dispose();
  const filePath = recording.getFilePath();
  if (filePath === null) throw new Error('Missing recorded session file');
  const boot = await actualCore.ResumeCursorBoot.open(
    filePath,
    2,
    (await stat(filePath)).size,
  );
  const lock = await actualCore.SessionLockManager.acquire(
    chatsDir,
    'resumed-session',
  );
  const lockHandle = {
    ...lock,
    async release(): Promise<void> {
      try {
        await boot.close();
      } finally {
        await lock.release();
      }
    },
  };
  const resumedRecording = new actualCore.SessionRecordingService({
    chatsDir,
    sessionId: 'resumed-session',
    projectHash: actualCore.getProjectHash('/tmp/project'),
    provider: 'gemini',
    model: 'gemini-2.5-pro',
    workspaceDirs: ['/tmp/project'],
  });
  resumedRecording.initializeForResume(filePath, 2);
  resumedRecording.adoptLock(lockHandle);
  const result: ResumeResult = {
    ok: true,
    boot,
    metadata: {
      kind: 'main',
      sessionId: 'resumed-session',
      projectHash: actualCore.getProjectHash('/tmp/project'),
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      workspaceDirs: ['/tmp/project'],
      startTime: new Date().toISOString(),
    },
    recording: resumedRecording,
    lockHandle,
    warnings: [],
  };
  resumed = result;
  return result;
}

async function verifyInitializesProviderBeforeInteractiveUsage(): Promise<void> {
  await configureMain(makeConfig(null));
  silenceMainExits();
  // The provider initialization assertion remains observable even if this
  // narrow CLI fixture exits after provider setup.
  try {
    await cli.main();
  } catch {
    // main() may exit in the mocked interactive environment.
  }
}

async function observeContinueRestore(failAdoption: boolean) {
  const resetChat = vi.fn().mockResolvedValue(undefined);
  const resumeChat = vi.fn().mockResolvedValue(undefined);
  const history = new HistoryService();
  const adoptResumeBootSpy = vi.spyOn(history, 'adoptResumeBoot');
  const agentClient = {
    getHistoryService: vi.fn(() => history),
    hasChatInitialized: () => true,
    storeHistoryForLaterUse: async () => {
      throw new Error('Unexpected deferred admission for active history');
    },
    resumeChat,
    resetChat,
  };
  const config = makeConfig('__CONTINUE_LATEST__', agentClient);
  const result = await makeRecordedResume();
  const recordingDisposeSpy = vi.spyOn(result.recording, 'dispose');
  const lockReleaseSpy = vi.spyOn(result.lockHandle, 'release');
  if (failAdoption) {
    // A closed cursor fails inside real journal adoption before publication.
    await result.boot.close();
  }
  const { resumeSession } = await import('@vybestack/llxprt-code-core');
  const resumeSessionMock = resumeSession as Mock<typeof resumeSession>;
  resumeSessionMock.mockResolvedValueOnce(result);
  await configureMain(config);
  silenceMainExits();
  const mainResult = await cli.main();
  return {
    mainResult,
    resumeSessionMock,
    history,
    adoptResumeBootSpy,
    config,
    resetChat,
    resumeChat,
    recordingDisposeSpy,
    lockReleaseSpy,
    result,
  };
}

describe('cli main provider initialization', () => {
  beforeEach(async () => {
    projectTempDir = await mkdtemp(join(tmpdir(), 'cli-provider-init-'));
    sessionMediaConfig = createTestSessionMediaConfig(projectTempDir);
    resumed = null;
    dynamicSettingsRegistry.reset();
    process.stdin.isTTY = true;
    vi.restoreAllMocks();
    const { resumeSession } = await import('@vybestack/llxprt-code-core');
    (resumeSession as Mock<typeof resumeSession>).mockReset();
  });

  afterEach(async () => {
    try {
      await resumed?.recording.dispose();
      await rm(projectTempDir, { recursive: true, force: true });
    } finally {
      process.stdin.isTTY = originalIsTTY;
      dynamicSettingsRegistry.reset();
      vi.restoreAllMocks();
    }
  });

  it('initializes content generator config before interactive provider usage', async () => {
    await verifyInitializesProviderBeforeInteractiveUsage();
    expect(preflightAgentActivationMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to a fresh session and does not adopt corrupted session ID when journal adoption fails during --continue flow (issue #1873)', async () => {
    const observed = await observeContinueRestore(true);
    expect(observed.mainResult).toBeUndefined();
    expect(observed.resumeSessionMock).toHaveBeenCalledTimes(1);
    expect(observed.adoptResumeBootSpy).toHaveBeenCalledTimes(1);
    expect(observed.adoptResumeBootSpy).toHaveBeenCalledWith(
      observed.result.recording,
      observed.result.boot,
      expect.any(Function),
    );
    expect(observed.history.journalPath()).not.toBe(
      observed.result.boot.filePath,
    );
    expect(observed.config.adoptSessionId).not.toHaveBeenCalled();
    expect(observed.recordingDisposeSpy).toHaveBeenCalled();
    expect(observed.lockReleaseSpy).toHaveBeenCalled();
    expect(observed.resetChat).toHaveBeenCalledTimes(1);
    observed.history.dispose();
  });

  it('adopts the resumed session ID and does not release resources when journal adoption succeeds during --continue flow (issue #1873)', async () => {
    const observed = await observeContinueRestore(false);
    expect(observed.mainResult).toBeUndefined();
    expect(observed.resumeSessionMock).toHaveBeenCalledTimes(1);
    expect(observed.adoptResumeBootSpy).toHaveBeenCalledTimes(1);
    expect(observed.adoptResumeBootSpy).toHaveBeenCalledWith(
      observed.result.recording,
      observed.result.boot,
      expect.any(Function),
    );
    expect(observed.history.journalPath()).toBe(observed.result.boot.filePath);
    expect(observed.config.adoptSessionId).toHaveBeenCalledWith(
      'resumed-session',
    );
    expect(observed.resetChat).not.toHaveBeenCalled();
    expect(observed.recordingDisposeSpy).not.toHaveBeenCalled();
    expect(observed.lockReleaseSpy).not.toHaveBeenCalled();
    observed.history.dispose();
  });
});
