import { curatedHistoryForTest } from '../../../core/src/test-utils/curated-history-fixture.js';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  afterAll,
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type Mock,
} from 'bun:test';
import type { ChatSessionConfig } from './chatSession.js';
import type {
  ToolDeclaration,
  LegacyToolsetLike,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import { ChatSession } from './chatSession.js';
import type {
  IContent,
  TextBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
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
  createTelemetryAdapterFromConfig,
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

const realRetryModule = {
  ...(await import('@vybestack/llxprt-code-core/utils/retry.js')),
};
void vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  retryWithBackoff: vi.fn((fn: () => unknown) => fn()),
}));

const retryWithBackoff = (await import(
  '@vybestack/llxprt-code-core/utils/retry.js'
).then((m) => m.retryWithBackoff)) as unknown as Mock<
  (...args: never[]) => unknown
>;

async function assertProviderRows(
  contents: AsyncIterable<IContent>,
  expected: ReadonlyArray<Pick<IContent, 'speaker' | 'blocks'>>,
): Promise<IContent[]> {
  const iterator = contents[Symbol.asyncIterator]();
  const rows: IContent[] = [];
  let done = false;
  for (let index = 0; index <= expected.length; index++) {
    const next = await iterator.next();
    if (next.done === true) {
      done = true;
      break;
    }
    rows.push(next.value);
  }
  expect(done).toBe(true);
  expect(rows).toHaveLength(expected.length);
  expect(
    rows.map(({ speaker, blocks }) => ({ speaker, blocks })),
  ).toStrictEqual(expected);
  return rows;
}

async function* streamRows(
  rows: readonly IContent[],
): AsyncGenerator<IContent> {
  for (const row of rows) yield row;
}

let settingsService: SettingsService;
let config: Config;
let manager: TestRuntimeProviderManager;
let providerRuntime: ProviderRuntimeContext;

function registerStubProvider(
  generateChatCompletion: IProvider['generateChatCompletion'],
): void {
  manager.registerProvider({
    name: 'stub',
    isDefault: true,
    getModels: vi.fn(async () => []),
    getDefaultModel: () => 'stub-model',
    generateChatCompletion,
    getAuthToken: vi.fn(async () => 'stub-auth-token'),
  });
}

function buildView(history: HistoryService, runtimeConfig: Config = config) {
  return createAgentRuntimeContext({
    state: createAgentRuntimeState({
      runtimeId: 'runtime-test',
      provider: 'stub',
      model: config.getModel(),
      sessionId: config.getSessionId(),
    }),
    history,
    settings: {
      compressionThreshold: 0.8,
      contextLimit: 128000,
      preserveThreshold: 0.2,
      telemetry: { enabled: true, target: null },
      'reasoning.includeInContext': true,
    },
    provider: createProviderAdapterFromManager(config.getProviderManager()),
    telemetry: createTelemetryAdapterFromConfig(config),
    tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
    providerRuntime: { ...providerRuntime, config: runtimeConfig },
  });
}

function createHookConfig(withModelHooks: boolean): Config {
  const hookConfig = Object.create(config) as Config;
  Object.defineProperties(hookConfig, {
    getEnableHooks: { value: () => true },
    getHookSystem: {
      value: () => ({
        initialize: async () => undefined,
        fireBeforeToolSelectionEvent: async () => ({
          applyToolChoiceModifications: () => ({
            toolChoice: { mode: 'auto', allowedToolNames: ['read_file'] },
          }),
        }),
        ...(withModelHooks
          ? {
              fireBeforeModelEvent: async () => new BeforeModelHookOutput({}),
              fireAfterModelEvent: async () => new AfterModelHookOutput({}),
            }
          : {}),
      }),
    },
  });
  return hookConfig;
}

