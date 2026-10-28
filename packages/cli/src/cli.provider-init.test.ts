/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CliArgs } from './config/cliArgParser.js';

import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';

import { handoffCliConfig } from './test-utils/bootstrap-config.js';

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
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cli from './cli.js';
import { dynamicSettingsRegistry } from './utils/dynamicSettings.js';
import {
  Config,
  OutputFormat,
  WorkspaceFilesystemOwner,
  WorkspaceTrustLifecycle,
  assembleWorkspaceMemory,
} from '@vybestack/llxprt-code-core';
import {
  AgentProfilePreflight,
  createAgent,
  prepareAgentPreflight,
  type Agent,
} from '@vybestack/llxprt-code-agents';
import { createTestSessionMediaConfig } from './__tests__/sessionMediaConfig.js';
import { createLoadedSettings } from './__tests__/loaded-settings-fixture.js';

const fakeResponses = fileURLToPath(
  new URL(
    '../../agents/src/api/__tests__/fixtures/plain-text.jsonl',
    import.meta.url,
  ),
);

const actual = { ...(await import('./config/settings.js')) };
void vi.mock('./config/settings.js', () => ({
  ...actual,
  loadSettings: vi.fn(() =>
    createLoadedSettings({
      extensions: { disabled: [] },
      security: { auth: {} },
      ui: { autoConfigureMaxOldSpaceSize: false, customThemes: {} },
    }),
  ),
  migrateDeprecatedSettings: vi.fn(),
}));

void vi.mock('./config/config.js', () => ({
  loadCliConfig: vi.fn(),
}));

void vi.mock('./config/cliArgParser.js', () => ({
  parseArguments: vi.fn(),
}));

void vi.mock('./config/extension.js', () => ({
  ExtensionStorage: {
    getUserExtensionsDir: vi.fn(() => '/tmp/extensions'),
  },
  loadExtensions: vi.fn(() => []),
}));

void vi.mock('./utils/cleanup.js', () => ({
  cleanupCheckpoints: vi.fn(() => Promise.resolve()),
  registerCleanup: vi.fn(),
  registerSyncCleanup: vi.fn(),
  runExitCleanup: vi.fn(),
}));

// Agent construction is covered in cliAgentBootstrap.test.ts; the continuation
// cases supply a real Agent and Config at this composition boundary.
void vi.mock('./cliAgentBootstrap.js', () => ({
  createForegroundAgent: vi.fn(async () => ({
    dispose: vi.fn().mockResolvedValue(undefined),
    getMessageBus: vi.fn(() => ({ kind: 'session-bus' })),
  })),
}));

