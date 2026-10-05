/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'bun:test';
import { ChatSession } from '../chatSession.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions as GenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import { TestRuntimeProviderManager } from '../../test-utils/runtimeProviderManager.js';
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
import type {
  IContent,
  ThinkingBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createConfigParams } from '../chatSession-thinking-helpers.js';

void vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  retryWithBackoff: vi.fn((fn: () => unknown) => fn()),
}));

type ChatGenerator = (
  options: GenerateChatOptions,
) => AsyncIterableIterator<IContent>;

function adaptGenerator(
  generator: ChatGenerator,
): IProvider['generateChatCompletion'] {
  function generate(
    options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent>;
  function generate(
    content: AsyncIterable<IContent>,
  ): AsyncIterableIterator<IContent>;
  function generate(
    input: GenerateChatOptions | AsyncIterable<IContent>,
  ): AsyncIterableIterator<IContent> {
    if ('contents' in input) return generator(input);
    throw new Error('Expected chat options');
  }
  return generate;
}

export function createFixture(): {
  config: Config;
  manager: TestRuntimeProviderManager;
  providerRuntime: ProviderRuntimeContext;
} {
  const settingsService = new SettingsService();
  const config = new Config(createConfigParams(settingsService));

  settingsService.set('providers.anthropic.auth-key', 'test-api-key');
  settingsService.set(
    'providers.anthropic.model',
    'claude-sonnet-4-5-20250929',
  );
  settingsService.set('reasoning.enabled', true);
  settingsService.set('reasoning.includeInContext', true);
  settingsService.set('reasoning.stripFromContext', 'none');

  const providerRuntime = createProviderRuntimeContext({
    settingsService,
    config,
    runtimeId: 'test.runtime.issue1150',
    metadata: { source: 'chatSession.thinking-toolcalls.test' },
  });

  const manager = new TestRuntimeProviderManager(providerRuntime);
  manager.setConfig(config);
  config.setProviderManager(manager);
  return { config, manager, providerRuntime };
}

export function createChat(
  fixture: ReturnType<typeof createFixture>,
  generateChatCompletion: ChatGenerator,
  runtimeId: string,
): { chat: ChatSession; historyService: HistoryService } {
  const { config, manager, providerRuntime } = fixture;
  const provider = {
    name: 'anthropic',
    isDefault: true,
    getModels: vi.fn(async () => []),
    getDefaultModel: () => 'claude-sonnet-4-5-20250929',
    generateChatCompletion: adaptGenerator(generateChatCompletion),
    getAuthToken: vi.fn(async () => 'test-auth-token'),
  };
  manager.registerProvider(provider);

  const runtimeState = createAgentRuntimeState({
    runtimeId,
    provider: provider.name,
    model: 'claude-sonnet-4-5-20250929',
    sessionId: config.getSessionId(),
  });

  const historyService = new HistoryService();
  const view = createAgentRuntimeContext({
    state: runtimeState,
    history: historyService,
    settings: {
      compressionThreshold: 0.8,
      contextLimit: 200000,
      preserveThreshold: 0.2,
      telemetry: { enabled: true, target: null },
    },
    provider: createProviderAdapterFromManager(config.getProviderManager()),
    telemetry: createTelemetryAdapterFromConfig(config),
    tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
    providerRuntime: { ...providerRuntime },
  });

  const chat = new ChatSession(view, {} as unknown as ContentGenerator, {}, []);
  return { chat, historyService };
}

export async function exhaustStream(
  chat: ChatSession,
  message: string,
  promptId: string,
): Promise<void> {
  const stream = await chat.sendMessageStream({ message }, promptId);
  for await (const _event of stream) {
    // exhaust stream to trigger history recording
  }
}

export function separatedThinkingAndTools(
  calls: GenerateChatOptions[],
): ChatGenerator {
  return vi.fn(async function* (options: GenerateChatOptions) {
    calls.push(options);

    yield {
      speaker: 'ai',
      blocks: [
        {
          type: 'thinking',
          thought:
            'Let me analyze this request and determine which tools to use.',
          sourceField: 'thinking',
          signature: 'test-signature-abc123',
        } as ThinkingBlock,
      ],
    } as IContent;

    yield {
      speaker: 'ai',
      blocks: [
        {
          type: 'text',
          text: "I'll make some tool calls now.",
        },
      ],
    } as IContent;

    yield {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'hist_tool_001',
          name: 'list_directory',
          parameters: { path: '/tmp' },
        },
      ],
    } as IContent;

    yield {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'hist_tool_002',
          name: 'read_file',
          parameters: { absolute_path: '/tmp/test.txt' },
        },
      ],
    } as IContent;
  });
}

export function signedThinkingAndTool(
  calls: GenerateChatOptions[],
  testSignature: string,
): ChatGenerator {
  return vi.fn(async function* (options: GenerateChatOptions) {
    calls.push(options);

    // Thinking with signature (required by Anthropic for multi-turn)
    yield {
      speaker: 'ai',
      blocks: [
        {
          type: 'thinking',
          thought: 'Processing the request...',
          sourceField: 'thinking',
          signature: testSignature,
        } as ThinkingBlock,
      ],
    } as IContent;

    // Tool call
    yield {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'hist_tool_sig_001',
          name: 'glob',
          parameters: { pattern: '**/*.ts' },
        },
      ],
    } as IContent;
  });
}

export function multiTurnThinkingAndTool(calls: IContent[][]): ChatGenerator {
  let callCount = 0;
  return vi.fn(async function* (options: GenerateChatOptions) {
    const contents: IContent[] = [];
    for await (const content of options.contents) {
      contents.push(content);
    }
    calls.push(contents);
    callCount++;

    if (callCount === 1) {
      // First turn: thinking + tool calls
      yield {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'First turn thinking',
            sourceField: 'thinking',
            signature: 'sig-turn-1',
          } as ThinkingBlock,
        ],
      } as IContent;

      yield {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_turn1_001',
            name: 'list_directory',
            parameters: { path: '/tmp' },
          },
        ],
      } as IContent;
    } else {
      // Second turn: just text response after tool results
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Here are the results.' }],
      } as IContent;
    }
  });
}

export function separatelyYieldedThinkingAndTool(): ChatGenerator {
  return vi.fn(async function* () {
    // Separate yields (current problematic behavior)
    yield {
      speaker: 'ai',
      blocks: [
        {
          type: 'thinking',
          thought: 'Thinking separately',
          sourceField: 'thinking',
          signature: 'sig-separate',
        } as ThinkingBlock,
      ],
    } as IContent;

    yield {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'hist_tool_separate_001',
          name: 'search_file_content',
          parameters: { pattern: 'test' },
        },
      ],
    } as IContent;
  });
}
