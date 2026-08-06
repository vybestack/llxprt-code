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
import { main } from './cli.js';
import type { LoadedSettings } from './config/settings.js';
import { loadSettings } from './config/settings.js';
import { loadCliConfig } from './config/config.js';
import { parseArguments } from './config/cliArgParser.js';
import type { Config } from '@vybestack/llxprt-code-core';
import { OutputFormat } from '@vybestack/llxprt-code-core';
import { dynamicSettingsRegistry } from './utils/dynamicSettings.js';
import {
  shouldRelaunchForMemory,
  computeSandboxMemoryArgs,
} from './utils/bootstrap.js';
import { start_sandbox } from './utils/sandbox.js';

void vi.mock('./config/settings.js', () => ({
  loadSettings: vi.fn().mockReturnValue({
    merged: {
      advanced: {},
      security: { auth: {} },
      ui: { useAlternateBuffer: true },
    },
    setValue: vi.fn(),
    forScope: () => ({ settings: {}, originalSettings: {}, path: '' }),
    errors: [],
  }),
  migrateDeprecatedSettings: vi.fn(),
  SettingScope: {
    User: 'user',
    Workspace: 'workspace',
    System: 'system',
    SystemDefaults: 'system-defaults',
  },
}));

void vi.mock('./ui/utils/terminalCapabilityManager.js', () => ({
  terminalCapabilityManager: {
    detectCapabilities: vi.fn(),
    getTerminalBackgroundColor: vi.fn(),
  },
}));

void vi.mock('./config/config.js', () => ({
  loadCliConfig: vi.fn().mockResolvedValue({}),
}));

void vi.mock('./config/cliArgParser.js', () => ({
  parseArguments: vi.fn().mockResolvedValue({}),
}));

void vi.mock('read-package-up', () => ({
  readPackageUp: vi.fn().mockResolvedValue({
    packageJson: { name: 'test-pkg', version: 'test-version' },
    path: '/fake/path/package.json',
  }),
}));

void vi.mock('update-notifier', () => ({
  default: vi.fn(() => ({ notify: vi.fn() })),
}));

const actual = { ...(await import('./utils/events.js')) };
void vi.mock('./utils/events.js', () => {
  return { ...actual, appEvents: { emit: vi.fn() } };
});

void vi.mock('./utils/sandbox.js', () => ({
  sandbox_command: vi.fn(() => ''),
  start_sandbox: vi.fn(() => Promise.resolve(0)),
}));

const actualActual = { ...(await import('./utils/bootstrap.js')) };
void vi.mock('./utils/bootstrap.js', () => {
  return {
    ...actualActual,
    shouldRelaunchForMemory: vi.fn(() => []),
    isDebugMode: vi.fn(() => false),
    computeSandboxMemoryArgs: vi.fn(
      (..._args: Parameters<typeof actualActual.computeSandboxMemoryArgs>) =>
        ['-m', '4096'] as unknown as ReturnType<
          typeof actualActual.computeSandboxMemoryArgs
        >,
    ),
  };
});

void vi.mock('./utils/relaunch.js', () => ({
  relaunchAppInChildProcess: vi.fn().mockResolvedValue(0),
}));

void vi.mock('./utils/version.js', () => ({
  getCliVersion: vi.fn(() => Promise.resolve('1.0.0')),
}));

void vi.mock('./utils/terminalTheme.js', () => ({
  setupTerminalAndTheme: vi.fn(() => Promise.resolve(undefined)),
}));

void vi.mock('./ui/utils/updateCheck.js', () => ({
  checkForUpdates: vi.fn(() => Promise.resolve(null)),
}));

void vi.mock('./utils/cleanup.js', () => ({
  cleanupCheckpoints: vi.fn(() => Promise.resolve()),
  registerCleanup: vi.fn(),
  registerSyncCleanup: vi.fn(),
  runExitCleanup: vi.fn(),
}));

void vi.mock('ink', () => ({
  render: vi.fn().mockReturnValue({ unmount: vi.fn() }),
}));

// Mock the provider-activation executor so main() does not invoke real
// providers-runtime mutators that require a wired CLI runtime context.
const actualActual2 = { ...(await import('@vybestack/llxprt-code-agents')) };
void vi.mock('@vybestack/llxprt-code-agents', () => {
  return {
    ...actualActual2,
    executeProviderActivation: vi.fn().mockResolvedValue({
      authFailed: false,
      infoMessages: [],
    }),
  };
});

void vi.mock('./ui/utils/mouse.js', () => ({
  enableMouseEvents: vi.fn(),
  disableMouseEvents: vi.fn(),
  parseMouseEvent: vi.fn(),
  isIncompleteMouseSequence: vi.fn(),
  isMouseEventsActive: vi.fn(() => false),
  setMouseEventsActive: vi.fn(() => false),
  ENABLE_MOUSE_EVENTS: '',
  DISABLE_MOUSE_EVENTS: '',
}));

const { mockWriteToStdout } = {
  mockWriteToStdout: vi.fn().mockReturnValue(true),
};
const actualActual3 = { ...(await import('@vybestack/llxprt-code-core')) };
void vi.mock('@vybestack/llxprt-code-core', () => {
  return {
    ...actualActual3,
    writeToStdout: mockWriteToStdout,
    writeToStderr: vi.fn().mockReturnValue(true),
    patchStdio: vi.fn(() => vi.fn()),
  };
});

