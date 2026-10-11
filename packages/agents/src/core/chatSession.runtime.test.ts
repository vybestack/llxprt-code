import { createSessionSettingsFixture } from '../api/__tests__/helpers/session-settings-fixture.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import { BeforeToolSelectionHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { installModelToolFixture } from './__tests__/model-tool-fixture.js';
const modelTools = installModelToolFixture();

import { describe, it, expect, vi, beforeEach, type Mock } from 'bun:test';
import type { ChatSessionConfig } from './chatSession.js';
import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { ChatSession } from './chatSession.js';
import type { TextBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { getToolCalls } from '@vybestack/llxprt-code-core/llm-types/index.js';
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
  createTelemetryAdapter,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import {
  AfterModelHookOutput,
  BeforeModelHookOutput,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { createConfigParams } from './chatSession-runtime-helpers.js';

/**
 * Extracts visible text from a neutral ModelOutput — the post-P13
 * replacement for the deleted GenerateContentResponse `.text` getter.
 */
function extractText(output: {
  content: { blocks: Array<{ type: string; text?: string }> };
}): string {
  return output.content.blocks
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

void vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  retryWithBackoff: vi.fn((fn: () => unknown) => fn()),
}));

const retryWithBackoff = (await import(
  '@vybestack/llxprt-code-core/utils/retry.js'
).then((m) => m.retryWithBackoff)) as unknown as Mock<
  (...args: never[]) => unknown
>;

