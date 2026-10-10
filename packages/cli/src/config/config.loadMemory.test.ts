/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentActivationOperation } from '@vybestack/llxprt-code-agents';

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  DEFAULT_CONTEXT_FILENAME,
  setLlxprtMdFilename,
} from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { loadCliConfig } from './config.js';
import { type CliArgs } from './cliArgParser.js';
import type { Settings } from './settings.js';

const actual = { ...(await import('@vybestack/llxprt-code-core')) };
void vi.mock('@vybestack/llxprt-code-core', () => ({
  ...actual,
  isRipgrepAvailable: vi.fn().mockResolvedValue(true),
}));

const createRuntimeState = () => ({
  runtime: {
    runtimeId: 'cli.runtime.test',
    metadata: {},
    settingsService: new SettingsService(),
  },
  providerManager: {
    getActiveProviderName: vi.fn(() => 'openai'),
    getActiveProvider: vi.fn(() => ({
      name: 'openai',
      getDefaultModel: () => 'hf:zai-org/GLM-4.6',
    })),
    setActiveProvider: vi.fn().mockResolvedValue(undefined),
    listProviders: vi.fn(() => ['openai']),
    prepareStatelessProviderInvocation: vi.fn(),
    getAvailableModels: vi
      .fn()
      .mockResolvedValue([
        { id: 'hf:zai-org/GLM-4.6', name: 'hf:zai-org/GLM-4.6' },
      ]),
    getProviderByName: vi.fn(() => undefined),
  },
  oauthManager: null,
});

const runtimeStateRef = {
  value: createRuntimeState(),
};

const resetRuntimeState = () => {
  runtimeStateRef.value = createRuntimeState();
};

void vi.mock('./profileBootstrap.js', () => ({
  parseBootstrapArgs: vi.fn(() => ({
    bootstrapArgs: {
      profileName: null,
      providerOverride: null,
      modelOverride: null,
      keyOverride: null,
      keyfileOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    },
    runtimeMetadata: {},
  })),
  prepareRuntimeForProfile: vi.fn(async () => runtimeStateRef.value),
  createBootstrapResult: vi.fn(
    ({
      runtime,
      providerManager,
      oauthManager,
      bootstrapArgs,
      profileApplication,
    }) => ({
      runtime,
      providerManager,
      oauthManager,
      bootstrapArgs,
      profile: profileApplication,
    }),
  ),
}));

void vi.mock('@vybestack/llxprt-code-providers/runtime.js', () => {
  const getProviderManager = () => runtimeStateRef.value.providerManager;
  const applyProfileSnapshot = vi.fn(async () => ({
    providerName: 'openai',
    modelName: 'hf:zai-org/GLM-4.6',
    infoMessages: [],
    warnings: [],
    providerChanged: false,
    didFallback: false,
    requestedProvider: 'openai',
  }));
  const switchActiveProvider = vi.fn(async () => ({
    changed: false,
    previousProvider: null,
    nextProvider: 'openai',
    infoMessages: [],
  }));
  const applyCliArgumentOverrides = vi.fn(async () => {});
  return {
    ephemeralSettingHelp: {},
    parseEphemeralSettingValue: vi.fn((_key: string, rawValue: string) => ({
      success: true,
      value: rawValue,
    })),
    applyCliSetArguments: vi.fn(() => ({ modelParams: {} })),
    applyProfileSnapshot,
    switchActiveProvider,
    applyCliArgumentOverrides,
    providerManager: vi.fn(() => runtimeStateRef.value.providerManager),
    oauthManager: vi.fn(() => runtimeStateRef.value.oauthManager),
    providerStatus: vi.fn(() => ({ name: 'openai', isReady: true })),
    listProviders: vi.fn(() => getProviderManager().listProviders()),
    getActiveProviderName: vi.fn(() =>
      getProviderManager().getActiveProviderName(),
    ),
    setActiveModel: vi.fn(async () => ({
      changed: false,
      previousModel: null,
      nextModel: 'hf:zai-org/GLM-4.6',
      infoMessages: [],
    })),
    listAvailableModels: vi.fn(
      async () => (await getProviderManager().getAvailableModels()) ?? [],
    ),
    getActiveModelName: vi.fn(() => 'hf:zai-org/GLM-4.6'),
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
    assembleCliProviderRuntime: vi.fn(
      (input: {
        settingsService: unknown;
        config: unknown;
        runtimeId: string;
        metadata?: Record<string, unknown>;
      }) => ({
        runtime: {
          settingsService: input.settingsService,
          config: input.config,
          runtimeId: input.runtimeId,
          metadata: input.metadata,
        },
        runtimeMessageBus: { kind: 'session-bus' },
        providerManager: getProviderManager(),
        oauthManager: { id: 'oauth-manager' },
      }),
    ),
  };
});