describe('cli sandbox maxHeapSizeMB integration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    dynamicSettingsRegistry.reset();
    process.env = { ...originalEnv };
    delete process.env.SANDBOX;
    delete process.env.LLXPRT_CODE_NO_RELAUNCH;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('passes settings maxHeapSizeMB to computeSandboxMemoryArgs and start_sandbox', async () => {
    const shouldRelaunchMock = shouldRelaunchForMemory as Mock<
      typeof shouldRelaunchForMemory
    >;
    const loadSettingsMock = loadSettings as Mock<typeof loadSettings>;
    const loadCliConfigMock = loadCliConfig as Mock<typeof loadCliConfig>;
    const startSandboxMock = start_sandbox as Mock<typeof start_sandbox>;
    const computeMock = computeSandboxMemoryArgs as Mock<
      typeof computeSandboxMemoryArgs
    >;

    shouldRelaunchMock.mockReturnValue([]);
    const customMaxHeap = 4096;
    loadSettingsMock.mockReturnValue({
      merged: {
        ui: {
          autoConfigureMaxOldSpaceSize: true,
          maxHeapSizeMB: customMaxHeap,
        },
      },
      setValue: vi.fn(),
      forScope: () => ({ settings: {}, originalSettings: {}, path: '' }),
      errors: [],
    } as unknown as LoadedSettings);

    const mockConfig = buildSandboxConfig();
    loadCliConfigMock.mockResolvedValue(mockConfig);
    (parseArguments as Mock<typeof parseArguments>).mockResolvedValueOnce(
      buildArgv('test prompt'),
    );

    const originalIsTTY = process.stdin.isTTY;
    const originalSetRawMode = process.stdin.setRawMode;
    Object.defineProperty(process.stdin, 'isTTY', {
      value: false,
      configurable: true,
    });
    Object.defineProperty(process.stdin, 'setRawMode', {
      value: vi.fn(),
      configurable: true,
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('PROCESS_EXIT');
    });

    try {
      await main();
    } catch {
      // Expected from process.exit mock
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: originalIsTTY,
        configurable: true,
      });
      Object.defineProperty(process.stdin, 'setRawMode', {
        value: originalSetRawMode,
        configurable: true,
      });
    }

    // Prove settings.merged.ui.maxHeapSizeMB flows to computeSandboxMemoryArgs
    expect(computeMock).toHaveBeenCalledWith(false, undefined, customMaxHeap);
    // Prove the resulting args flow to start_sandbox
    expect(startSandboxMock).toHaveBeenCalledWith(
      expect.anything(),
      computeSandboxMemoryArgs(false, undefined, customMaxHeap),
      expect.anything(),
      expect.anything(),
    );

    exitSpy.mockRestore();
  });
});

function buildSandboxConfig(): Config {
  const fn = vi.fn;
  return {
    initialize: fn().mockResolvedValue(undefined),
    refreshAuth: fn().mockResolvedValue(undefined),
    getProvider: fn(() => undefined),
    getProviderManager: fn(() => ({
      getActiveProvider: fn().mockReturnValue(null),
      getActiveProviderName: fn().mockReturnValue(undefined),
      hasActiveProvider: fn(() => true),
      getServerToolsProvider: fn().mockReturnValue(null),
    })),
    getConversationLoggingEnabled: fn(() => false),
    getMcpServers: fn(() => ({})),
    getDebugMode: fn(() => false),
    getIdeMode: fn(() => false),
    getIdeClient: fn(() => null),
    getListExtensions: fn(() => false),
    getOutputFormat: fn(() => OutputFormat.TEXT),
    getToolRegistryInfo: fn(() => ({ registered: [], unregistered: [] })),
    getSandbox: fn(() => ({ command: 'docker', image: 'test-image' })),
    getModel: fn(() => 'test-model'),
    getProjectRoot: fn(() => '/tmp/project'),
    isInteractive: fn(() => false),
    getSessionId: fn(() => 'session-sandbox-test'),
    getQuestion: fn(() => ''),
    isContinueSession: fn(() => false),
    getExperimentalZedIntegration: fn(() => false),
    getZedIntegrationEnabled: fn(() => false),
    getTrustedFolder: fn(() => true),
    getScreenReader: fn(() => false),
    storage: {},
    getProjectTempDir: fn(() => '/tmp/project-temp'),
    getContinueSessionRef: fn(() => null),
    getWorkspaceContext: fn(() => ({ getDirectories: () => ['/tmp/project'] })),
    setTerminalBackground: fn(),
    getTerminalBackground: fn(() => undefined),
    getPolicyEngine: fn(() => null),
  } as unknown as Config;
}

function buildArgv(prompt?: string) {
  return {
    model: undefined,
    sandbox: undefined,
    sandboxImage: undefined,
    sandboxEngine: undefined,
    sandboxProfileLoad: undefined,
    debug: undefined,
    prompt: prompt ?? undefined,
    promptInteractive: undefined,
    outputFormat: undefined,
    showMemoryUsage: undefined,
    yolo: undefined,
    approvalMode: undefined,
    telemetry: undefined,
    checkpointing: undefined,
    telemetryLogPrompts: undefined,
    telemetryOutfile: undefined,
    allowedMcpServerNames: undefined,
    allowedTools: undefined,
    experimentalAcp: false,
    experimentalUi: undefined,
    extensions: undefined,
    listExtensions: undefined,
    provider: undefined,
    key: undefined,
    keyfile: undefined,
    baseurl: undefined,
    proxy: undefined,
    includeDirectories: undefined,
    profileLoad: undefined,
    loadMemoryFromIncludeDirectories: undefined,
    ideMode: undefined,
    screenReader: undefined,
    sessionSummary: undefined,
    dumponerror: undefined,
    promptWords: [] as string[],
    query: undefined,
    set: undefined,
    continue: undefined,
    nobrowser: undefined,
    listSessions: undefined,
    deleteSession: undefined,
    imageInput: undefined,
    imageOutput: undefined,
    imagePrompt: undefined,
    quiet: undefined,
  };
}
