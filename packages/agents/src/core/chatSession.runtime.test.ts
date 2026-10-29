import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import {
  BeforeModelHookOutput,
  AfterModelHookOutput,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
import { invocationData } from './chatSession-runtime-helpers.js';
import { chatSessionPorts } from './chatSessionPorts.js';
import { createSessionSettingsFixture } from '../api/__tests__/helpers/session-settings-fixture.js';
import { configureProviderTokenizer } from '@vybestack/llxprt-code-providers/composition.js';
import { curatedHistoryAfterCommit } from '@vybestack/llxprt-code-test-utils/core/curated-history-fixture.js';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import { BeforeToolSelectionHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
import { installModelToolFixture } from './__tests__/model-tool-fixture.js';
const modelTools = installModelToolFixture();
import { afterAll, describe, it, expect, vi, beforeEach } from 'bun:test';
import type { ChatSessionConfig } from './chatSession.js';
import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { ChatSession } from './chatSession.js';
import type {
  IContent,
  TextBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions as GenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapter,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';

import { SettingsService } from '@vybestack/llxprt-code-settings';

import { TestRuntimeProviderManager } from '../test-utils/runtimeProviderManager.js';
import { createConfigParams } from './chatSession-runtime-helpers.js';
import { withSnapshotModelEvents } from './__tests__/support/snapshot-hook-system.js';

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
const retryWithBackoff = vi.fn((fn: () => unknown) => fn());
void vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  ...realRetryModule,
  retryWithBackoff,
}));

async function assertProviderRows(
  contents: AsyncIterable<IContent>,
  expected: Array<Pick<IContent, 'speaker' | 'blocks'>>,
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
  });
}

function buildView(history: HistoryService) {
  const { settingsOwner } = createSessionSettingsFixture(
    config,
    settingsService,
  );
  const state = createAgentRuntimeState({
    runtimeId: 'runtime-test',
    provider: 'stub',
    model: config.getModel(),
    sessionId: config.getSessionId(),
  });
  return createAgentRuntimeContext({
    prepareProviderInvocation: (name, parameters, signal) =>
      captureProviderInvocation(
        invocationData(providerRuntime, name, settingsService),
        name,
        parameters,
        signal,
      ),
    state,
    history,
    settings: {
      compressionThreshold: 0.8,
      contextLimit: 128000,
      preserveThreshold: 0.2,
      telemetry: { enabled: true, target: null },
      'reasoning.includeInContext': true,
    },
    provider: createProviderAdapterFromManager(manager),
    telemetry: createTelemetryAdapter(config, settingsOwner.telemetry),
    tools: createToolRegistryViewFromRegistry(modelTools()),
    providerRuntime: { ...providerRuntime },
  });
}

function createHookOwner(withModelHooks: boolean): HookExecutionOwner {
  const owner: HookExecutionOwner = {
    sessionId: () => config.getSessionId(),
    transcriptPath: () => undefined,
    beforeToolSelection: async () =>
      new BeforeToolSelectionHookOutput({
        hookSpecificOutput: {
          toolChoice: { mode: 'auto', allowedToolNames: ['read_file'] },
        },
      }),
  };
  if (!withModelHooks) return owner;
  const modelHooks = withSnapshotModelEvents({
    fireBeforeModelEvent: async () => new BeforeModelHookOutput({}),
    fireAfterModelEvent: async () => new AfterModelHookOutput({}),
  });
  return {
    ...owner,
    beforeModel: async () => new BeforeModelHookOutput({}),
    afterModel: async () => new AfterModelHookOutput({}),
    beforeModelSnapshot: (request, signal) =>
      modelHooks.fireBeforeModelSnapshotEvent(request, signal),
    afterModelSnapshot: (request, response, signal) =>
      modelHooks.fireAfterModelSnapshotEvent(request, response, signal),
  };
}