describe('loadCliConfig memory discovery', () => {
  let tempRoot: string;
  let workspaceDir: string;
  let includeDir: string;
  let homeDir: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(async () => {
    resetRuntimeState();
    tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'llxprt-cli-config-test-'),
    );
    workspaceDir = path.join(tempRoot, 'workspace');
    includeDir = path.join(tempRoot, 'include');
    homeDir = path.join(tempRoot, 'home');
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(includeDir, { recursive: true });
    await fs.mkdir(homeDir, { recursive: true });

    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    setLlxprtMdFilename(DEFAULT_CONTEXT_FILENAME);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  function createSettings(contextFileName: string): Settings {
    return {
      includeDirectories: [] as string[],
      loadMemoryFromIncludeDirectories: false,
      folderTrust: false,
      telemetry: { enabled: false },
      accessibility: { screenReader: false, enableLoadingPhrases: true },
      ui: {
        contextFileName,
        memoryDiscoveryMaxDirs: 200,
      },
      experimental: {
        jitContext: false,
      },
    } as unknown as Settings;
  }

  function createArgv(): CliArgs {
    return {
      model: undefined,
      sandbox: undefined,
      sandboxImage: undefined,
      sandboxEngine: undefined,
      sandboxProfileLoad: undefined,
      debug: false,
      prompt: undefined,
      promptInteractive: undefined,
      outputFormat: undefined,

      showMemoryUsage: false,
      yolo: false,
      approvalMode: undefined,
      telemetry: undefined,
      telemetryLogPrompts: undefined,
      telemetryOutfile: undefined,
      allowedMcpServerNames: undefined,
      experimentalAcp: undefined,
      experimentalUi: undefined,
      extensions: undefined,
      listExtensions: undefined,
      provider: undefined,
      key: undefined,
      keyfile: undefined,
      baseurl: undefined,
      proxy: undefined,
      includeDirectories: [includeDir],
      allowedTools: undefined,
      checkpointing: undefined,
      profileLoad: undefined,
      loadMemoryFromIncludeDirectories: undefined,
      ideMode: undefined,
      screenReader: undefined,
      sessionSummary: undefined,
      dumponerror: undefined,
      promptWords: [],
      set: undefined,
      query: undefined,
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

  it('loads CLI-declared include context when the settings include-memory flag is disabled', async () => {
    const contextFileName = 'AGENTS.md';
    const contextContent = '# Guidance\nAlways follow agent instructions.';
    const includedContextPath = path.join(includeDir, contextFileName);
    await fs.writeFile(includedContextPath, contextContent, 'utf-8');

    const settings = createSettings(contextFileName);

    const argv = createArgv();

    const { ExtensionEnablementManager, ExtensionStorage } = await import(
      './extension.js'
    );
    let operation: AgentActivationOperation | undefined;
    const config = await loadCliConfig(
      settings,
      [],
      new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir()),
      'test-session',
      argv,
      workspaceDir,
      {
        onActivationBootstrapReady: (owner) => {
          operation = owner;
        },
      },
    );

    if (operation === undefined)
      throw new Error('Missing retained CLI activation root');
    try {
      expect(
        operation.workspaceMemory.operations.snapshot().memoryContent,
      ).toContain(contextContent);
      expect(
        operation.workspaceMemory.operations.snapshot().fileCount,
      ).toBeGreaterThan(0);
      expect(config.getProvidedInstructions()).toBe('');
    } finally {
      await operation.dispose();
    }
  });

  it('releases the CLI-created workspace memory exactly once when the activation is disposed', async () => {
    const { ExtensionEnablementManager, ExtensionStorage } = await import(
      './extension.js'
    );
    let operation: AgentActivationOperation | undefined;
    await loadCliConfig(
      createSettings('AGENTS.md'),
      [],
      new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir()),
      'test-session',
      createArgv(),
      workspaceDir,
      {
        onActivationBootstrapReady: (owner) => {
          operation = owner;
        },
      },
    );
    if (operation === undefined)
      throw new Error('Missing retained CLI activation root');
    const memory = operation.workspaceMemory;
    expect(operation.workspaceMemoryOwnership).toBe('transferred');
    const originalDispose = memory.dispose.bind(memory);
    let memoryDisposals = 0;
    memory.dispose = () => {
      memoryDisposals += 1;
      return originalDispose();
    };

    await Promise.all([operation.dispose(), operation.dispose()]);

    expect(memoryDisposals).toBe(1);
    expect(() => memory.operations.snapshot()).toThrow(
      'Instructions are disposed',
    );
  });
});