const actualActual2 = { ...(await import('@vybestack/llxprt-code-core')) };
void vi.mock('@vybestack/llxprt-code-core', () => ({
  ...actualActual2,
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
  StdinRawModeManager: vi.fn(() => ({
    enable: vi.fn(),
    disable: vi.fn(),
  })),
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

const preflightMock = vi.fn(async () => ({
  authFailed: false,
  token: { established: true },
  infoMessages: [],
}));

describe('cli main provider initialization', () => {
  const originalIsTTY = process.stdin.isTTY;
  const originalHome = process.env.LLXPRT_CONFIG_HOME;
  const originalLogHome = process.env.LLXPRT_LOG_HOME;
  const originalFake = process.env.LLXPRT_FAKE_RESPONSES;
  let projectTempDir = '';
  let sessionMediaConfig: ReturnType<typeof createTestSessionMediaConfig>;

  beforeEach(async () => {
    projectTempDir = '';
    projectTempDir = await mkdtemp(
      join(tmpdir(), 'llxprt-provider-init-sessions-'),
    );
    sessionMediaConfig = createTestSessionMediaConfig(projectTempDir);
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
      if (originalHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
      else process.env.LLXPRT_CONFIG_HOME = originalHome;
      if (originalLogHome === undefined) delete process.env.LLXPRT_LOG_HOME;
      else process.env.LLXPRT_LOG_HOME = originalLogHome;
      if (originalFake === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = originalFake;
    }
  });

  async function verifyInitializesContentGeneratorConfigBeforeInteractiveProviderUsage() {
    const freshSessionId = randomUUID();

    const mockConfig = new Config({
      sessionId: freshSessionId,
      targetDir: projectTempDir,
      cwd: projectTempDir,
      debugMode: false,
      model: 'gemini-2.5-pro',
      provider: 'gemini',
      interactive: true,
      initialSettings: {},
    });
    Object.assign(mockConfig, {
      initialize: vi.fn().mockResolvedValue(undefined),
      getProvider: vi.fn(() => 'gemini'),
      getConversationLoggingEnabled: vi.fn(() => false),
      getMcpServers: vi.fn(() => ({})),
      getDebugMode: vi.fn(() => false),

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
      ...sessionMediaConfig,
      getContinueSessionRef: vi.fn(() => null),

      getScreenReader: vi.fn(() => false),
      getTerminalBackground: vi.fn(() => undefined),

      setTerminalBackground: vi.fn(),
      getPolicyEngine: vi.fn(() => null),
      getTelemetrySettings: vi.fn(() => ({
        perf: { enabled: false, memory: false },
      })),
    });
    const { loadCliConfig } = await import('./config/config.js');
    const { parseArguments } = await import('./config/cliArgParser.js');
    (loadCliConfig as Mock<typeof loadCliConfig>).mockImplementationOnce(
      handoffCliConfig(mockConfig, preflightMock),
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
    } as unknown as CliArgs);

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

    return {
      preflight: preflightMock,
      exitSpy,
      consoleErrorSpy,
    };
  }

  it('initializes content generator config before interactive provider usage', async () => {
    const behaviorResult =
      await verifyInitializesContentGeneratorConfigBeforeInteractiveProviderUsage();

    expect(behaviorResult.preflight).toHaveBeenCalledTimes(1);
    behaviorResult.exitSpy.mockRestore();
    behaviorResult.consoleErrorSpy.mockRestore();
  });

  async function seedSession(id: string, text: string): Promise<string> {
    const agent = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: projectTempDir,
      sessionId: id,
    });
    try {
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('Seed recording path missing');
      await agent.session.setRecording({ enabled: false });
      return path;
    } finally {
      await agent.dispose();
    }
  }

  async function continueLatest() {
    process.env.LLXPRT_CONFIG_HOME = projectTempDir;
    process.env.LLXPRT_LOG_HOME = join(projectTempDir, 'log');
    process.env.LLXPRT_FAKE_RESPONSES = fakeResponses;
    const olderId = randomUUID();
    const latestId = randomUUID();
    const olderPath = await seedSession(olderId, 'older provider-init turn');
    const latestPath = await seedSession(latestId, 'latest provider-init turn');
    const freshId = randomUUID();
    const config = new Config({
      cwd: projectTempDir,
      targetDir: projectTempDir,
      debugMode: false,
      sessionId: freshId,
      model: 'fake-model',
      provider: 'fake',
      continueSession: true,
      initialSettings: {},
      interactive: true,
    });
    const { loadCliConfig } = await import('./config/config.js');
    const { parseArguments } = await import('./config/cliArgParser.js');
    (loadCliConfig as Mock<typeof loadCliConfig>).mockImplementationOnce(
      handoffCliConfig(config, preflightMock),
    );
    (parseArguments as Mock<typeof parseArguments>).mockResolvedValueOnce({
      promptInteractive: undefined,
      prompt: undefined,
      promptWords: [],
      experimentalAcp: false,
      experimentalUi: true,
      provider: 'fake',
      profileLoad: undefined,
      outputFormat: OutputFormat.TEXT,
      extensions: [],
      sessionSummary: undefined,
    } as unknown as CliArgs);
    const foreground = await openForegroundOwner(config, freshId);
    const owner = foreground.agent;
    const { createForegroundAgent } = await import('./cliAgentBootstrap.js');
    (
      createForegroundAgent as Mock<typeof createForegroundAgent>
    ).mockResolvedValueOnce(owner);
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`EXIT_${code ?? 'unknown'}`);
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await cli.main();
      const history = await owner.getHistory();
      for await (const _event of owner.stream('provider-init-continued')) {
        /* consume the fake provider turn */
      }
      const recording = owner.session.getRecording();
      const chatsDir = config.projectChatsDir;
      const filesDuringStartup = await readdir(chatsDir);
      const locksDuringStartup = filesDuringStartup.filter((name) =>
        name.endsWith('.lock'),
      );
      const sessionFiles = filesDuringStartup.filter((name) =>
        name.endsWith('.jsonl'),
      );
      if (!recording.path) throw new Error('Owner recording was not started');
      const continuedTranscript = await readFile(recording.path, 'utf8');
      const adoptedId = config.getSessionId();
      const exited = exit.mock.calls.length;
      await owner.dispose();
      const locksAfterExit = (await readdir(config.projectChatsDir)).filter(
        (name) => name.endsWith('.lock'),
      );
      return {
        result,
        recording,
        history,
        locksDuringStartup,
        locksAfterExit,
        sessionFiles,
        continuedTranscript,
        exited,
        adoptedId,
        olderId,
        latestId,
        olderPath,
        latestPath,
        freshId,
      };
    } finally {
      exit.mockRestore();
      error.mockRestore();
      await owner.dispose();
      await foreground.preflight.dispose();
      await config.dispose();
    }
  }

  it('resumes the latest owner transcript without starting another recording during --continue (issue #1873)', async () => {
    const {
      result,
      adoptedId,
      recording,
      history,
      olderId,
      latestId,
      olderPath,
      latestPath,
      locksDuringStartup,
      locksAfterExit,
      sessionFiles,
      continuedTranscript,
      exited,
    } = await continueLatest();
    expect(result).toBeUndefined();
    expect(exited).toBe(0);
    expect(sessionFiles).toHaveLength(2);
    expect(continuedTranscript).toContain('provider-init-continued');
    expect(adoptedId).toBe(latestId);
    expect(adoptedId).not.toBe(olderId);
    expect(recording.path).toBe(latestPath);
    expect(recording.path).not.toBe(olderPath);
    expect(JSON.stringify(history)).toContain('latest provider-init turn');
    expect(JSON.stringify(history)).not.toContain('older provider-init turn');
    expect(locksDuringStartup).toHaveLength(1);
    expect(locksAfterExit).toHaveLength(0);
  }, 30000);
});