describe('ChatSession runtime context', () => {
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
      metadata: { source: 'chatSession.runtime.test' },
    });

    manager = new TestRuntimeProviderManager(providerRuntime);
    manager.setConfig(config);
    configureProviderRuntimeFactories(config, manager);
  });

  it('passes runtime context and tools to provider generateChatCompletion', async () => {
    const calls: GenerateChatOptions[] = [];

    const generateChatCompletionMock = vi.fn(async function* (
      options: GenerateChatOptions | IContent[],
    ): AsyncIterableIterator<IContent> {
      if (Array.isArray(options)) throw new Error('Expected request options');
      calls.push(options);
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'hello world' }],
      };
    });

    const provider: IProvider = {
      name: 'stub',
      isDefault: true,
      getModels: vi.fn(async () => []),
      getDefaultModel: () => 'stub-model',
      generateChatCompletion: generateChatCompletionMock,
    };

    manager.registerProvider(provider);

    const tools: ToolDeclaration[] = [
      {
        name: 'doThing',
        description: 'Do a thing',
        parametersJsonSchema: {
          type: 'object',
          properties: { value: { type: 'string' } },
        },
      },
    ];

    const generationConfig: ChatSessionConfig = { tools };

    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-test',
      provider: provider.name,
      model: config.getModel(),
      sessionId: config.getSessionId(),
    });
    const historyService = new HistoryService();
    const view = createAgentRuntimeContext({
      prepareProviderInvocation: (name, parameters, signal) =>
        captureProviderInvocation(providerRuntime, name, parameters, signal),
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
      provider: createProviderAdapterFromManager(manager),
      telemetry: createTelemetryAdapter(
        config,
        createSessionSettingsFixture(config).settingsOwner.telemetry,
      ),
      tools: createToolRegistryViewFromRegistry(modelTools()),
      providerRuntime: { ...providerRuntime },
    });

    const chat = new ChatSession(
      view,
      {} as unknown as ContentGenerator,
      generationConfig,
      [],
    );

    const response = await chat.sendMessage(
      { message: 'Hello there!' },
      'prompt-123',
    );

    expect(response).toBeDefined();
    expect(generateChatCompletionMock).toHaveBeenCalledTimes(1);
    expect(retryWithBackoff).toHaveBeenCalled();

    const options = calls[0];
    expect(options).toBeDefined();
    expect(options).not.toHaveProperty('runtime');
    expect(options.invocation).toBeDefined();
    expect(options).not.toHaveProperty('config');
    expect(options.invocation?.getProviderOverrides('stub')).toMatchObject(
      settingsService.getProviderSettings('stub'),
    );
    expect(options.tools).toBeDefined();
    expect(options.tools?.length).toBe(tools.length);

    const contents = options.contents;
    expect(Array.isArray(contents)).toBe(true);
    expect(contents.length).toBeGreaterThan(0);
  });

  it('filters hook-disallowed provider function calls from non-stream responses and history', async () => {
    const generateChatCompletionMock = vi.fn(
      async function* (): AsyncIterableIterator<IContent> {
        yield {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'allowed-call',
              name: 'read_file',
              parameters: { file_path: 'file.txt' },
            },
            {
              type: 'tool_call',
              id: 'blocked-call',
              name: 'run_shell_command',
              parameters: { command: 'echo blocked' },
            },
          ],
          metadata: {
            providerMetadata: {
              automaticFunctionCallingHistory: [
                {
                  speaker: 'ai',
                  blocks: [
                    {
                      type: 'tool_call',
                      id: 'history-allowed-call',
                      name: 'read_file',
                      parameters: { file_path: 'file.txt' },
                    },
                    {
                      type: 'tool_call',
                      id: 'history-blocked-call',
                      name: 'run_shell_command',
                      parameters: { command: 'echo blocked-history' },
                    },
                  ],
                },
              ],
            },
          },
        };
      },
    );

    const provider: IProvider = {
      name: 'stub',
      isDefault: true,
      getModels: vi.fn(async () => []),
      getDefaultModel: () => 'stub-model',
      generateChatCompletion: generateChatCompletionMock,
    };
    manager.registerProvider(provider);

    const tools = [
      { name: 'read_file', parametersJsonSchema: {} },
      { name: 'run_shell_command', parametersJsonSchema: {} },
    ];
    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-test',
      provider: provider.name,
      model: config.getModel(),
      sessionId: config.getSessionId(),
    });
    const historyService = new HistoryService();
    const hookOwner: HookExecutionOwner = {
      sessionId: () => config.getSessionId(),
      transcriptPath: () => undefined,
      beforeToolSelection: async () =>
        new BeforeToolSelectionHookOutput({
          hookSpecificOutput: {
            toolChoice: { mode: 'auto', allowedToolNames: ['read_file'] },
          },
        }),
    };
    const hookRuntime = { ...providerRuntime, config };
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
      provider: createProviderAdapterFromManager(manager),
      telemetry: createTelemetryAdapter(
        config,
        createSessionSettingsFixture(config).settingsOwner.telemetry,
      ),
      tools: createToolRegistryViewFromRegistry(modelTools()),
      providerRuntime: hookRuntime,
      prepareProviderInvocation: (name, parameters, signal) =>
        captureProviderInvocation(hookRuntime, name, parameters, signal),
    });

    const chat = new ChatSession(
      view,
      {} as unknown as ContentGenerator,
      {},
      [],
    );

    const response = await chat.sendMessage(
      { message: 'Use tools', config: { tools }, hookOwner },
      'prompt-hook-selection',
    );

    expect(getToolCalls(response)).toStrictEqual([
      expect.objectContaining({ name: 'read_file' }),
    ]);

    expect(JSON.stringify(response)).not.toContain('run_shell_command');
    expect(JSON.stringify(historyService.getCurated())).not.toContain(
      'run_shell_command',
    );
  });

  it('preserves direct response text when filtering hook-disallowed tool calls', async () => {
    const generateChatCompletionMock = vi.fn(
      async function* (): AsyncIterableIterator<IContent> {
        yield {
          speaker: 'ai',
          blocks: [
            { type: 'text', text: 'visible text' },
            {
              type: 'tool_call',
              id: 'blocked-call',
              name: 'run_shell_command',
              parameters: { command: 'echo blocked' },
            },
          ],
          metadata: {
            providerMetadata: {
              automaticFunctionCallingHistory: [
                {
                  speaker: 'ai',
                  blocks: [
                    {
                      type: 'tool_call',
                      id: 'metadata-blocked-call',
                      name: 'run_shell_command',
                      parameters: { command: 'echo metadata-blocked' },
                    },
                  ],
                },
              ],
            },
          },
        };
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'still visible' }],
        };
      },
    );

    const provider: IProvider = {
      name: 'stub',
      isDefault: true,
      getModels: vi.fn(async () => []),
      getDefaultModel: () => 'stub-model',
      generateChatCompletion: generateChatCompletionMock,
    };
    manager.registerProvider(provider);

    const tools = [
      { name: 'read_file', parametersJsonSchema: {} },
      { name: 'run_shell_command', parametersJsonSchema: {} },
    ];
    const hookOwner: HookExecutionOwner = {
      sessionId: () => config.getSessionId(),
      transcriptPath: () => undefined,
      beforeToolSelection: async () =>
        new BeforeToolSelectionHookOutput({
          hookSpecificOutput: {
            toolChoice: { mode: 'auto', allowedToolNames: ['read_file'] },
          },
        }),
      beforeModel: async () => new BeforeModelHookOutput({}),
      afterModel: async () => new AfterModelHookOutput({}),
    };
    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-test',
      provider: provider.name,
      model: config.getModel(),
      sessionId: config.getSessionId(),
    });
    const hookRuntime = { ...providerRuntime, config };
    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: new HistoryService(),
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
      provider: createProviderAdapterFromManager(manager),
      telemetry: createTelemetryAdapter(
        config,
        createSessionSettingsFixture(config).settingsOwner.telemetry,
      ),
      tools: createToolRegistryViewFromRegistry(modelTools()),
      providerRuntime: hookRuntime,
      prepareProviderInvocation: (name, parameters, signal) =>
        captureProviderInvocation(hookRuntime, name, parameters, signal),
    });

    const chat = new ChatSession(
      view,
      {} as unknown as ContentGenerator,
      { tools },
      [],
    );

    const response = await chat.generateDirectMessage(
      { message: 'Use direct response', hookOwner },
      'prompt-direct-hook-selection',
    );

    expect(extractText(response)).toBe('visible textstill visible');
    expect(JSON.stringify(response)).not.toContain('run_shell_command');
  });
});
