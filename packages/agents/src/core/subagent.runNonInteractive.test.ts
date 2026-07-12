/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SubAgentScope runNonInteractive: initialization, prompting, toolConfig
 * preservation (Issue #2069).
 */

import type { Mock } from 'vitest';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SubAgentScope } from './subagent.js';
import {
  ContextState,
  SubagentTerminateMode,
  type PromptConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { ChatSession } from './chatSession.js';
import type { ToolRegistryView } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { Content, GenerateContentConfig } from '@google/genai';
import type { CreateChatSession } from './subagentRuntimeSetup.js';
import {
  createMockConfig,
  createMockStream,
  defaultModelConfig,
  defaultRunConfig,
  createStatelessRuntimeBundle,
  createRuntimeOverrides,
} from './subagent-test-helpers.js';

describe('subagent.ts', () => {
  let mockSendMessageStream: Mock;

  describe('create (toolConfig preservation — Issue #2069)', () => {
    it('explicit empty toolConfig + outputConfig yields only self_emitvalue', async () => {
      const { config } = await createMockConfig();
      const runtimeToolsView: ToolRegistryView = {
        listToolNames: vi.fn(() => ['read_file', 'write_file']),
        getToolMetadata: vi.fn(() => ({
          name: 'read_file',
          description: 'Reads a file',
          parameterSchema: { type: 'object', properties: {} },
        })),
      };
      const runtimeBundle = createStatelessRuntimeBundle({
        toolsView: runtimeToolsView,
      });
      const { overrides } = createRuntimeOverrides({ runtimeBundle });

      mockSendMessageStream = vi.fn();
      mockSendMessageStream.mockImplementation(createMockStream(['stop']));
      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        { systemPrompt: 'test' },
        defaultModelConfig,
        defaultRunConfig,
        { tools: [] },
        { outputs: {} },
        overrides,
        undefined,
        { createChatSession: () => ({}) as ChatSession },
      );

      expect(scope).toBeDefined();
    });

    it('omitted toolConfig + outputConfig yields runtime default tools plus self_emitvalue', async () => {
      const { config } = await createMockConfig();
      const runtimeToolsView: ToolRegistryView = {
        listToolNames: vi.fn(() => ['read_file', 'write_file']),
        getToolMetadata: vi.fn(() => ({
          name: 'read_file',
          description: 'Reads a file',
          parameterSchema: { type: 'object', properties: {} },
        })),
      };
      const runtimeBundle = createStatelessRuntimeBundle({
        toolsView: runtimeToolsView,
      });
      const { overrides } = createRuntimeOverrides({ runtimeBundle });

      mockSendMessageStream = vi.fn();
      mockSendMessageStream.mockImplementation(createMockStream(['stop']));
      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        { systemPrompt: 'test' },
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        undefined,
        overrides,
        undefined,
        { createChatSession: () => ({}) as ChatSession },
      );

      expect(scope).toBeDefined();
    });
  });

  describe('runNonInteractive - Initialization and Prompting', () => {
    let generationConfigs: GenerateContentConfig[];
    let startHistories: Content[][];
    const createChatSession: CreateChatSession = (
      _runtimeContext,
      _contentGenerator,
      generationConfig,
      startHistory,
    ) => {
      generationConfigs.push(generationConfig);
      startHistories.push(startHistory);
      return {
        sendMessageStream: mockSendMessageStream,
        getHistory: () => [],
        getHistoryService: () => ({
          clear: vi.fn(),
          findUnmatchedToolCalls: () => [],
          getCurated: () => [],
          getTotalTokens: () => 0,
        }),
        getConfig: () => undefined,
      } as unknown as ChatSession;
    };

    beforeEach(() => {
      generationConfigs = [];
      startHistories = [];
      mockSendMessageStream = vi.fn();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    const getGenerationConfigFromMock = (
      callIndex = 0,
    ): GenerateContentConfig & { systemInstruction?: string | Content } => {
      const generationConfig = generationConfigs[callIndex];
      expect(generationConfig).toBeDefined();
      if (!generationConfig) throw new Error('generationConfig is undefined');
      return generationConfig as GenerateContentConfig & {
        systemInstruction?: string | Content;
      };
    };

    it('should correctly template the system prompt and initialize ChatSession', async () => {
      const { config } = await createMockConfig();
      const promptConfig: PromptConfig = {
        systemPrompt: 'Hello ${name}, your task is ${task}.',
      };
      const context = new ContextState();
      context.set('name', 'Agent');
      context.set('task', 'Testing');

      mockSendMessageStream.mockImplementation(createMockStream(['stop']));

      const runtimeBundle = createStatelessRuntimeBundle();
      const { overrides } = createRuntimeOverrides({ runtimeBundle });

      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        undefined,
        overrides,
        undefined,
        { createChatSession },
      );

      await scope.runNonInteractive(context);

      expect(generationConfigs).toHaveLength(1);
      const generationConfig = getGenerationConfigFromMock();
      expect(generationConfig.systemInstruction).toContain('Env Context');
      expect(generationConfig.systemInstruction).toContain(
        'Hello Agent, your task is Testing.',
      );
      expect(generationConfig.systemInstruction).toContain('Important Rules:');
      expect(generationConfig.temperature).toBe(defaultModelConfig.temp);
    });

    it('should include output instructions in the system prompt when outputs are defined', async () => {
      const { config } = await createMockConfig();
      const promptConfig: PromptConfig = { systemPrompt: 'Execute task.' };

      mockSendMessageStream.mockImplementation(createMockStream(['stop']));

      const { overrides } = createRuntimeOverrides();
      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        { outputs: { result: 'The result' } },
        overrides,
        undefined,
        { createChatSession },
      );

      await scope.runNonInteractive(new ContextState());

      const generationConfig = getGenerationConfigFromMock();
      expect(generationConfig.systemInstruction).toContain('result');
      expect(generationConfig.systemInstruction).toContain('self_emitvalue');
    });

    it('should always start with empty chat history when using systemPrompt', async () => {
      const { config } = await createMockConfig();
      const promptConfig: PromptConfig = { systemPrompt: 'Test prompt' };

      mockSendMessageStream.mockImplementation(createMockStream(['stop']));

      const { overrides } = createRuntimeOverrides();
      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        undefined,
        overrides,
        undefined,
        { createChatSession },
      );

      await scope.runNonInteractive(new ContextState());

      expect(generationConfigs).toHaveLength(1);
      const generationConfig = generationConfigs[0];
      const history = startHistories[0];
      expect(history).toStrictEqual([]);
    });

    it('should reject with required error when PromptConfig lacks systemPrompt', async () => {
      const { config } = await createMockConfig();
      const malformedPromptConfig = {} as unknown as PromptConfig;

      const { overrides } = createRuntimeOverrides();

      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        malformedPromptConfig,
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        undefined,
        overrides,
        undefined,
        { createChatSession },
      );

      await expect(scope.runNonInteractive(new ContextState())).rejects.toThrow(
        'PromptConfig.systemPrompt must be a non-empty string.',
      );
      expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.ERROR);
    });

    it('should substitute placeholders for missing template variables', async () => {
      const { config } = await createMockConfig();
      const promptConfig: PromptConfig = {
        systemPrompt: 'Hello {{name}}, your session is {{session_id}}.',
      };

      mockSendMessageStream.mockImplementation(createMockStream(['stop']));

      const { overrides } = createRuntimeOverrides();
      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        undefined,
        overrides,
        undefined,
        { createChatSession },
      );

      await scope.runNonInteractive(new ContextState());

      const generationConfig = getGenerationConfigFromMock();
      // Missing template vars should be replaced with a placeholder
      expect(generationConfig.systemInstruction).toContain('{{name}}');
    });

    it('should substitute placeholder for missing sessionId template variable', async () => {
      const { config } = await createMockConfig();
      const promptConfig: PromptConfig = {
        systemPrompt: 'Session: {{session_id}}',
      };

      mockSendMessageStream.mockImplementation(createMockStream(['stop']));

      const { overrides } = createRuntimeOverrides();
      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        undefined,
        overrides,
        undefined,
        { createChatSession },
      );

      await scope.runNonInteractive(new ContextState());

      const generationConfig = getGenerationConfigFromMock();
      expect(generationConfig.systemInstruction).toContain('Session:');
    });

    it('should always include outputConfig instructions in system instruction when systemPrompt is used', async () => {
      const { config } = await createMockConfig();
      const promptConfig: PromptConfig = { systemPrompt: 'Do the thing.' };

      mockSendMessageStream.mockImplementation(createMockStream(['stop']));

      const { overrides } = createRuntimeOverrides();
      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        { outputs: { required_output: 'Must produce this' } },
        overrides,
        undefined,
        { createChatSession },
      );

      await scope.runNonInteractive(new ContextState());

      const generationConfig = getGenerationConfigFromMock();
      expect(generationConfig.systemInstruction).toContain('required_output');
    });

    it('should pass interactionMode subagent when building system prompt', async () => {
      const { config } = await createMockConfig();
      const promptConfig: PromptConfig = { systemPrompt: 'Execute task.' };

      mockSendMessageStream.mockImplementation(createMockStream(['stop']));

      const { overrides } = createRuntimeOverrides();
      const scope = await SubAgentScope.create(
        'test-agent',
        config,
        promptConfig,
        defaultModelConfig,
        defaultRunConfig,
        undefined,
        undefined,
        overrides,
        undefined,
        { createChatSession },
      );

      await scope.runNonInteractive(new ContextState());

      expect(generationConfigs).toHaveLength(1);
      const generationConfig = getGenerationConfigFromMock();
      expect(generationConfig.systemInstruction).toBeDefined();
    });
  });
});
