import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createSubagentScope } from './helpers/create-subagent-scope.js';
import {
  createStatelessRuntimeBundle as createRunnableRuntimeBundle,
  scopeInputs,
} from './subagent-test-helpers.js';
import type { SubagentTestInputs } from './subagent-test-helpers.js';
import { emptyInstructionReads } from '@vybestack/llxprt-code-test-utils/core/instructions.js';
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

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { SubAgentScope } from '../subagent.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  createProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import * as RuntimeLoader from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import type {
  AgentRuntimeContext,
  AgentRuntimeProviderAdapter,
  AgentRuntimeTelemetryAdapter,
  ToolRegistryView,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { ContextState } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type {
  PromptConfig,
  ModelConfig,
  RunConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';

class StatelessConfig extends Config {
  setModel(): never {
    throw new Error('Forbidden foreground model mutation');
  }
  setProvider(): never {
    throw new Error('Forbidden foreground provider mutation');
  }
  getToolRegistry(): never {
    throw new Error('Forbidden Config tool discovery');
  }
  getEphemeralSetting(): never {
    throw new Error('Forbidden Config settings discovery');
  }
  getEphemeralSettings(): never {
    throw new Error('Forbidden Config settings discovery');
  }
}
/**
 * Test helper: Create minimal Config for testing
 */
function createTestConfig(overrides?: {
  model?: string;
  provider?: string;
}): StatelessConfig {
  const config = new StatelessConfig({
    sessionId: 'test-session-id',
    targetDir: '/tmp/test-dir',
    cwd: '/tmp/test-dir',
    debugMode: false,
    model: overrides?.model ?? 'gemini-2.0-flash',
    provider: overrides?.provider,
  });

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
}): ReturnType<typeof createRunnableRuntimeBundle> {
  const fixture = createRunnableRuntimeBundle({
    providerAdapter: options?.providerAdapter,
    telemetryAdapter: options?.telemetryAdapter,
    toolsView: options?.toolsView,
    history: options?.historyService,
    toolRegistry: options?.toolRegistry,
  });
  return {
    ...fixture,
    runtimeContext: Object.freeze({
      ...fixture.runtimeContext,
      state: Object.freeze({
        ...fixture.runtimeContext.state,
        model: options?.model ?? 'gemini-2.0-flash-thinking-exp',
      }),
    }),
  };
}

type EnvironmentLoader = (
  runtime: AgentRuntimeContext,
) => Promise<Array<{ text?: string }>>;

const DEFAULT_ENVIRONMENT_CONTEXT: Array<{ text?: string }> = [
  { text: 'Env Context' },
];

const createEnvironmentLoader = (): EnvironmentLoader =>
  vi.fn(async () => DEFAULT_ENVIRONMENT_CONTEXT);

function createRuntimeOverrides(
  options: {
    runtimeBundle?: ReturnType<typeof createRunnableRuntimeBundle>;
    environmentLoader?: EnvironmentLoader;
    toolRegistry?: ToolRegistry;
  } = {},
): {
  overrides: SubagentTestInputs;
  runtimeBundle: ReturnType<typeof createRunnableRuntimeBundle>;
  environmentLoader: EnvironmentLoader;
} {
  const runtimeBundle =
    options.runtimeBundle ??
    createStatelessRuntimeBundle({ toolRegistry: options.toolRegistry });
  const environmentLoader =
    options.environmentLoader ?? createEnvironmentLoader();

  const overrides: SubagentTestInputs = {
    instructions: emptyInstructionReads,
    workspacePaths: {
      resolve: (path) => path,
      directories: () => [],
      contains: () => true,
      validate: () => null,
    },
    readMcpInstructions: () => undefined,
    runtimeBundle,
    environmentContextLoader: environmentLoader,
  };

  if (options.toolRegistry != null) {
    overrides.toolRegistry = options.toolRegistry;
  }

  return { overrides, runtimeBundle, environmentLoader };
}