async function verifyRuntime1(): Promise<GenerateChatOptions> {
  const calls: GenerateChatOptions[] = [];
  // The source route closes the pinned request rows once the send returns, so
  // the rows are read while the provider holds them.
  const receivedRows: IContent[] = [];

  const generateChatCompletionMock = vi.fn(async function* (
    input: GenerateChatOptions | AsyncIterable<IContent>,
  ): AsyncGenerator<IContent> {
    if (!('contents' in input)) throw new Error('Expected chat options');
    const options = input;
    calls.push(options);
    for await (const row of options.contents) receivedRows.push(row);
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hello world' }],
    };
  });

  registerStubProvider(generateChatCompletionMock);

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
    chatSessionPorts(view),
    config,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    unusedContentGenerator,
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

  const expected: Array<Pick<IContent, 'speaker' | 'blocks'>> = [
    { speaker: 'human', blocks: [{ type: 'text', text: 'Previous question' }] },
    { speaker: 'ai', blocks: [{ type: 'text', text: 'Previous answer' }] },
    { speaker: 'human', blocks: [{ type: 'text', text: 'Hello there!' }] },
  ];
  const rows = await assertProviderRows(streamRows(receivedRows), expected);
  expect(rows.every((row) => row.metadata !== undefined)).toBe(true);
  await expect(
    assertProviderRows(streamRows(rows.slice(0, -1)), expected),
  ).rejects.toThrow('expect(received)');
  await expect(
    assertProviderRows(streamRows([...rows, rows[2]]), expected),
  ).rejects.toThrow('expect(received)');

  return options;
}

async function verifyRuntime2(): Promise<IContent> {
  const generateChatCompletionMock = vi.fn(
    async function* (): AsyncGenerator<IContent> {
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

  registerStubProvider(generateChatCompletionMock);

  const tools = [
    { name: 'read_file', parametersJsonSchema: {} },
    { name: 'run_shell_command', parametersJsonSchema: {} },
  ];
  const historyService = new HistoryService();
  const hookOwner = createHookOwner(false);
  const view = buildView(historyService);

  const chat = new ChatSession(
    chatSessionPorts(view),
    config,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    unusedContentGenerator,
    {},
    [],
  );

  const response = await chat.sendMessage(
    { message: 'Use tools', config: { tools }, hookOwner },
    'prompt-hook-selection',
  );

  expect(JSON.stringify(response)).not.toContain('run_shell_command');
  expect(
    JSON.stringify(await curatedHistoryAfterCommit(historyService)),
  ).not.toContain('run_shell_command');

  expect(response.status).toBe('published');
  const sealed = await historyService.getLastContent();
  if (sealed === undefined) throw new Error('Missing sealed response');
  return sealed;
}

async function verifyRuntime3(): Promise<
  Awaited<ReturnType<ChatSession['generateDirectMessage']>>
> {
  const generateChatCompletionMock = vi.fn(
    async function* (): AsyncGenerator<IContent> {
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

  registerStubProvider(generateChatCompletionMock);

  const tools = [
    { name: 'read_file', parametersJsonSchema: {} },
    { name: 'run_shell_command', parametersJsonSchema: {} },
  ];
  const hookOwner = createHookOwner(true);
  const view = buildView(new HistoryService());

  const chat = new ChatSession(
    chatSessionPorts(view),
    config,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    unusedContentGenerator,
    { tools },
    [],
  );

  const response = await chat.generateDirectMessage(
    { message: 'Use direct response', hookOwner },
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
      runtimeId: 'test.runtime',
      metadata: { source: 'chatSession.runtime.test' },
    });

    manager = new TestRuntimeProviderManager(providerRuntime);
    manager.setConfig(config);
    configureProviderTokenizer(manager);
  });

  it('passes runtime context and tools to provider generateChatCompletion', async () => {
    expect(await verifyRuntime1()).not.toHaveProperty('runtime');
  });
  it('filters hook-disallowed provider function calls from non-stream responses and history', async () => {
    expect(
      (await verifyRuntime2()).blocks.filter(
        (block) => block.type === 'tool_call',
      ),
    ).toStrictEqual([expect.objectContaining({ name: 'read_file' })]);
  });
  it('preserves direct response text when filtering hook-disallowed tool calls', async () => {
    expect(extractText(await verifyRuntime3())).toBe(
      'visible textstill visible',
    );
  });
});

const unusedGenerator = async (): Promise<never> => {
  throw new Error('Unexpected legacy generator');
};
const unusedContentGenerator: ContentGenerator = {
  generateContent: unusedGenerator,
  generateContentStream: unusedGenerator,
  countTokens: unusedGenerator,
  embedContent: unusedGenerator,
};
