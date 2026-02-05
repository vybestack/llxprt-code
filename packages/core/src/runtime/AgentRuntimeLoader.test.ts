/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAgentRuntimeState } from './AgentRuntimeState.js';
import {
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  clearActiveProviderRuntimeContext,
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
import { SettingsService } from '../settings/SettingsService.js';
import { Config } from '../config/config.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { MockTool } from '../test-utils/tools.js';
import type {
  ContentGenerator,
  ContentGeneratorConfig,
} from '../core/contentGenerator.js';

function createTestConfig(): Config {
  const settingsService = new SettingsService();
  const runtime = createProviderRuntimeContext({ settingsService });
  setActiveProviderRuntimeContext(runtime);

  return new Config({
    sessionId: 'test-session',
    targetDir: '/tmp/test-agent-runtime-loader',
    settingsService,
  } as unknown as import('../config/config.js').ConfigParameters);
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
    })),
    generateContentStream: vi.fn(async function* () {
      yield { label };
    }),
    countTokens: vi.fn(async () => ({ totalTokens: 0 })),
    embedContent: vi.fn(async () => ({
      embeddings: [],
    })),
  };
}

describe('AgentRuntimeLoader', () => {
  let config: Config;
  let runtimeState: AgentRuntimeState;
  let settingsSnapshot: ReadonlySettingsSnapshot;
  let providerRuntime = createProviderRuntimeContext();

  const telemetryAdapter: AgentRuntimeTelemetryAdapter = {
    logApiRequest: vi.fn(),
    logApiResponse: vi.fn(),
    logApiError: vi.fn(),
  };
  const providerAdapter: AgentRuntimeProviderAdapter = {
    getActiveProvider: vi.fn(() => ({ name: 'gemini' })),
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
    providerRuntime = createProviderRuntimeContext({
      settingsService: new SettingsService(),
      metadata: { source: 'AgentRuntimeLoader.test' },
    });
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  it('creates isolated runtime bundle per invocation', async () => {
    const generatorFactoryA = vi.fn(async () =>
      createStubGenerator('bundle-A'),
    );
    const generatorFactoryB = vi.fn(async () =>
      createStubGenerator('bundle-B'),
    );

    const baseOptions = {
      profile: {
        config,
        state: runtimeState,
        settings: settingsSnapshot,
        providerRuntime,
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
      profile: {
        config,
        state: runtimeState,
        settings: settingsSnapshot,
        providerRuntime,
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

  it('preserves provided settings and applies snapshot to ephemerals', async () => {
    const mutableSettings: ReadonlySettingsSnapshot = {
      compressionThreshold: 0.33,
      contextLimit: 5_000,
      preserveThreshold: 0.25,
    };

    const bundle = await loadAgentRuntime({
      profile: {
        config,
        state: runtimeState,
        settings: mutableSettings,
        providerRuntime,
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
    expect(mutableSettings).toEqual({
      compressionThreshold: 0.33,
      contextLimit: 5_000,
      preserveThreshold: 0.25,
    });
  });

  it('filters tool registry view using allowed/disabled lists from settings snapshot', async () => {
    const registry = new ToolRegistry(config);
    registry.registerTool(
      new MockTool('alpha', 'alpha', 'Alpha tool for testing.'),
    );
    registry.registerTool(
      new MockTool('beta', 'beta', 'Beta tool for testing.'),
    );

    const bundle = await loadAgentRuntime({
      profile: {
        config,
        state: runtimeState,
        settings: {
          ...settingsSnapshot,
          tools: {
            allowed: ['alpha'],
            disabled: ['beta'],
          },
        },
        providerRuntime,
        toolRegistry: registry,
        contentGeneratorConfig: createContentGeneratorConfig(),
      },
      overrides: {
        providerAdapter,
        telemetryAdapter,
        contentGenerator: createStubGenerator('tools-filter'),
      },
    });

    expect(bundle.toolsView.listToolNames()).toEqual(['alpha']);
    expect(bundle.toolsView.getToolMetadata('alpha')).toMatchObject({
      name: 'alpha',
      description: 'Alpha tool for testing.',
    });
    expect(bundle.toolsView.getToolMetadata('beta')).toBeUndefined();
  });
});