// The CLI's production route to a foreground agent: the preflight prepared
// over the caller's Config, then `createForegroundAgent` with the accepted
// activation. The foreground assembly adopts the Config's session identity.
async function openForegroundOwner(
  config: Config,
  runtimeId: string,
): Promise<{ agent: Agent; preflight: AgentProfilePreflight }> {
  const preflight = await prepareAgentPreflight(
    { runtimeId },
    new CredentialAuthority(),
    new SettingsService(),
  );
  const trust = new WorkspaceTrustLifecycle({
    localTrust: config.initialWorkspaceTrust,
  });
  const filesystem = new WorkspaceFilesystemOwner({
    targetDir: config.getTargetDir(),
    isTrusted: () => trust.isTrustedFolder(),
  });
  await preflight.preparePostConfiguration(
    config,
    filesystem,
    assembleWorkspaceMemory(config, filesystem, trust),
    trust,
    () => trust.dispose(),
    undefined,
  );
  const intent = { provider: 'fake', model: 'fake-model' };
  const result = await preflight.preflight(intent);
  if (result.token === undefined) throw new Error('Missing activation receipt');
  const agent = await AgentProfilePreflight.createForegroundAgent(
    preflight,
    result.token,
    intent,
    {},
  );
  return { agent, preflight };
}
