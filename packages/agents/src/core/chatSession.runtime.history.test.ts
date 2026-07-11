/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * History/tool-call behaviors for ChatSession runtime context.
 * Sibling to chatSession.runtime.test.ts (split to avoid file-level max-lines disable).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Part } from '@google/genai';
import { ChatSession } from './chatSession.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions as GenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import { TestRuntimeProviderManager } from '../test-utils/runtimeProviderManager.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  createProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { createConfigParams } from './chatSession-runtime-helpers.js';

describe('ChatSession runtime history and tool-call behavior', () => {
  let settingsService: SettingsService;
  let config: Config;
  let manager: TestRuntimeProviderManager;
  let providerRuntime: ProviderRuntimeContext;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = new Config(createConfigParams(settingsService));

    settingsService.set('providers.stub.base-url', 'https://stub.example.com');
    settingsService.set('providers.stub.auth-key', 'stub-api-key');
    settingsService.set('providers.stub.model', 'stub-model');

    providerRuntime = createProviderRuntimeContext({
      settingsService,
      config,
      runtimeId: 'test.runtime',
      metadata: { source: 'chatSession.runtime.history.test' },
    });

    manager = new TestRuntimeProviderManager(providerRuntime);
    manager.setConfig(config);
    config.setProviderManager(manager);
  });

  it('commits tool call/response even when model returns only thinking after tool results', async () => {
    const generateChatCompletionMock = vi.fn(async function* () {
      yield {
        speaker: 'ai',
        blocks: [{ type: 'thinking', thought: 'processing tool output' }],
      };
    });

    const provider: IProvider = {
      name: 'stub',
      isDefault: true,
      getModels: vi.fn(async () => []),
      getDefaultModel: () => 'stub-model',
      generateChatCompletion: generateChatCompletionMock,
      getServerTools: () => [],
      invokeServerTool: vi.fn(),
      getAuthToken: vi.fn(async () => 'stub-auth-token'),
    };

    manager.registerProvider(provider);

    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-test',
      provider: provider.name,
      model: config.getModel(),
      sessionId: config.getSessionId(),
    });
    const historyService = new HistoryService();
    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: historyService,
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 128000,
        preserveThreshold: 0.2,
        telemetry: {
          enabled: true,
          target: null,
        },
        'reasoning.includeInContext': true,
      },
      provider: createProviderAdapterFromManager(config.getProviderManager()),
      telemetry: createTelemetryAdapterFromConfig(config),
      tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
      providerRuntime: { ...providerRuntime },
    });

    const chat = new ChatSession(
      view,
      {} as unknown as ContentGenerator,
      {},
      [],
    );

    const toolCallPart = {
      functionCall: {
        id: 'toolu_123',
        name: 'run_shell_command',
        args: { command: 'ls -lt dev-docs' },
      },
    };
    const toolResponsePart = {
      functionResponse: {
        id: 'toolu_123',
        name: 'run_shell_command',
        response: { stdout: 'ok', stderr: '', exitCode: 0 },
      },
    };

    const stream = await chat.sendMessageStream(
      { message: [toolCallPart, toolResponsePart] as unknown as Part[] },
      'prompt-123',
    );
    for await (const _event of stream) {
      // exhaust stream to trigger history recording
    }

    const curated = historyService.getCuratedForProvider();
    const toolCallIndex = curated.findIndex(
      (content) => content.speaker === 'ai' && content.blocks.length > 0,
    );
    expect(toolCallIndex).toBeGreaterThanOrEqual(0);
    const toolResponseIndex = curated.findIndex(
      (content) => content.speaker === 'tool' && content.blocks.length > 0,
    );
    expect(toolResponseIndex).toBeGreaterThanOrEqual(0);
    expect(toolResponseIndex).toBe(toolCallIndex + 1);

    const toolCallBlock = curated[toolCallIndex].blocks.find(
      (block) => block.type === 'tool_call',
    ) as { id: string; name: string };
    const toolResponseBlock = curated[toolResponseIndex].blocks.find(
      (block) => block.type === 'tool_response',
    ) as { callId: string; toolName: string };

    expect(toolCallBlock).toBeDefined();
    expect(toolResponseBlock).toBeDefined();
    expect(toolCallBlock.name).toBe('run_shell_command');
    expect(toolResponseBlock.toolName).toBe('run_shell_command');
    expect(toolResponseBlock.callId).toBe(toolCallBlock.id);
  });

  it('eagerly records completed tool calls before the next provider stream starts', () => {
    const historyService = new HistoryService();
    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-record-completed',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-record-completed',
    });

    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: historyService,
      settings: {
        'reasoning.enabled': false,
        'reasoning.includeInContext': true,
        'reasoning.includeInResponse': false,
        'reasoning.adaptiveThinking': false,
      },
      provider: createProviderAdapterFromManager(config.getProviderManager()),
      telemetry: createTelemetryAdapterFromConfig(config),
      tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
      providerRuntime: { ...providerRuntime },
    });

    const chat = new ChatSession(
      view,
      {} as unknown as ContentGenerator,
      {},
      [],
    );

    const completed = [
      {
        status: 'success' as const,
        request: {
          callId: 'toolu_456',
          name: 'read_file',
          args: {
            absolute_path: '/test/package.json',
          },
          prompt_id: 'prompt-456',
          agentId: 'default_agent',
          isClientInitiated: false,
        },
        response: {
          callId: 'toolu_456',
          responseParts: [
            {
              type: 'tool_call',
              id: 'toolu_456',
              name: 'read_file',
              parameters: {
                absolute_path: '/test/package.json',
              },
            },
            {
              type: 'tool_response',
              callId: 'toolu_456',
              toolName: 'read_file',
              result: { output: '{"name":"@vybestack/llxprt-code"}' },
            },
          ],
          resultDisplay: '@vybestack/llxprt-code',
        },
        invocation: { execute: vi.fn() },
      },
    ];

    chat.recordCompletedToolCalls('stub-model', completed);

    const curated = historyService.getCuratedForProvider();

    const toolResponseIndex = curated.findIndex(
      (content) =>
        content.speaker === 'tool' &&
        content.blocks.some((block) => block.type === 'tool_response'),
    );

    expect(toolResponseIndex).toBeGreaterThanOrEqual(0);
    const toolResponseCount = curated.reduce(
      (count, content) =>
        count +
        content.blocks.filter((block) => block.type === 'tool_response').length,
      0,
    );
    expect(toolResponseCount).toBe(1);

    const toolResponseBlock = curated[toolResponseIndex].blocks.find(
      (block) => block.type === 'tool_response',
    ) as {
      type: string;
      callId: string;
      toolName: string;
      result: { output: string };
    };
    expect(toolResponseBlock).toMatchObject({
      type: 'tool_response',
      toolName: 'read_file',
      result: { output: '{"name":"@vybestack/llxprt-code"}' },
    });
    expect(toolResponseBlock.callId).toMatch(/^hist_tool_/);
  });

  it('does not duplicate eagerly recorded tool responses when the next stream succeeds', async () => {
    const generateChatCompletionMock = vi.fn(async function* () {
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Done.' }],
      };
    });

    const provider: IProvider = {
      name: 'stub',
      isDefault: true,
      getModels: vi.fn(async () => []),
      getDefaultModel: () => 'stub-model',
      generateChatCompletion: generateChatCompletionMock,
      getServerTools: () => [],
      invokeServerTool: vi.fn(),
      getAuthToken: vi.fn(async () => 'stub-auth-token'),
    };

    manager.registerProvider(provider);

    const historyService = new HistoryService();
    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-no-duplicate-tool-response',
      provider: provider.name,
      model: config.getModel(),
      sessionId: config.getSessionId(),
    });
    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: historyService,
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 128000,
        preserveThreshold: 0.2,
        telemetry: {
          enabled: true,
          target: null,
        },
        'reasoning.includeInContext': true,
      },
      provider: createProviderAdapterFromManager(config.getProviderManager()),
      telemetry: createTelemetryAdapterFromConfig(config),
      tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
      providerRuntime: { ...providerRuntime },
    });

    const chat = new ChatSession(
      view,
      {} as unknown as ContentGenerator,
      {},
      [],
    );

    const completed = [
      {
        status: 'success' as const,
        request: {
          callId: 'toolu_continue_1',
          name: 'read_file',
          args: { absolute_path: '/test/package.json' },
          prompt_id: 'prompt-continue-1',
          agentId: 'default_agent',
          isClientInitiated: false,
        },
        response: {
          callId: 'toolu_continue_1',
          responseParts: [
            {
              type: 'tool_call',
              id: 'toolu_continue_1',
              name: 'read_file',
              parameters: { absolute_path: '/test/package.json' },
            },
            {
              type: 'tool_response',
              callId: 'toolu_continue_1',
              toolName: 'read_file',
              result: { output: 'package-json' },
            },
            {
              type: 'text',
              text: 'Tool completed.',
            },
          ],
          resultDisplay: 'package-json',
        },
        invocation: { execute: vi.fn() },
      },
    ];

    chat.recordCompletedToolCalls('stub-model', completed);

    const stream = await chat.sendMessageStream(
      {
        message: [
          {
            functionResponse: {
              id: 'toolu_continue_1',
              name: 'read_file',
              response: { output: 'package-json' },
            },
          },
          { text: 'Tool completed.' },
          { text: 'Continue with the analysis.' },
        ] as unknown as Part[],
      },
      'prompt-continue-1',
    );
    for await (const _event of stream) {
      // exhaust stream to trigger normal history finalization
    }

    const rawHistory = historyService.getRawHistory();
    const toolResponseCount = rawHistory.reduce(
      (count, content) =>
        count +
        content.blocks.filter(
          (block) =>
            block.type === 'tool_response' &&
            block.toolName === 'read_file' &&
            (block.result as { output?: string } | undefined)?.output ===
              'package-json',
        ).length,
      0,
    );
    expect(toolResponseCount).toBe(1);

    const completedTextCount = rawHistory.reduce(
      (count, content) =>
        count +
        content.blocks.filter(
          (block) => block.type === 'text' && block.text === 'Tool completed.',
        ).length,
      0,
    );
    expect(completedTextCount).toBe(1);

    expect(
      rawHistory.some(
        (content) =>
          content.speaker === 'human' &&
          content.blocks.some(
            (block) =>
              block.type === 'text' &&
              block.text === 'Continue with the analysis.',
          ),
      ),
    ).toBe(true);
  });

  it('retains thinking parts alongside tool calls when includeInContext is enabled', async () => {
    const calls: GenerateChatOptions[] = [];

    const generateChatCompletionMock = vi.fn(async function* (
      options: GenerateChatOptions,
    ) {
      calls.push(options);
      yield {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Follow-up reasoning',
            signature: 'sig-1',
          },
          {
            type: 'tool_call',
            id: 'hist_tool_reasoned_1',
            name: 'run_shell_command',
            parameters: { command: 'ls -lt packages' },
          },
        ],
      };
    });

    const provider: IProvider = {
      name: 'stub',
      isDefault: true,
      getModels: vi.fn(async () => []),
      getDefaultModel: () => 'stub-model',
      generateChatCompletion: generateChatCompletionMock,
      getServerTools: () => [],
      invokeServerTool: vi.fn(),
      getAuthToken: vi.fn(async () => 'stub-auth-token'),
    };

    manager.registerProvider(provider);

    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-test',
      provider: provider.name,
      model: config.getModel(),
      sessionId: config.getSessionId(),
    });
    const historyService = new HistoryService();
    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: historyService,
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 128000,
        preserveThreshold: 0.2,
        telemetry: {
          enabled: true,
          target: null,
        },
        'reasoning.includeInContext': true,
      },
      provider: createProviderAdapterFromManager(config.getProviderManager()),
      telemetry: createTelemetryAdapterFromConfig(config),
      tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
      providerRuntime: { ...providerRuntime },
    });

    const chat = new ChatSession(
      view,
      {} as unknown as ContentGenerator,
      {},
      [],
    );

    const stream = await chat.sendMessageStream(
      { message: 'Trigger tool call' },
      'prompt-123',
    );
    for await (const _event of stream) {
      // exhaust stream to trigger history recording
    }

    const curated = historyService.getCuratedForProvider();
    const toolCallEntry = curated.find(
      (content) =>
        content.speaker === 'ai' &&
        content.blocks.some((block) => block.type === 'tool_call'),
    );

    expect(toolCallEntry).toBeDefined();
    expect(
      toolCallEntry?.blocks.some((block) => block.type === 'thinking'),
    ).toBe(true);
  });

  it('closes pending tool calls in provider payload when sending a new user message', async () => {
    const calls: GenerateChatOptions[] = [];

    const generateChatCompletionMock = vi.fn(async function* (
      options: GenerateChatOptions,
    ) {
      calls.push(options);
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'ok' }],
      };
    });

    const provider: IProvider = {
      name: 'stub',
      isDefault: true,
      getModels: vi.fn(async () => []),
      getDefaultModel: () => 'stub-model',
      generateChatCompletion: generateChatCompletionMock,
      getServerTools: () => [],
      invokeServerTool: vi.fn(),
      getAuthToken: vi.fn(async () => 'stub-auth-token'),
    };

    manager.registerProvider(provider);

    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-test',
      provider: provider.name,
      model: config.getModel(),
      sessionId: config.getSessionId(),
    });
    const historyService = new HistoryService();

    // Seed a pending tool call (no tool response yet).
    historyService.add({
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'hist_tool_pending_1',
          name: 'run_shell_command',
          parameters: { command: 'ls -lt packages' },
        },
      ],
    });

    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: historyService,
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 128000,
        preserveThreshold: 0.2,
        telemetry: {
          enabled: true,
          target: null,
        },
      },
      provider: createProviderAdapterFromManager(config.getProviderManager()),
      telemetry: createTelemetryAdapterFromConfig(config),
      tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
      providerRuntime: { ...providerRuntime },
    });

    const chat = new ChatSession(
      view,
      {} as unknown as ContentGenerator,
      {},
      [],
    );

    await chat.sendMessage({ message: 'Continue' }, 'prompt-123');

    expect(calls).toHaveLength(1);
    const sent = calls[0].contents;
    const toolCallIndex = sent.findIndex(
      (c) =>
        c.speaker === 'ai' &&
        c.blocks.some(
          (b) =>
            b.type === 'tool_call' &&
            (b as { id?: string }).id === 'hist_tool_pending_1',
        ),
    );
    expect(toolCallIndex).toBeGreaterThanOrEqual(0);
    expect(sent[toolCallIndex + 1]?.speaker).toBe('tool');
    expect(
      sent[toolCallIndex + 1]?.blocks.some(
        (b) =>
          b.type === 'tool_response' &&
          (b as { callId?: string }).callId === 'hist_tool_pending_1',
      ),
    ).toBe(true);
  });

  it('does not mutate TestRuntimeProviderManager active provider when runtimeState.provider differs', async () => {
    const openaiCalls: GenerateChatOptions[] = [];
    const anthropicCalls: GenerateChatOptions[] = [];

    const openaiProvider: IProvider = {
      name: 'openai',
      isDefault: true,
      getModels: vi.fn(async () => []),
      getDefaultModel: () => 'openai-model',
      generateChatCompletion: vi.fn(async function* (
        options: GenerateChatOptions,
      ) {
        openaiCalls.push(options);
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'openai' }],
        };
      }),
      getServerTools: () => [],
      invokeServerTool: vi.fn(),
      getAuthToken: vi.fn(async () => 'openai-auth-token'),
    };

    const anthropicProvider: IProvider = {
      name: 'anthropic',
      getModels: vi.fn(async () => []),
      getDefaultModel: () => 'claude-test',
      generateChatCompletion: vi.fn(async function* (
        options: GenerateChatOptions,
      ) {
        anthropicCalls.push(options);
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'anthropic' }],
        };
      }),
      getServerTools: () => [],
      invokeServerTool: vi.fn(),
      getAuthToken: vi.fn(async () => 'anthropic-auth-token'),
    };

    manager.registerProvider(openaiProvider);
    manager.registerProvider(anthropicProvider);
    settingsService.set('activeProvider', 'openai');

    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-test',
      provider: 'anthropic',
      model: config.getModel(),
      sessionId: config.getSessionId(),
    });

    const historyService = new HistoryService();
    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: historyService,
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 128000,
        preserveThreshold: 0.2,
        telemetry: {
          enabled: true,
          target: null,
        },
      },
      provider: createProviderAdapterFromManager(config.getProviderManager()),
      telemetry: createTelemetryAdapterFromConfig(config),
      tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
      providerRuntime: { ...providerRuntime },
    });

    const chat = new ChatSession(
      view,
      {} as unknown as ContentGenerator,
      {},
      [],
    );

    await chat.sendMessage({ message: 'Hello there!' }, 'prompt-123');

    expect(openaiCalls).toHaveLength(0);
    expect(anthropicCalls).toHaveLength(1);
    expect(settingsService.get('activeProvider')).toBe('openai');
  });

  it.each([
    {
      label: 'stopReason',
      metadata: { stopReason: 'end_turn' },
    },
    {
      label: 'finishReason',
      metadata: { finishReason: 'stop' },
    },
  ])(
    'coalesces $label metadata into a terminal Finished event in Turn stream',
    async ({ metadata }) => {
      const provider: IProvider = {
        name: 'stub',
        isDefault: true,
        getModels: vi.fn(async () => []),
        getDefaultModel: () => 'stub-model',
        generateChatCompletion: vi.fn(async function* (
          _options: GenerateChatOptions,
        ) {
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'first chunk' }],
          };
          yield {
            speaker: 'ai',
            blocks: [],
            metadata,
          };
        }),
        getServerTools: () => [],
        invokeServerTool: vi.fn(),
        getAuthToken: vi.fn(async () => 'stub-auth-token'),
      };

      manager.registerProvider(provider);

      const runtimeState = createAgentRuntimeState({
        runtimeId: 'runtime-test',
        provider: provider.name,
        model: config.getModel(),
        sessionId: config.getSessionId(),
      });
      const historyService = new HistoryService();
      const view = createAgentRuntimeContext({
        state: runtimeState,
        history: historyService,
        settings: {
          compressionThreshold: 0.8,
          contextLimit: 128000,
          preserveThreshold: 0.2,
          telemetry: {
            enabled: true,
            target: null,
          },
          'reasoning.includeInContext': true,
        },
        provider: createProviderAdapterFromManager(config.getProviderManager()),
        telemetry: createTelemetryAdapterFromConfig(config),
        tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
        providerRuntime: { ...providerRuntime },
      });

      const chat = new ChatSession(
        view,
        {} as unknown as ContentGenerator,
        {},
        [],
      );
      const { Turn, AgentEventType } = await import('./turn.js');
      const turn = new Turn(chat, 'prompt-123');

      const events = [] as Array<{ type: string; value?: unknown }>;
      for await (const event of turn.run(
        [{ text: 'Hello there!' }] as Part[],
        new AbortController().signal,
      )) {
        events.push({
          type: event.type,
          value: 'value' in event ? event.value : undefined,
        });
      }

      const contentEvents = events.filter(
        (event) => event.type === AgentEventType.Content,
      );
      expect(contentEvents).toHaveLength(1);
      expect(contentEvents[0].value).toBe('first chunk');

      const finishedEvents = events.filter(
        (event) => event.type === AgentEventType.Finished,
      );
      expect(finishedEvents).toHaveLength(1);
      expect(finishedEvents[0].value).toMatchObject({ reason: 'stop' });
    },
  );
});