async function verifyRuntime1(): Promise<GenerateChatOptions> {
  const calls: GenerateChatOptions[] = [];

  const generateChatCompletionMock = vi.fn(async function* (
    options: GenerateChatOptions,
  ) {
    calls.push(options);
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hello world' }],
    };
  });

  registerStubProvider(generateChatCompletionMock);

  const tools = [
    {
      functionDeclarations: [{ name: 'doThing' } as Record<string, unknown>],
    },
  ] as unknown as LegacyToolsetLike;

  const generationConfig: ChatSessionConfig = {
    tools: tools as unknown as ToolDeclaration[],
  };

  const historyService = new HistoryService();
  historyService.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'Previous question' }],
  });
  historyService.add({
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'Previous answer' }],
  });
  const view = buildView(historyService);

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
  expect(options.runtime).toBeDefined();
  expect(options.runtime?.settingsService).toBe(settingsService);

  expect(options.config).toBe(config);
  expect(options.tools).toBeDefined();
  expect(options.tools?.length).toBe(tools.length);

  const expected: Array<Pick<IContent, 'speaker' | 'blocks'>> = [
    { speaker: 'human', blocks: [{ type: 'text', text: 'Previous question' }] },
    { speaker: 'ai', blocks: [{ type: 'text', text: 'Previous answer' }] },
    { speaker: 'human', blocks: [{ type: 'text', text: 'Hello there!' }] },
  ];
  const rows = await assertProviderRows(options.contents, expected);
  expect(rows.every((row) => row.metadata !== undefined)).toBe(true);
  await expect(
    assertProviderRows(streamRows(rows.slice(0, -1)), expected),
  ).rejects.toThrow('expect(received)');
  await expect(
    assertProviderRows(streamRows([...rows, rows[2]]), expected),
  ).rejects.toThrow('expect(received)');

  return options;
}

async function verifyRuntime2(): Promise<
  Awaited<ReturnType<ChatSession['sendMessage']>>
> {
  const generateChatCompletionMock = vi.fn(async function* () {
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
  });

  registerStubProvider(generateChatCompletionMock);

  const tools = [
    {
      functionDeclarations: [
        { name: 'read_file' } as Record<string, unknown>,
        { name: 'run_shell_command' } as Record<string, unknown>,
      ],
    },
  ] as unknown as LegacyToolsetLike;
  const historyService = new HistoryService();
  const hookConfig = createHookConfig(false);
  const view = buildView(historyService, hookConfig);

  const chat = new ChatSession(view, {} as unknown as ContentGenerator, {}, []);

  const response = await chat.sendMessage(
    { message: 'Use tools', config: { tools } },
    'prompt-hook-selection',
  );

  expect(JSON.stringify(response)).not.toContain('run_shell_command');
  expect(JSON.stringify(curatedHistoryForTest(historyService))).not.toContain(
    'run_shell_command',
  );

  return response;
}

async function verifyRuntime3(): Promise<
  Awaited<ReturnType<ChatSession['generateDirectMessage']>>
> {
  const generateChatCompletionMock = vi.fn(async function* () {
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
  });

  registerStubProvider(generateChatCompletionMock);

  const tools = [
    {
      functionDeclarations: [
        { name: 'read_file' } as Record<string, unknown>,
        { name: 'run_shell_command' } as Record<string, unknown>,
      ],
    },
  ] as unknown as LegacyToolsetLike;
  const hookConfig = createHookConfig(true);
  const view = buildView(new HistoryService(), hookConfig);

  const chat = new ChatSession(
    view,
    {} as unknown as ContentGenerator,
    { tools },
    [],
  );

  const response = await chat.generateDirectMessage(
    { message: 'Use direct response' },
    'prompt-direct-hook-selection',
  );

  expect(JSON.stringify(response)).not.toContain('run_shell_command');

  return response;
}

describe('ChatSession runtime context', () => {
  afterAll(() => {
    void vi.mock(
      '@vybestack/llxprt-code-core/utils/retry.js',
      () => realRetryModule,
    );
  });

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
    config.setProviderManager(manager);
  });

  it('passes runtime context and tools to provider generateChatCompletion', async () => {
    expect((await verifyRuntime1()).runtime?.config).toBe(config);
  });
  it('filters hook-disallowed provider function calls from non-stream responses and history', async () => {
    expect(getToolCalls(await verifyRuntime2())).toStrictEqual([
      expect.objectContaining({ name: 'read_file' }),
    ]);
  });
  it('preserves direct response text when filtering hook-disallowed tool calls', async () => {
    expect(extractText(await verifyRuntime3())).toBe(
      'visible textstill visible',
    );
  });
});