describe('SubAgentScope - Stateless Behavior (P07 TDD)', () => {
  let foregroundConfig: StatelessConfig;

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

      await createSubagentScope(
        {
          name: 'test-subagent',
          prompt: promptConfig,
          model: modelConfig,
          run: runConfig,
          toolConfig: undefined,
          outputConfig: undefined,
        },
        ...scopeInputs(foregroundConfig, overrides),
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

      await createSubagentScope(
        {
          name: 'test-subagent',
          prompt: promptConfig,
          model: modelConfig,
          run: runConfig,
          toolConfig: undefined,
          outputConfig: undefined,
        },
        ...scopeInputs(foregroundConfig, providerOverrides),
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

      await createSubagentScope(
        {
          name: 'test-subagent',
          prompt: promptConfig,
          model: modelConfig,
          run: runConfig,
          toolConfig: undefined,
          outputConfig: undefined,
        },
        ...scopeInputs(foregroundConfig, mutatorOverrides),
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

    await createSubagentScope(
      {
        name: 'test-subagent',
        prompt: promptConfig,
        model: modelConfig,
        run: runConfig,
        toolConfig: undefined,
        outputConfig: undefined,
      },
      ...scopeInputs(foregroundConfig, overrides),
    );

    expect(loaderSpy).not.toHaveBeenCalled();
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
      const result = await createSubagentScope(
        {
          name: 'test-subagent',
          prompt: promptConfig,
          model: modelConfig,
          run: runConfig,
          toolConfig: undefined,
          outputConfig: undefined,
        },
        ...scopeInputs(foregroundConfig, overrides),
      );

      // Verify that SubAgentScope was created successfully (setModel was NOT called)
      expect(result).toBeDefined();
      expect(result).toBeInstanceOf(SubAgentScope);
    });
  });

  describe('Config Independence', () => {
    it('should not read from foreground Config during runtime context construction', async () => {
      foregroundConfig = createTestConfig({ model: 'gemini-2.0-flash-exp' });

      const regressionError = new Error(
        'REGRESSION: SubAgentScope accessed foreground Config',
      );

      Object.defineProperty(foregroundConfig, 'getProviderManager', {
        value: () => {
          throw regressionError;
        },
      });
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

      const providerRuntime = createProviderRuntimeContext({
        runtimeId: 'override-runtime',
      });

      const providerAdapter: AgentRuntimeProviderAdapter = {
        getActiveProvider: () => ({
          name: 'gemini',
          getModels: async () => [],
          getDefaultModel: () => modelConfig.model,
          generateChatCompletion: vi.fn(
            async function* (): AsyncGenerator<IContent> {
              yield { speaker: 'ai', blocks: [] };
            },
          ),
        }),
        setActiveProvider: vi.fn(),
        getProviderKeys: () => {
          throw new Error('Fixture has no key storage');
        },
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
        createSubagentScope(
          {
            name: 'stateless-subagent',
            prompt: promptConfig,
            model: modelConfig,
            run: runConfig,
            toolConfig: undefined,
            outputConfig: undefined,
          },
          ...scopeInputs(foregroundConfig, overrides),
        ),
      ).resolves.toBeInstanceOf(SubAgentScope);
    });
  });
  describe('behavior through ChildAgentScope execution', () => {
    interface RecordedRun {
      readonly scope: Awaited<ReturnType<typeof createSubagentScope>>;
      readonly history: HistoryService;
      readonly requests: RuntimeGenerateChatOptions[];
      readonly runtimeContext: AgentRuntimeContext;
      readonly run: () => Promise<void>;
    }

    const WORKSPACE_PATHS = {
      resolve: (filePath: string) => filePath,
      directories: () => [],
      contains: () => true,
      validate: () => null,
    };

    function systemInstructionOf(request: RuntimeGenerateChatOptions): string {
      const instruction = request.systemInstruction;
      if (typeof instruction !== 'string')
        throw new Error('Expected a string system instruction');
      return instruction;
    }

    async function createRecordedRun(options: {
      readonly name: string;
      readonly foreground: Config;
      readonly provider: string;
      readonly runtimeModel: string;
      readonly sessionId: string;
      readonly reply: string;
      readonly prompt: string;
      readonly environmentText: string;
      readonly generationParameters?: { temperature: number; topP: number };
    }): Promise<RecordedRun> {
      const requests: RuntimeGenerateChatOptions[] = [];
      const providerAdapter: AgentRuntimeProviderAdapter = {
        getActiveProvider: () => ({
          name: options.provider,
          getDefaultModel: () => options.runtimeModel,
          getModels: async () => [],
          generateChatCompletion(
            request: RuntimeGenerateChatOptions | AsyncIterable<IContent>,
          ) {
            if (!('contents' in request))
              throw new Error('Expected options-form generation');
            requests.push(request);
            return (async function* () {
              yield {
                speaker: 'ai',
                blocks: [{ type: 'text', text: options.reply }],
              };
            })();
          },
        }),
        setActiveProvider: vi.fn(),
        getProviderKeys: () => {
          throw new Error('Test provider adapter has no key storage');
        },
      };
      const history = new HistoryService();
      const fixture = createRunnableRuntimeBundle({ history, providerAdapter });
      const runtimeContext: AgentRuntimeContext = Object.freeze({
        ...fixture.runtimeContext,
        state: Object.freeze({
          ...fixture.runtimeContext.state,
          provider: options.provider,
          model: options.runtimeModel,
          sessionId: options.sessionId,
        }),
      });
      const runtimeBundle: ReturnType<typeof createRunnableRuntimeBundle> = {
        ...fixture,
        runtimeContext,
      };
      const [runtime, operations] = scopeInputs(options.foreground, {
        instructions: emptyInstructionReads,
        workspacePaths: WORKSPACE_PATHS,
        readMcpInstructions: () => undefined,
        runtimeBundle,
        environmentContextLoader: async () => [
          { text: options.environmentText },
        ],
        admitModelParameters: () => ({
          providerName: options.provider,
          modelParams: options.generationParameters ?? {},
        }),
      });
      const scope = await createSubagentScope(
        {
          name: options.name,
          prompt: createTestPromptConfig(),
          model: createTestModelConfig(options.runtimeModel),
          run: createTestRunConfig(),
          toolConfig: undefined,
          outputConfig: undefined,
        },
        runtime,
        operations,
      );
      const context = new ContextState();
      context.set('task_behaviour_prompts', [options.prompt]);
      return {
        scope,
        history,
        requests,
        runtimeContext,
        run: () => scope.runNonInteractive(context),
      };
    }

    async function historyTexts(history: HistoryService): Promise<string[]> {
      const texts: string[] = [];
      for await (const row of history.streamRawHistory())
        texts.push(
          row.blocks
            .map((block) => (block.type === 'text' ? block.text : ''))
            .join(''),
        );
      return texts;
    }

    it('uses the supplied runtime model at the content-generation boundary', async () => {
      foregroundConfig = createTestConfig({ model: 'foreground-model' });
      const setModelSpy = vi.spyOn(foregroundConfig, 'setModel');

      const recorded = await createRecordedRun({
        name: 'model-subagent',
        foreground: foregroundConfig,
        provider: 'recording-provider',
        runtimeModel: 'subagent-runtime-model',
        sessionId: 'model-session',
        reply: 'MODEL-REPLY',
        prompt: 'MODEL-PROMPT',
        environmentText: 'MODEL-ENV',
      });
      await recorded.run();

      expect(recorded.requests).toHaveLength(1);
      expect(systemInstructionOf(recorded.requests[0])).toContain(
        'with subagent-runtime-model via recording-provider',
      );
      expect(systemInstructionOf(recorded.requests[0])).not.toContain(
        'foreground-model',
      );
      const reply = (
        await Array.fromAsync(recorded.history.streamRawHistory())
      ).find((entry) => entry.speaker === 'ai');
      expect(reply?.metadata?.model).toBe('subagent-runtime-model');
      expect(foregroundConfig.getModel()).toBe('foreground-model');
      expect(setModelSpy).not.toHaveBeenCalled();
    });

    it('sends the supplied runtime state, not the foreground config, to the provider', async () => {
      foregroundConfig = createTestConfig({
        model: 'foreground-model',
        provider: 'foreground-provider',
      });
      const setModelSpy = vi.spyOn(foregroundConfig, 'setModel');
      const setProviderSpy = vi.spyOn(foregroundConfig, 'setProvider');

      const recorded = await createRecordedRun({
        name: 'state-subagent',
        foreground: foregroundConfig,
        provider: 'runtime-provider',
        runtimeModel: 'runtime-model',
        sessionId: 'runtime-state-session',
        reply: 'STATE-REPLY',
        prompt: 'STATE-PROMPT',
        environmentText: 'STATE-ENV-FROM-LOADER',
        generationParameters: { temperature: 0.31, topP: 0.41 },
      });
      await recorded.run();

      expect(recorded.requests).toHaveLength(1);
      const [request] = recorded.requests;
      expect(request.metadata?.__logicalRequestId).toMatch(
        /^runtime-state-session#state-subagent-/,
      );
      expect(request.modelParameters?.providerName).toBe('runtime-provider');
      expect(request.modelParameters?.modelParams).toStrictEqual({
        temperature: 0.31,
        topP: 0.41,
      });
      expect(
        systemInstructionOf(request).startsWith('STATE-ENV-FROM-LOADER'),
      ).toBe(true);
      expect(systemInstructionOf(request)).toContain(
        'with runtime-model via runtime-provider',
      );
      expect(systemInstructionOf(request)).not.toContain('foreground-');
      expect(await historyTexts(recorded.history)).toContain('STATE-PROMPT');
      expect(setModelSpy).not.toHaveBeenCalled();
      expect(setProviderSpy).not.toHaveBeenCalled();
      expect(foregroundConfig.getModel()).toBe('foreground-model');
      expect(foregroundConfig.getProvider()).toBe('foreground-provider');
    });

    it('writes each run only to its own supplied history while a second scope is live', async () => {
      foregroundConfig = createTestConfig({ model: 'foreground-model' });

      const first = await createRecordedRun({
        name: 'subagent-a',
        foreground: foregroundConfig,
        provider: 'recording-provider',
        runtimeModel: 'model-a',
        sessionId: 'session-a',
        reply: 'REPLY-FROM-A',
        prompt: 'PROMPT-FOR-A',
        environmentText: 'ENV-A',
      });
      const second = await createRecordedRun({
        name: 'subagent-b',
        foreground: foregroundConfig,
        provider: 'recording-provider',
        runtimeModel: 'model-b',
        sessionId: 'session-b',
        reply: 'REPLY-FROM-B',
        prompt: 'PROMPT-FOR-B',
        environmentText: 'ENV-B',
      });
      expect(first.history).not.toBe(second.history);

      await first.run();
      const afterFirst = await historyTexts(first.history);
      expect(afterFirst).toStrictEqual(['PROMPT-FOR-A', 'REPLY-FROM-A']);
      expect(await historyTexts(second.history)).toStrictEqual([]);

      await second.run();
      expect(await historyTexts(second.history)).toStrictEqual([
        'PROMPT-FOR-B',
        'REPLY-FROM-B',
      ]);
      expect(await historyTexts(first.history)).toStrictEqual(afterFirst);
    });

    it('leaves the supplied runtime context and state frozen and unchanged after a run', async () => {
      foregroundConfig = createTestConfig({ model: 'foreground-model' });
      const recorded = await createRecordedRun({
        name: 'frozen-subagent',
        foreground: foregroundConfig,
        provider: 'recording-provider',
        runtimeModel: 'frozen-model',
        sessionId: 'frozen-session',
        reply: 'FROZEN-REPLY',
        prompt: 'FROZEN-PROMPT',
        environmentText: 'FROZEN-ENV',
      });
      const stateBefore = { ...recorded.runtimeContext.state };

      await recorded.run();

      expect(Object.isFrozen(recorded.runtimeContext)).toBe(true);
      expect(Object.isFrozen(recorded.runtimeContext.state)).toBe(true);
      expect({ ...recorded.runtimeContext.state }).toStrictEqual(stateBefore);
      expect(recorded.runtimeContext.state.model).toBe('frozen-model');
      expect(recorded.runtimeContext.state.provider).toBe('recording-provider');
    });
  });
});
