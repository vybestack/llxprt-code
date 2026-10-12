import type { AdmittedModelParameters } from './admittedModelParameters.js';
import { SessionSettingsOwner } from '../session/session-settings-owner.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { assembleTaskSchemaPolicy } from '../config/task-schema-policy-assembly.js';

import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentRuntimeState } from './AgentRuntimeState.js';
import {
  createProviderRuntimeContext,
  type ProviderRuntimeContext,
} from './providerRuntimeContext.js';
import { loadAgentRuntime } from './AgentRuntimeLoader.js';
import type {
  AgentRuntimeProviderAdapter,
  AgentRuntimeTelemetryAdapter,
  ToolRegistryView,
  ReadonlySettingsSnapshot,
} from './AgentRuntimeContext.js';

import type { AgentRuntimeState } from './AgentRuntimeState.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { Config } from '../config/config.js';
import { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/tools.js';
import type {
  ContentGenerator,
  ContentGeneratorConfig,
} from '../core/contentGenerator.js';
import type { RuntimeContentGeneratorFactory } from './contracts/RuntimeContentGeneratorFactory.js';
import type { RuntimeProviderManager } from './contracts/RuntimeProviderManager.js';
import type { IContent } from '../services/history/IContent.js';
import { LocalMediaStore } from '../storage/local-media-store.js';
import { MediaAdmissionService } from '../storage/media-admission-service.js';

function createTestConfig(): Config {
  return new Config({
    sessionId: 'test-session',
    targetDir: '/tmp/test-agent-runtime-loader',
    cwd: process.cwd(),
    model: 'gemini-2.0-pro',
    debugMode: false,
  });
}

function createRuntimeState(): AgentRuntimeState {
  return createAgentRuntimeState({
    runtimeId: 'runtime-loader',
    provider: 'gemini',
    model: 'gemini-2.0-pro',
    sessionId: 'test-session',
  });
}

function createContentGeneratorConfig(): ContentGeneratorConfig {
  return {
    model: 'gemini-2.0-pro',
    apiKey: 'test-key',
  };
}

function createStubGenerator(label: string): ContentGenerator {
  return {
    generateContent: vi.fn(async () => ({
      label,
      candidates: [],
      content: { speaker: 'ai' as const, blocks: [] },
    })),
    generateContentStream: vi.fn(async () =>
      (async function* () {
        yield { content: { speaker: 'ai' as const, blocks: [] }, label };
      })(),
    ),
    countTokens: vi.fn(async () => ({ totalTokens: 0 })),
    embedContent: vi.fn(async () => ({
      embeddings: [],
    })),
  };
}

describe('AgentRuntimeLoader', () => {
  let config: Config;
  let policyOwner: RuntimePolicyOwner;
  afterEach(() => policyOwner.dispose());
  let runtimeState: AgentRuntimeState;
  let settingsSnapshot: ReadonlySettingsSnapshot;
  // Issue #2616: a runtime context requires explicit settings, so the
  // declaration is unassigned until beforeEach constructs one.
  let providerRuntime: ProviderRuntimeContext;
  let settingsOwner: SessionSettingsOwner;
  afterEach(() => settingsOwner.dispose());

  const telemetryAdapter: AgentRuntimeTelemetryAdapter = {
    logApiRequest: vi.fn(),
    logApiResponse: vi.fn(),
    logApiError: vi.fn(),
  };
  const providerAdapter: AgentRuntimeProviderAdapter = {
    getActiveProvider: vi.fn(() => ({
      name: 'gemini',
      getModels: async () => [],
      async *generateChatCompletion() {},
    })),
    setActiveProvider: vi.fn(),
  };
  const toolsView: ToolRegistryView = {
    listToolNames: vi.fn(() => ['test-tool']),
    getToolMetadata: vi.fn(() => ({
      name: 'test-tool',
      description: 'Test tool metadata',
    })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    config = createTestConfig();
    policyOwner = new RuntimePolicyOwner(config);
    runtimeState = createRuntimeState();
    settingsSnapshot = {
      compressionThreshold: 0.42,
      contextLimit: 10_000,
      preserveThreshold: 0.15,
      toolFormatOverride: 'json_schema',
      tools: {
        allowed: undefined,
        disabled: undefined,
      },
    };
    const settingsService = new SettingsService();
    settingsOwner = new SessionSettingsOwner(settingsService);
    settingsOwner.bindTelemetry(config);
    providerRuntime = createProviderRuntimeContext({
      settingsService,
      metadata: { source: 'AgentRuntimeLoader.test' },
    });
  });

  it('uses each supplied owner store for media saves and reads, including after the other closes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'runtime-loader-owners-'));
    const first = new LocalMediaStore({
      rootDirectory: join(directory, 'first'),
      quotaBytes: 1024,
    });
    const second = new LocalMediaStore({
      rootDirectory: join(directory, 'second'),
      quotaBytes: 1024,
    });
    try {
      const profile = {
        config,
        telemetry: settingsOwner.telemetry,
        state: runtimeState,
        settings: settingsSnapshot,
        providerRuntime,
        prepareProviderInvocation: (
          provider: string,
          parameters?: AdmittedModelParameters,
          signal?: AbortSignal,
        ) =>
          settingsOwner.prepareProviderInvocation(
            runtimeState.runtimeId,
            provider,
            parameters,
            signal,
          ),
        readToolGovernance: () =>
          settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
      };
      const overrides = {
        providerAdapter,
        telemetryAdapter,
        toolsView,
        contentGenerator: createStubGenerator('owner-media'),
      };
      const firstRuntime = await loadAgentRuntime({
        profile,
        mediaStore: first,
        overrides,
      });
      const secondRuntime = await loadAgentRuntime({
        profile,
        mediaStore: second,
        overrides,
      });

      const firstStore = firstRuntime.runtimeContext.mediaStore;
      const secondStore = secondRuntime.runtimeContext.mediaStore;
      if (firstStore === undefined || secondStore === undefined) {
        throw new Error('Runtime media stores must be available');
      }
      const firstBytes = new Uint8Array([1, 2, 3]);
      const secondBytes = new Uint8Array([4, 5, 6]);
      const firstReference = await firstStore.admit({
        bytes: firstBytes,
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      const secondReference = await secondStore.admit({
        bytes: secondBytes,
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      expect(await first.readVerified(firstReference)).toStrictEqual(
        firstBytes,
      );
      expect(await second.readVerified(secondReference)).toStrictEqual(
        secondBytes,
      );
      await expect(first.readVerified(secondReference)).rejects.toThrow(
        'Media store read verified failed',
      );

      await first.close();
      expect(await secondStore.readVerified(secondReference)).toStrictEqual(
        secondBytes,
      );
    } finally {
      await first.close();
      await second.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('creates isolated runtime bundle per invocation', async () => {
    const generatorFactoryA = vi.fn(async () =>
      createStubGenerator('bundle-A'),
    );
    const generatorFactoryB = vi.fn(async () =>
      createStubGenerator('bundle-B'),
    );

    const baseOptions = {
      mediaStore: new LocalMediaStore({
        rootDirectory: config.projectTempDir + '/media',
        quotaBytes: config.getMediaStoreQuotaByteLimit(),
      }),
      profile: {
        config,
        telemetry: settingsOwner.telemetry,
        state: runtimeState,
        settings: settingsSnapshot,
        providerRuntime,
        prepareProviderInvocation: (
          provider: string,
          parameters?: AdmittedModelParameters,
          signal?: AbortSignal,
        ) =>
          settingsOwner.prepareProviderInvocation(
            runtimeState.runtimeId,
            provider,
            parameters,
            signal,
          ),
        readToolGovernance: () =>
          settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
        contentGeneratorConfig: createContentGeneratorConfig(),
      },
      overrides: {
        providerAdapter,
        telemetryAdapter,
        toolsView,
      },
    } as const;

    const bundleA = await loadAgentRuntime({
      ...baseOptions,
      overrides: {
        ...baseOptions.overrides,
        contentGeneratorFactory: generatorFactoryA,
      },
    });
    const bundleB = await loadAgentRuntime({
      ...baseOptions,
      overrides: {
        ...baseOptions.overrides,
        contentGeneratorFactory: generatorFactoryB,
      },
    });

    expect(generatorFactoryA).toHaveBeenCalledTimes(1);
    expect(generatorFactoryB).toHaveBeenCalledTimes(1);

    expect(bundleA.runtimeContext).not.toBe(bundleB.runtimeContext);
    expect(bundleA.runtimeContext.history).not.toBe(
      bundleB.runtimeContext.history,
    );
    expect(bundleA.runtimeContext.history).toBeInstanceOf(HistoryService);
    expect(bundleA.runtimeContext.provider).toBe(providerAdapter);
    expect(bundleA.runtimeContext.telemetry).toBe(telemetryAdapter);
    expect(bundleA.runtimeContext.tools).toBe(toolsView);

    expect(bundleA.contentGenerator).not.toBe(bundleB.contentGenerator);
  });

  it('reuses provided history service when supplied', async () => {
    const sharedHistory = new HistoryService();
    const bundle = await loadAgentRuntime({
      mediaStore: new LocalMediaStore({
        rootDirectory: config.projectTempDir + '/media',
        quotaBytes: config.getMediaStoreQuotaByteLimit(),
      }),
      profile: {
        config,
        telemetry: settingsOwner.telemetry,
        state: runtimeState,
        settings: settingsSnapshot,
        providerRuntime,
        prepareProviderInvocation: (
          provider: string,
          parameters?: AdmittedModelParameters,
          signal?: AbortSignal,
        ) =>
          settingsOwner.prepareProviderInvocation(
            runtimeState.runtimeId,
            provider,
            parameters,
            signal,
          ),
        readToolGovernance: () =>
          settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
        contentGeneratorConfig: createContentGeneratorConfig(),
      },
      overrides: {
        providerAdapter,
        telemetryAdapter,
        toolsView,
        historyService: sharedHistory,
        contentGenerator: createStubGenerator('shared'),
      },
    });

    expect(bundle.runtimeContext.history).toBe(sharedHistory);
    expect(bundle.history).toBe(sharedHistory);
    expect(bundle.contentGenerator.generateContent).toBeDefined();
  });

  it('idempotently establishes canonical ownership for media already present in provided history', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'runtime-loader-media-'));
    const store = new LocalMediaStore({
      rootDirectory: join(directory, 'media'),
      quotaBytes: 1024 * 1024,
    });
    const admission = new MediaAdmissionService(store);
    const admissionContext = {
      turnId: 'initial-history',
      source: 'runtime-loader-test',
      reservationOwnerScope: 'runtime-loader-test',
    };
    const inlineHistory: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/png',
            encoding: 'base64',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
          },
        ],
      },
    ];

    try {
      const admittedHistory = await admission.admitContents(
        inlineHistory,
        admissionContext,
      );
      const block = admittedHistory[0].blocks[0];
      if (block.type !== 'media' || block.encoding !== 'reference') {
        throw new Error('Expected admitted media reference');
      }
      const sharedHistory = new HistoryService();
      sharedHistory.addAll(admittedHistory);

      const runtimeOptions = {
        mediaStore: store,
        profile: {
          config,
          telemetry: settingsOwner.telemetry,
          state: runtimeState,
          settings: settingsSnapshot,
          providerRuntime,
          prepareProviderInvocation: (
            provider: string,
            parameters?: AdmittedModelParameters,
            signal?: AbortSignal,
          ) =>
            settingsOwner.prepareProviderInvocation(
              runtimeState.runtimeId,
              provider,
              parameters,
              signal,
            ),
          readToolGovernance: () =>
            settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
          contentGeneratorConfig: createContentGeneratorConfig(),
        },
        overrides: {
          providerAdapter,
          telemetryAdapter,
          toolsView,
          historyService: sharedHistory,
          contentGenerator: createStubGenerator('media-owner'),
        },
      };
      await loadAgentRuntime(runtimeOptions);
      await loadAgentRuntime(runtimeOptions);
      await admission.releaseContents(admittedHistory, admissionContext);
      expect(await store.hasReservations(block.contentId)).toBe(true);

      sharedHistory.clear();
      await sharedHistory.waitForOwnershipSettlement();
      expect(await store.hasReservations(block.contentId)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves provided settings and applies snapshot to ephemerals', async () => {
    const mutableSettings: ReadonlySettingsSnapshot = {
      compressionThreshold: 0.33,
      contextLimit: 5_000,
      preserveThreshold: 0.25,
    };

    const bundle = await loadAgentRuntime({
      mediaStore: new LocalMediaStore({
        rootDirectory: config.projectTempDir + '/media',
        quotaBytes: config.getMediaStoreQuotaByteLimit(),
      }),
      profile: {
        config,
        telemetry: settingsOwner.telemetry,
        state: runtimeState,
        settings: mutableSettings,
        providerRuntime,
        prepareProviderInvocation: (
          provider: string,
          parameters?: AdmittedModelParameters,
          signal?: AbortSignal,
        ) =>
          settingsOwner.prepareProviderInvocation(
            runtimeState.runtimeId,
            provider,
            parameters,
            signal,
          ),
        readToolGovernance: () =>
          settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
        contentGeneratorConfig: createContentGeneratorConfig(),
      },
      overrides: {
        providerAdapter,
        telemetryAdapter,
        toolsView,
        contentGenerator: createStubGenerator('settings'),
      },
    });

    expect(bundle.runtimeContext.ephemerals.compressionThreshold()).toBe(0.33);
    expect(bundle.runtimeContext.ephemerals.contextLimit()).toBe(5_000);
    expect(bundle.runtimeContext.ephemerals.preserveThreshold()).toBe(0.25);
    expect(mutableSettings).toStrictEqual({
      compressionThreshold: 0.33,
      contextLimit: 5_000,
      preserveThreshold: 0.25,
    });
  });

  it('filters tool registry view using live allowed/disabled settings policy', async () => {
    settingsOwner.setAllowedTools(['alpha']);
    settingsOwner.writeUserParameter('tools.disabled', ['beta']);
    const registry = new ToolRegistry(
      config,
      policyOwner.session.messageBus,
      assembleTaskSchemaPolicy(new SettingsService()),
    );
    registry.registerTool(
      new MockTool('alpha', 'alpha', 'Alpha tool for testing.'),
    );
    registry.registerTool(
      new MockTool('beta', 'beta', 'Beta tool for testing.'),
    );

    const bundle = await loadAgentRuntime({
      mediaStore: new LocalMediaStore({
        rootDirectory: config.projectTempDir + '/media',
        quotaBytes: config.getMediaStoreQuotaByteLimit(),
      }),
      profile: {
        config,
        telemetry: settingsOwner.telemetry,
        state: runtimeState,
        settings: {
          ...settingsSnapshot,
          tools: {
            allowed: ['alpha'],
            disabled: ['beta'],
          },
        },
        providerRuntime,
        prepareProviderInvocation: (
          provider: string,
          parameters?: AdmittedModelParameters,
          signal?: AbortSignal,
        ) =>
          settingsOwner.prepareProviderInvocation(
            runtimeState.runtimeId,
            provider,
            parameters,
            signal,
          ),
        readToolGovernance: () =>
          settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
        toolRegistry: registry,
        contentGeneratorConfig: createContentGeneratorConfig(),
      },
      overrides: {
        providerAdapter,
        telemetryAdapter,
        contentGenerator: createStubGenerator('tools-filter'),
      },
    });

    expect(bundle.toolsView.listToolNames()).toStrictEqual(['alpha']);
    expect(bundle.toolsView.getToolMetadata('alpha')).toMatchObject({
      name: 'alpha',
      description: 'Alpha tool for testing.',
    });
    expect(bundle.toolsView.getToolMetadata('beta')).toBeUndefined();
  });

  it('uses the explicitly prepared content generator factory with the supplied profile', async () => {
    const factoryGenerator: ContentGenerator = {
      generateContent: vi.fn(async () => ({
        candidates: [],
        content: { speaker: 'ai' as const, blocks: [] },
      })),
      generateContentStream: vi.fn(async () =>
        (async function* () {
          yield {
            candidates: [],
            content: { speaker: 'ai' as const, blocks: [] },
          };
        })(),
      ),
      countTokens: vi.fn(async () => ({ totalTokens: 0 })),
      embedContent: vi.fn(async () => ({ embeddings: [] })),
    };

    const factory: RuntimeContentGeneratorFactory<ContentGenerator> = {
      createContentGenerator: vi.fn(() => factoryGenerator),
    };

    const configWithFactory = new Config({
      sessionId: 'test-session',
      targetDir: '/tmp/test-agent-runtime-loader',
      cwd: process.cwd(),
      model: 'gemini-2.0-pro',
      debugMode: false,
    });

    const contentConfigWithManager: ContentGeneratorConfig = {
      contentGeneratorFactory: factory,
      model: 'gemini-2.0-pro',
    };

    const bundle = await loadAgentRuntime({
      mediaStore: new LocalMediaStore({
        rootDirectory: config.projectTempDir + '/media',
        quotaBytes: config.getMediaStoreQuotaByteLimit(),
      }),
      profile: {
        config: configWithFactory,
        telemetry: settingsOwner.telemetry,
        state: runtimeState,
        settings: settingsSnapshot,
        providerRuntime,
        prepareProviderInvocation: (
          provider: string,
          parameters?: AdmittedModelParameters,
          signal?: AbortSignal,
        ) =>
          settingsOwner.prepareProviderInvocation(
            runtimeState.runtimeId,
            provider,
            parameters,
            signal,
          ),
        readToolGovernance: () =>
          settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
        contentGeneratorConfig: contentConfigWithManager,
      },
      overrides: {
        providerAdapter,
        telemetryAdapter,
        toolsView,
      },
    });

    expect(bundle.contentGenerator).toBe(factoryGenerator);
    expect(
      await bundle.contentGenerator.countTokens({ contents: [] }),
    ).toStrictEqual({ totalTokens: 0 });
  });

  it('throws when providerManager is absent', async () => {
    await expect(
      loadAgentRuntime({
        mediaStore: new LocalMediaStore({
          rootDirectory: config.projectTempDir + '/media',
          quotaBytes: config.getMediaStoreQuotaByteLimit(),
        }),
        profile: {
          config,
          telemetry: settingsOwner.telemetry,
          state: runtimeState,
          settings: settingsSnapshot,
          providerRuntime,
          prepareProviderInvocation: (
            provider: string,
            parameters?: AdmittedModelParameters,
            signal?: AbortSignal,
          ) =>
            settingsOwner.prepareProviderInvocation(
              runtimeState.runtimeId,
              provider,
              parameters,
              signal,
            ),
          readToolGovernance: () =>
            settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
          contentGeneratorConfig: createContentGeneratorConfig(),
        },
        overrides: {
          providerAdapter,
          telemetryAdapter,
          toolsView,
        },
      }),
    ).rejects.toThrow(
      'No provider runtime is composed for this Config. Compose the providers package (see packages/providers/src/composition) before creating a content generator.',
    );
  });

  it('throws when providerManager is present but contentGeneratorFactory is missing and Config has no factory', async () => {
    const fakeManager: RuntimeProviderManager = {
      getActiveProvider: vi.fn(),
      getActiveProviderName: vi.fn(),
      setActiveProvider: vi.fn(),
      setRuntimeContext: vi.fn(),
      getAvailableModels: vi.fn(async () => []),
      getProviderNames: () => [],
      listProviders: () => [],
      getProviderByName: vi.fn(),
      registerProvider: vi.fn(),
      checkpointProviderRegistry: () => () => {},
      prepareStatelessProviderInvocation: vi.fn(),
      getProviderMetrics: () => ({}),
      getSessionTokenUsage: () => ({
        input: 0,
        output: 0,
        cache: 0,
        tool: 0,
        thought: 0,
        total: 0,
      }),
      setConfig: vi.fn(),
      hasActiveProvider: () => true,
      accumulateSessionTokens: vi.fn(),
    };

    const configNoFactory = new Config({
      sessionId: 'test-session',
      targetDir: '/tmp/test-agent-runtime-loader',
      cwd: process.cwd(),
      model: 'gemini-2.0-pro',
      debugMode: false,
    });

    const contentConfigWithManagerOnly: ContentGeneratorConfig = {
      model: 'gemini-2.0-pro',
    };

    await expect(
      loadAgentRuntime({
        mediaStore: new LocalMediaStore({
          rootDirectory: config.projectTempDir + '/media',
          quotaBytes: config.getMediaStoreQuotaByteLimit(),
        }),
        profile: {
          config: configNoFactory,
          telemetry: settingsOwner.telemetry,
          state: runtimeState,
          settings: settingsSnapshot,
          providerRuntime,
          prepareProviderInvocation: (
            provider: string,
            parameters?: AdmittedModelParameters,
            signal?: AbortSignal,
          ) =>
            settingsOwner.prepareProviderInvocation(
              runtimeState.runtimeId,
              provider,
              parameters,
              signal,
            ),
          readToolGovernance: () =>
            settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
          providerManager: fakeManager,
          contentGeneratorConfig: contentConfigWithManagerOnly,
        },
        overrides: {
          providerAdapter,
          telemetryAdapter,
          toolsView,
        },
      }),
    ).rejects.toThrow(
      'No provider runtime is composed for this Config. Compose the providers package (see packages/providers/src/composition) before creating a content generator.',
    );
  });
});
