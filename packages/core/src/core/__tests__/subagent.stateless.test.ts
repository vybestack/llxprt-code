/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251028-STATELESS6.P07
 * @requirement REQ-STAT6-001.1, REQ-STAT6-001.3, REQ-STAT6-003.1, REQ-STAT6-003.2
 * @pseudocode agent-runtime-context.md lines 92-101
 *
 * TDD tests for SubAgentScope stateless behavior (RED phase).
 * These tests verify that SubAgentScope:
 * 1. Does NOT mutate foreground Config (REQ-STAT6-003.1)
 * 2. Uses AgentRuntimeContext instead of Config (REQ-STAT6-001.1)
 * 3. Receives frozen AgentRuntimeContext (REQ-STAT6-001.3)
 * 4. Gets isolated HistoryService per instance (REQ-STAT6-003.2)
 *
 * Expected outcome: These tests FAIL against current implementation (line 609)
 * because SubAgentScope still calls config.setModel() and doesn't use
 * AgentRuntimeContext yet.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubAgentScope } from '../subagent.js';
import { Config } from '../../config/config.js';
import { SettingsService } from '../../settings/SettingsService.js';
import {
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '../../runtime/providerRuntimeContext.js';
import * as RuntimeLoader from '../../runtime/AgentRuntimeLoader.js';
import type { AgentRuntimeLoaderResult } from '../../runtime/AgentRuntimeLoader.js';
import type {
  AgentRuntimeContext,
  AgentRuntimeProviderAdapter,
  AgentRuntimeTelemetryAdapter,
  ToolRegistryView,
} from '../../runtime/AgentRuntimeContext.js';
import type {
  PromptConfig,
  ModelConfig,
  RunConfig,
  SubAgentRuntimeOverrides,
} from '../subagent.js';
import type { ToolRegistry } from '../../tools/tool-registry.js';
import type { ContentGenerator } from '../contentGenerator.js';
import type { Part } from '@google/genai';
import type { IProvider } from '../../providers/IProvider.js';
import type { HistoryService } from '../../services/history/HistoryService.js';

/**
 * Test helper: Create minimal Config for testing
 */
function createTestConfig(overrides?: {
  model?: string;
  provider?: string;
}): Config {
  const settingsService = new SettingsService();
  setActiveProviderRuntimeContext(
    createProviderRuntimeContext({ settingsService }),
  );

  const config = new Config({
    sessionId: 'test-session-id',
    targetDir: '/tmp/test-dir',
    settingsService,
  } as unknown as import('../../config/config.js').ConfigParameters);

  // Set initial values if provided
  if (overrides?.model) {
    config.setModel(overrides.model);
  }
  if (overrides?.provider) {
    config.setProvider(overrides.provider);
  }

  return config;
}

/**
 * Test helper: Create test PromptConfig
 */
function createTestPromptConfig(): PromptConfig {
  return {
    systemPrompt: 'You are a helpful test assistant.',
  };
}

/**
 * Test helper: Create test ModelConfig
 */
function createTestModelConfig(
  model = 'gemini-2.0-flash-thinking-exp',
): ModelConfig {
  return {
    model,
    temp: 0.7,
    top_p: 0.9,
  };
}

/**
 * Test helper: Create test RunConfig
 */
function createTestRunConfig(): RunConfig {
  return {
    max_time_minutes: 5,
    max_turns: 10,
  };
}

function createStatelessRuntimeBundle(options?: {
  model?: string;
  providerAdapter?: AgentRuntimeProviderAdapter;
  telemetryAdapter?: AgentRuntimeTelemetryAdapter;
  toolsView?: ToolRegistryView;
  historyService?: HistoryService;
  providerRuntime?: ProviderRuntimeContext;
  toolRegistry?: ToolRegistry;
}): AgentRuntimeLoaderResult {
  const providerAdapter =
    options?.providerAdapter ??
    ({
      getActiveProvider: vi.fn(
        () =>
          ({
            name: 'gemini',
            generateChatCompletion: vi.fn(async function* () {
              yield { speaker: 'ai', blocks: [] };
            }),
            getDefaultModel: () =>
              options?.model ?? 'gemini-2.0-flash-thinking-exp',
            getServerTools: () => [],
            invokeServerTool: vi.fn(),
          }) as IProvider,
      ),
      setActiveProvider: vi.fn(),
    } as AgentRuntimeProviderAdapter);

  const telemetryAdapter =
    options?.telemetryAdapter ??
    ({
      logApiRequest: vi.fn(),
      logApiResponse: vi.fn(),
      logApiError: vi.fn(),
    } as AgentRuntimeTelemetryAdapter);

  const toolsView =
    options?.toolsView ??
    ({
      listToolNames: vi.fn(() => []),
      getToolMetadata: vi.fn(() => undefined),
    } as ToolRegistryView);

  const history =
    options?.historyService ??
    ({
      clear: vi.fn(),
      add: vi.fn(),
      getCuratedForProvider: vi.fn(() => []),
      getIdGeneratorCallback: vi.fn(() => vi.fn()),
      findUnmatchedToolCalls: vi.fn(() => []),
    } as unknown as HistoryService);

  const providerRuntime =
    options?.providerRuntime ??
    ({
      runtimeId: 'runtime-bundle',
      metadata: {},
      settingsService: {
        get: vi.fn(),
        set: vi.fn(),
      },
    } as unknown as ProviderRuntimeContext);

  const toolRegistry =
    options?.toolRegistry ??
    ({
      getTool: vi.fn(),
      getFunctionDeclarationsFiltered: vi.fn(() => []),
      getAllTools: vi.fn(() => []),
    } as unknown as ToolRegistry);

  const runtimeState = Object.freeze({
    runtimeId: 'runtime-bundle',
    provider: 'gemini',
    model: options?.model ?? 'gemini-2.0-flash-thinking-exp',
    sessionId: 'runtime-session',
    proxyUrl: undefined,
    modelParams: {
      temperature: 0.7,
      topP: 0.9,
    },
  });

  const runtimeContext: AgentRuntimeContext = Object.freeze({
    state: runtimeState,
    history,
    ephemerals: {
      compressionThreshold: () => 0.8,
      contextLimit: () => 60_000,
      preserveThreshold: () => 0.2,
      toolFormatOverride: () => undefined,
    },
    telemetry: telemetryAdapter,
    provider: providerAdapter,
    tools: toolsView,
    providerRuntime,
  });

  return {
    runtimeContext,
    history,
    providerAdapter,
    telemetryAdapter,
    toolsView,
    contentGenerator: {
      generateContent: vi.fn(),
      generateContentStream: vi.fn(),
      countTokens: vi.fn(),
    } as unknown as ContentGenerator,
    toolRegistry,
  };
}

type EnvironmentLoader = (runtime: AgentRuntimeContext) => Promise<Part[]>;

const DEFAULT_ENVIRONMENT_CONTEXT: Part[] = [{ text: 'Env Context' }];

const createEnvironmentLoader = (): EnvironmentLoader =>
  vi.fn(async () => DEFAULT_ENVIRONMENT_CONTEXT);

function createRuntimeOverrides(
  options: {
    runtimeBundle?: AgentRuntimeLoaderResult;
    environmentLoader?: EnvironmentLoader;
    toolRegistry?: ToolRegistry;
  } = {},
): {
  overrides: SubAgentRuntimeOverrides;
  runtimeBundle: AgentRuntimeLoaderResult;
  environmentLoader: EnvironmentLoader;
} {
  const runtimeBundle =
    options.runtimeBundle ??
    createStatelessRuntimeBundle({ toolRegistry: options.toolRegistry });
  const environmentLoader =
    options.environmentLoader ?? createEnvironmentLoader();

  const overrides: SubAgentRuntimeOverrides = {
    runtimeBundle,
    environmentContextLoader: environmentLoader,
  };

  if (options.toolRegistry) {
    overrides.toolRegistry = options.toolRegistry;
  }

  return { overrides, runtimeBundle, environmentLoader };
}

describe('SubAgentScope - Stateless Behavior (P07 TDD)', () => {
  let foregroundConfig: Config;

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
  });

  /**
   * @plan PLAN-20251028-STATELESS6.P07
   * @requirement REQ-STAT6-003.1, REQ-STAT6-001.1
   * @pseudocode agent-runtime-context.md line 100
   *
   * CRITICAL TEST: Verify SubAgentScope does NOT call config.setModel()
   * This test SHOULD FAIL because current code has setModel() at line 609
   */
  describe('Config Mutation Prevention', () => {
    it('should NOT call config.setModel() when creating subagent', async () => {
      // @plan PLAN-20251028-STATELESS6.P07
      // @requirement REQ-STAT6-003.1

      // GIVEN foreground config with specific model
      foregroundConfig = createTestConfig({ model: 'gemini-2.0-flash-exp' });
      const originalModel = foregroundConfig.getModel();

      // Spy on setModel to detect mutation attempts
      const setModelSpy = vi.spyOn(foregroundConfig, 'setModel');

      // WHEN subagent created with different model
      const promptConfig = createTestPromptConfig();
      const modelConfig = createTestModelConfig(
        'gemini-2.0-flash-thinking-exp',
      );
      const runConfig = createTestRunConfig();

      const { overrides } = createRuntimeOverrides();

      await SubAgentScope.create(
        'test-subagent',
        foregroundConfig,
        promptConfig,
        modelConfig,
        runConfig,
        undefined,
        undefined,
        overrides,
      );

      // THEN Config.setModel() should NEVER be called
      expect(setModelSpy).not.toHaveBeenCalled();

      // AND foreground model should remain unchanged
      expect(foregroundConfig.getModel()).toBe(originalModel);
      expect(foregroundConfig.getModel()).toBe('gemini-2.0-flash-exp');
    });

    it('should NOT call config.setProvider() when creating subagent', async () => {
      // @plan PLAN-20251028-STATELESS6.P07
      // @requirement REQ-STAT6-003.1

      // GIVEN foreground config with specific provider
      foregroundConfig = createTestConfig({
        model: 'gemini-2.0-flash-exp',
        provider: 'gemini',
      });
      const originalProvider = foregroundConfig.getProvider();

      // Spy on setProvider to detect mutation attempts
      const setProviderSpy = vi.spyOn(foregroundConfig, 'setProvider');

      // WHEN subagent created
      const promptConfig = createTestPromptConfig();
      const modelConfig = createTestModelConfig(
        'gemini-2.0-flash-thinking-exp',
      );
      const runConfig = createTestRunConfig();

      const { overrides: providerOverrides } = createRuntimeOverrides();

      await SubAgentScope.create(
        'test-subagent',
        foregroundConfig,
        promptConfig,
        modelConfig,
        runConfig,
        undefined,
        undefined,
        providerOverrides,
      );

      // THEN Config.setProvider() should NEVER be called
      expect(setProviderSpy).not.toHaveBeenCalled();

      // AND foreground provider should remain unchanged
      expect(foregroundConfig.getProvider()).toBe(originalProvider);
    });

    it('should NOT call any Config mutator methods', async () => {
      // @plan PLAN-20251028-STATELESS6.P07
      // @requirement REQ-STAT6-003.1

      foregroundConfig = createTestConfig({ model: 'gemini-2.0-flash-exp' });

      // Spy on ALL Config mutators
      const setModelSpy = vi.spyOn(foregroundConfig, 'setModel');
      const setProviderSpy = vi.spyOn(foregroundConfig, 'setProvider');

      const promptConfig = createTestPromptConfig();
      const modelConfig = createTestModelConfig(
        'gemini-2.0-flash-thinking-exp',
      );
      const runConfig = createTestRunConfig();

      const { overrides: mutatorOverrides } = createRuntimeOverrides();

      await SubAgentScope.create(
        'test-subagent',
        foregroundConfig,
        promptConfig,
        modelConfig,
        runConfig,
        undefined,
        undefined,
        mutatorOverrides,
      );

      // ZERO Config mutations allowed
      expect(setModelSpy).not.toHaveBeenCalled();
      expect(setProviderSpy).not.toHaveBeenCalled();
    });
  });

  it('does not invoke AgentRuntimeLoader when runtime bundle supplied', async () => {
    foregroundConfig = createTestConfig({ model: 'gemini-2.0-flash-exp' });
    const loaderSpy = vi.spyOn(RuntimeLoader, 'loadAgentRuntime');

    const promptConfig = createTestPromptConfig();
    const modelConfig = createTestModelConfig('gemini-2.0-flash-thinking-exp');
    const runConfig = createTestRunConfig();
    const { overrides } = createRuntimeOverrides();

    await SubAgentScope.create(
      'test-subagent',
      foregroundConfig,
      promptConfig,
      modelConfig,
      runConfig,
      undefined,
      undefined,
      overrides,
    );

    expect(loaderSpy).not.toHaveBeenCalled();
  });

  /**
   * @plan PLAN-20251028-STATELESS6.P07
   * @requirement REQ-STAT6-001.3
   * @pseudocode agent-runtime-context.md line 80
   *
   * Test: AgentRuntimeContext passed to SubAgentScope is frozen
   * This test SHOULD FAIL because SubAgentScope doesn't use AgentRuntimeContext yet
   */
  describe('Runtime View Immutability', () => {
    it('should receive frozen AgentRuntimeContext', async () => {
      // @plan PLAN-20251028-STATELESS6.P07
      // @requirement REQ-STAT6-001.3

      foregroundConfig = createTestConfig({ model: 'gemini-2.0-flash-exp' });

      const promptConfig = createTestPromptConfig();
      const modelConfig = createTestModelConfig(
        'gemini-2.0-flash-thinking-exp',
      );
      const runConfig = createTestRunConfig();

      const { overrides } = createRuntimeOverrides();

      const scope = await SubAgentScope.create(
        'test-subagent',
        foregroundConfig,
        promptConfig,
        modelConfig,
        runConfig,
        undefined,
        undefined,
        overrides,
      );

      // WHEN SubAgentScope is created
      // THEN it should have a frozen AgentRuntimeContext
      // Note: This will fail because current implementation uses Config, not AgentRuntimeContext
      const runtimeContext = (
        scope as unknown as { runtimeContext: AgentRuntimeContext }
      ).runtimeContext;

      expect(runtimeContext).toBeDefined();
      expect(Object.isFrozen(runtimeContext)).toBe(true);
    });

    it('should have frozen runtime state within context', async () => {
      // @plan PLAN-20251028-STATELESS6.P07
      // @requirement REQ-STAT6-001.3

      foregroundConfig = createTestConfig({ model: 'gemini-2.0-flash-exp' });

      const promptConfig = createTestPromptConfig();
      const modelConfig = createTestModelConfig(
        'gemini-2.0-flash-thinking-exp',
      );
      const runConfig = createTestRunConfig();

      const { overrides: frozenOverrides } = createRuntimeOverrides();

      const scope = await SubAgentScope.create(
        'test-subagent',
        foregroundConfig,
        promptConfig,
        modelConfig,
        runConfig,
        undefined,
        undefined,
        frozenOverrides,
      );

      // Access internal runtimeContext (will fail with current Config-based implementation)
      const runtimeContext = (
        scope as unknown as { runtimeContext: AgentRuntimeContext }
      ).runtimeContext;

      expect(runtimeContext.state).toBeDefined();
      expect(Object.isFrozen(runtimeContext.state)).toBe(true);
    });
  });

  /**
   * @plan PLAN-20251028-STATELESS6.P07
   * @requirement REQ-STAT6-003.2
   * @pseudocode agent-runtime-context.md line 96
   *
   * Test: Each SubAgentScope gets unique HistoryService instance
   * This test SHOULD FAIL because current implementation may share history
   */
  describe('History Service Isolation', () => {
    it('should allocate isolated history services for each subagent', async () => {
      // @plan PLAN-20251028-STATELESS6.P07
      // @requirement REQ-STAT6-003.2

      foregroundConfig = createTestConfig({ model: 'gemini-2.0-flash-exp' });

      const promptConfig = createTestPromptConfig();
      const modelConfig1 = createTestModelConfig(
        'gemini-2.0-flash-thinking-exp',
      );
      const modelConfig2 = createTestModelConfig('gemini-2.0-flash-exp');
      const runConfig = createTestRunConfig();

      // Create two subagent scopes
      const { overrides: overridesA } = createRuntimeOverrides();
      const scopeA = await SubAgentScope.create(
        'subagent-a',
        foregroundConfig,
        promptConfig,
        modelConfig1,
        runConfig,
        undefined,
        undefined,
        overridesA,
      );

      const { overrides: overridesB } = createRuntimeOverrides();
      const scopeB = await SubAgentScope.create(
        'subagent-b',
        foregroundConfig,
        promptConfig,
        modelConfig2,
        runConfig,
        undefined,
        undefined,
        overridesB,
      );

      // Access runtime contexts (will fail with current Config-based implementation)
      const contextA = (
        scopeA as unknown as { runtimeContext: AgentRuntimeContext }
      ).runtimeContext;
      const contextB = (
        scopeB as unknown as { runtimeContext: AgentRuntimeContext }
      ).runtimeContext;

      // History instances must be different references
      expect(contextA.history).toBeDefined();
      expect(contextB.history).toBeDefined();
      expect(contextA.history).not.toBe(contextB.history);
    });

    it('should maintain isolated history between subagents', async () => {
      // @plan PLAN-20251028-STATELESS6.P07
      // @requirement REQ-STAT6-003.2

      foregroundConfig = createTestConfig({ model: 'gemini-2.0-flash-exp' });

      const promptConfig = createTestPromptConfig();
      const modelConfig = createTestModelConfig(
        'gemini-2.0-flash-thinking-exp',
      );
      const runConfig = createTestRunConfig();

      // Create two subagent scopes
      const { overrides: histOverridesA } = createRuntimeOverrides();
      const scopeA = await SubAgentScope.create(
        'subagent-a',
        foregroundConfig,
        promptConfig,
        modelConfig,
        runConfig,
        undefined,
        undefined,
        histOverridesA,
      );

      const { overrides: histOverridesB } = createRuntimeOverrides();
      const scopeB = await SubAgentScope.create(
        'subagent-b',
        foregroundConfig,
        promptConfig,
        modelConfig,
        runConfig,
        undefined,
        undefined,
        histOverridesB,
      );

      // Access runtime contexts
      const contextA = (
        scopeA as unknown as { runtimeContext: AgentRuntimeContext }
      ).runtimeContext;
      const contextB = (
        scopeB as unknown as { runtimeContext: AgentRuntimeContext }
      ).runtimeContext;

      // Verify histories are isolated (mutations don't cross boundaries)
      // Note: This test structure assumes HistoryService has methods we can verify
      // The actual implementation will depend on HistoryService interface
      expect(contextA.history).not.toBe(contextB.history);
    });
  });

  /**
   * @plan PLAN-20251028-STATELESS6.P07
   * @requirement REQ-STAT6-001.1
   * @pseudocode agent-runtime-context.md lines 92-98
   *
   * Test: SubAgentScope constructs isolated runtime state
   * This test SHOULD FAIL because current implementation mutates Config instead
   */
  describe('Runtime State Construction', () => {
    it('should construct isolated runtime context with subagent model', async () => {
      // @plan PLAN-20251028-STATELESS6.P07
      // @requirement REQ-STAT6-001.1

      foregroundConfig = createTestConfig({ model: 'gemini-2.0-flash-exp' });

      const promptConfig = createTestPromptConfig();
      const modelConfig = createTestModelConfig(
        'gemini-2.0-flash-thinking-exp',
      );
      const runConfig = createTestRunConfig();

      const { overrides } = createRuntimeOverrides({
        runtimeBundle: createStatelessRuntimeBundle({
          model: modelConfig.model,
        }),
      });

      const scope = await SubAgentScope.create(
        'test-subagent',
        foregroundConfig,
        promptConfig,
        modelConfig,
        runConfig,
        undefined,
        undefined,
        overrides,
      );

      // Access runtime context (will fail with current Config-based implementation)
      const runtimeContext = (
        scope as unknown as { runtimeContext: AgentRuntimeContext }
      ).runtimeContext;

      // Runtime context should have subagent model, NOT foreground model
      expect(runtimeContext.state.model).toBe('gemini-2.0-flash-thinking-exp');

      // Foreground config should be unchanged
      expect(foregroundConfig.getModel()).toBe('gemini-2.0-flash-exp');
    });

    it('should build runtime context directly without mutating foreground config', async () => {
      // @plan PLAN-20251028-STATELESS6.P07
      // @requirement REQ-STAT6-001.1

      foregroundConfig = createTestConfig({ model: 'gemini-2.0-flash-exp' });
      const originalModel = foregroundConfig.getModel();

      // Create spy to detect any config access during runtime context creation
      const setModelSpy = vi.spyOn(foregroundConfig, 'setModel');

      const promptConfig = createTestPromptConfig();
      const modelConfig = createTestModelConfig(
        'gemini-2.0-flash-thinking-exp',
      );
      const runConfig = createTestRunConfig();

      const { overrides: runtimeOverrides } = createRuntimeOverrides({
        runtimeBundle: createStatelessRuntimeBundle({
          model: modelConfig.model,
        }),
      });

      const scope = await SubAgentScope.create(
        'test-subagent',
        foregroundConfig,
        promptConfig,
        modelConfig,
        runConfig,
        undefined,
        undefined,
        runtimeOverrides,
      );

      // Access runtime context
      const runtimeContext = (
        scope as unknown as { runtimeContext: AgentRuntimeContext }
      ).runtimeContext;

      // Verify runtime context was built directly (not via Config mutation)
      expect(setModelSpy).not.toHaveBeenCalled();
      expect(foregroundConfig.getModel()).toBe(originalModel);
      expect(runtimeContext.state.model).toBe('gemini-2.0-flash-thinking-exp');
    });
  });

  /**
   * @plan PLAN-20251028-STATELESS6.P07
   * @requirement REQ-STAT6-003.1
   *
   * Regression guard: Throw if legacy setModel path is invoked
   * This test ensures that if code regresses and calls setModel, we catch it
   */
  describe('Regression Guards', () => {
    it('should throw if legacy setModel is invoked (regression guard)', async () => {
      // @plan PLAN-20251028-STATELESS6.P07
      // @requirement REQ-STAT6-003.1

      foregroundConfig = createTestConfig({ model: 'gemini-2.0-flash-exp' });

      // Inject spy that throws to simulate code regression detection
      vi.spyOn(foregroundConfig, 'setModel').mockImplementation(() => {
        throw new Error(
          'REGRESSION: Config.setModel() called in subagent path',
        );
      });

      const promptConfig = createTestPromptConfig();
      const modelConfig = createTestModelConfig(
        'gemini-2.0-flash-thinking-exp',
      );
      const runConfig = createTestRunConfig();

      // Should NOT throw because setModel should never be called
      // If this throws, it means the code is still using the legacy path
      // After P08: setModel is no longer called, so the mock never throws
      const { overrides } = createRuntimeOverrides();
      const result = await SubAgentScope.create(
        'test-subagent',
        foregroundConfig,
        promptConfig,
        modelConfig,
        runConfig,
        undefined,
        undefined,
        overrides,
      );

      // Verify that SubAgentScope was created successfully (setModel was NOT called)
      expect(result).toBeDefined();
      expect(result).toBeInstanceOf(SubAgentScope);
    });
  });

  describe('Config Independence', () => {
    it('throws if runtime bundle is omitted (enforces stateless runtime)', async () => {
      foregroundConfig = createTestConfig({ model: 'gemini-2.0-flash-exp' });

      const promptConfig = createTestPromptConfig();
      const modelConfig = createTestModelConfig(
        'gemini-2.0-flash-thinking-exp',
      );
      const runConfig = createTestRunConfig();

      await expect(
        SubAgentScope.create(
          'stateless-subagent',
          foregroundConfig,
          promptConfig,
          modelConfig,
          runConfig,
        ),
      ).rejects.toThrow('runtime bundle');
    });

    it('should not read from foreground Config during runtime context construction', async () => {
      foregroundConfig = createTestConfig({ model: 'gemini-2.0-flash-exp' });

      const regressionError = new Error(
        'REGRESSION: SubAgentScope accessed foreground Config',
      );

      vi.spyOn(foregroundConfig, 'getProviderManager').mockImplementation(
        () => {
          throw regressionError;
        },
      );
      vi.spyOn(foregroundConfig, 'getToolRegistry').mockImplementation(() => {
        throw regressionError;
      });
      vi.spyOn(foregroundConfig, 'getEphemeralSetting').mockImplementation(
        () => {
          throw regressionError;
        },
      );
      vi.spyOn(foregroundConfig, 'getEphemeralSettings').mockImplementation(
        () => {
          throw regressionError;
        },
      );
      vi.spyOn(
        foregroundConfig,
        'getContentGeneratorConfig',
      ).mockImplementation(() => {
        throw regressionError;
      });
      vi.spyOn(foregroundConfig, 'getSessionId').mockImplementation(() => {
        throw regressionError;
      });
      vi.spyOn(foregroundConfig, 'getProvider').mockImplementation(() => {
        throw regressionError;
      });

      const promptConfig = createTestPromptConfig();
      const modelConfig = createTestModelConfig(
        'gemini-2.0-flash-thinking-exp',
      );
      const runConfig = createTestRunConfig();

      const settingsService = new SettingsService();
      const providerRuntime = createProviderRuntimeContext({
        settingsService,
        runtimeId: 'override-runtime',
      });

      const providerAdapter: AgentRuntimeProviderAdapter = {
        getActiveProvider: () =>
          ({
            name: 'gemini',
            getDefaultModel: () => modelConfig.model,
            generateChatCompletion: vi.fn(async function* () {
              yield { speaker: 'ai', blocks: [] };
            }),
            getServerTools: () => [],
            invokeServerTool: vi.fn(),
          }) as IProvider,
        setActiveProvider: vi.fn(),
      };

      const telemetryAdapter: AgentRuntimeTelemetryAdapter = {
        logApiRequest: vi.fn(),
        logApiResponse: vi.fn(),
        logApiError: vi.fn(),
      };

      const toolsView: ToolRegistryView = {
        listToolNames: () => [],
        getToolMetadata: () => undefined,
      };

      const runtimeBundle = createStatelessRuntimeBundle({
        model: modelConfig.model,
        providerAdapter,
        telemetryAdapter,
        toolsView,
        providerRuntime,
      });

      const { overrides } = createRuntimeOverrides({ runtimeBundle });

      await expect(
        SubAgentScope.create(
          'stateless-subagent',
          foregroundConfig,
          promptConfig,
          modelConfig,
          runConfig,
          undefined,
          undefined,
          overrides,
        ),
      ).resolves.toBeInstanceOf(SubAgentScope);
    });
  });
});
