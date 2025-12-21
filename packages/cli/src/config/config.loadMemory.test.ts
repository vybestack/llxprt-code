/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  DEFAULT_CONTEXT_FILENAME,
  resetSettingsService,
  setLlxprtMdFilename,
} from '@vybestack/llxprt-code-core';
import { loadCliConfig, type CliArgs } from './config.js';
import type { Settings } from './settings.js';

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import('@vybestack/llxprt-code-core');
  return {
    ...actual,
    Config: vi.fn().mockImplementation((params) => {
      let provider = params.provider;
      let model = params.model;
      let userMemory = params.userMemory;
      let llxprtMdFileCount = params.llxprtMdFileCount ?? 0;
      const ephemerals: Record<string, unknown> = {};
      const settingsServiceInstance = new actual.SettingsService();

      return {
        getProvider: vi.fn(() => provider),
        setProvider: vi.fn((next: string) => {
          provider = next;
        }),
        getProviderManager: vi.fn(),
        setProviderManager: vi.fn(),
        initialize: vi.fn(),
        getModel: vi.fn(() => model),
        setModel: vi.fn((next: string) => {
          model = next;
        }),
        setEphemeralSetting: vi.fn((key: string, value: unknown) => {
          if (value === undefined) {
            delete ephemerals[key];
          } else {
            ephemerals[key] = value;
          }
        }),
        getEphemeralSetting: vi.fn((key: string) => ephemerals[key]),
        getEphemeralSettings: vi.fn(() => ({ ...ephemerals })),
        getSettingsService: vi.fn(() => settingsServiceInstance),
        getConversationLoggingEnabled: vi.fn(() => false),
        getDebugMode: vi.fn(() => false),
        getToolRegistry: vi.fn(() => ({})),
        getSandboxMountDir: vi.fn(() => ''),
        getMemoryImportFormat: vi.fn(() => 'tree'),
        getFolderTrust: vi.fn(() => true),
        getIdeMode: vi.fn(() => false),
        getFileDiscoveryService: vi.fn(
          () => params.fileDiscoveryService ?? { initialize: vi.fn() },
        ),
        refreshAuth: vi.fn(async () => {}),
        setUserMemory: vi.fn((next: string) => {
          userMemory = next;
        }),
        getUserMemory: vi.fn(() => userMemory),
        setLlxprtMdFileCount: vi.fn((next: number) => {
          llxprtMdFileCount = next;
        }),
        getLlxprtMdFileCount: vi.fn(() => llxprtMdFileCount),
      };
    }),
  };
});

const createMockSettingsService = () => {
  const providerStore = new Map<string, Record<string, unknown>>();
  const globalStore = new Map<string, unknown>();
  return {
    setProviderSetting(provider: string, key: string, value: unknown) {
      const entry = providerStore.get(provider) ?? {};
      if (value === undefined) {
        delete entry[key];
      } else {
        entry[key] = value;
      }
      providerStore.set(provider, entry);
    },
    async updateSettings(
      provider: string,
      updates: Record<string, unknown>,
    ): Promise<void> {
      const entry = providerStore.get(provider) ?? {};
      Object.assign(entry, updates);
      providerStore.set(provider, entry);
    },
    async switchProvider(): Promise<void> {
      // no-op
    },
    set(key: string, value: unknown) {
      if (value === undefined) {
        globalStore.delete(key);
      } else {
        globalStore.set(key, value);
      }
    },
    get(key: string) {
      return globalStore.get(key);
    },
  };
};

const createRuntimeState = () => ({
  runtime: {
    runtimeId: 'cli.runtime.test',
    metadata: {},
    settingsService: createMockSettingsService(),
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
  },
  oauthManager: null,
});

const runtimeStateRef = {
  value: createRuntimeState(),
};

const resetRuntimeState = () => {
  runtimeStateRef.value = createRuntimeState();
};

const runtimeConfigRef = {
  value: null as unknown,
};

vi.mock('./profileBootstrap.js', () => ({
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

vi.mock('../runtime/runtimeSettings.js', () => {
  const applyProfileSnapshot = vi.fn(async () => ({
    providerName: 'openai',
    modelName: 'hf:zai-org/GLM-4.6',
    infoMessages: [],
    warnings: [],
    providerChanged: false,
    authType: undefined,
    didFallback: false,
    requestedProvider: 'openai',
  }));
  const getCliRuntimeContext = vi.fn(() => runtimeStateRef.value.runtime);
  const setCliRuntimeContext = vi.fn((_service, config) => {
    runtimeConfigRef.value = config;
  });
  const switchActiveProvider = vi.fn(async () => ({
    changed: false,
    previousProvider: null,
    nextProvider: 'openai',
    infoMessages: [],
    authType: undefined,
  }));
  const applyCliArgumentOverrides = vi.fn(async () => {});
  const registerCliProviderInfrastructure = vi.fn();
  const getCliRuntimeServices = vi.fn(() => ({
    runtime: runtimeStateRef.value.runtime,
    providerManager: runtimeStateRef.value.providerManager,
    config: runtimeConfigRef.value,
    settingsService: runtimeStateRef.value.runtime.settingsService,
  }));
  return {
    applyProfileSnapshot,
    getCliRuntimeContext,
    setCliRuntimeContext,
    switchActiveProvider,
    applyCliArgumentOverrides,
    registerCliProviderInfrastructure,
    getCliRuntimeServices,
    getCliProviderManager: vi.fn(() => runtimeStateRef.value.providerManager),
    getCliRuntimeConfig: vi.fn(() => runtimeConfigRef.value),
    getActiveProviderStatus: vi.fn(() => ({ name: 'openai', isReady: true })),
    listProviders: vi.fn(() => ['openai']),
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
    resetSettingsService();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('loads context files from include directories even when loadMemoryFromIncludeDirectories is disabled', async () => {
    const contextFileName = 'AGENTS.md';
    const contextContent = '# Guidance\nAlways follow agent instructions.';
    const includedContextPath = path.join(includeDir, contextFileName);
    await fs.writeFile(includedContextPath, contextContent, 'utf-8');

    const settings = {
      includeDirectories: [] as string[],
      loadMemoryFromIncludeDirectories: false,
      folderTrust: false,
      telemetry: { enabled: false },
      accessibility: { screenReader: false, disableLoadingPhrases: false },
      ui: {
        contextFileName,
        memoryDiscoveryMaxDirs: 200,
      },
    } as unknown as Settings;

    const argv: CliArgs = {
      model: undefined,
      sandbox: undefined,
      sandboxImage: undefined,
      debug: false,
      prompt: undefined,
      promptInteractive: undefined,
      outputFormat: undefined,
      allFiles: false,
      showMemoryUsage: false,
      yolo: false,
      approvalMode: undefined,
      telemetry: undefined,
      telemetryTarget: undefined,
      telemetryOtlpEndpoint: undefined,
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
    };

    const { ExtensionEnablementManager, ExtensionStorage } =
      await import('./extension.js');
    const config = await loadCliConfig(
      settings,
      [],
      new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir()),
      'test-session',
      argv,
      workspaceDir,
    );

    expect(config.getUserMemory()).toContain(contextContent);
    expect(config.getLlxprtMdFileCount()).toBeGreaterThan(0);
  });
});
