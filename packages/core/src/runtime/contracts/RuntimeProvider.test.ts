/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for RuntimeProvider and RuntimeProviderManager contracts.
 *
 * These tests prove that core can define provider behavior through structural
 * contracts, never importing concrete provider implementations.
 *
 * @plan:PLAN-20260603-ISSUE1584.P04
 * @requirement:REQ-TEST-001
 */

import { describe, it, expect } from 'bun:test';
import type { RuntimeProvider } from './RuntimeProvider.js';
import type {
  RuntimeProviderToolset,
  RuntimeGenerateChatOptions,
} from './RuntimeProviderChat.js';
import type { IContent } from '../../services/history/IContent.js';
import type { ToolDeclaration } from '../../llm-types/toolDeclaration.js';
import type { RuntimeProviderManager } from './RuntimeProviderManager.js';
import type { RuntimeModel } from './RuntimeModel.js';

describe('RuntimeProvider contract', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts a structural provider with name property', () => {
    const provider: RuntimeProvider = {
      ...providerDefaults(),
      name: 'test-provider',
    };

    expect(provider.name).toBe('test-provider');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts a structural provider with getCurrentModel', () => {
    const provider: RuntimeProvider = {
      ...providerDefaults(),
      name: 'test-provider',
      getCurrentModel(): string {
        return 'test-model-1';
      },
    };

    expect(provider.getCurrentModel!()).toBe('test-model-1');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it(
    'accepts a structural provider with getModels returning RuntimeModel array',
    verifyProviderModels,
  );

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts a provider with generateChatCompletion that yields chunks', async () => {
    const chunks: IContent[] = [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'Hello' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: ' world' }] },
    ];

    const provider: RuntimeProvider = {
      ...providerDefaults(),
      name: 'test-provider',
      generateChatCompletion(
        _messages: RuntimeGenerateChatOptions | AsyncIterable<IContent>,
        _tools?: RuntimeProviderToolset,
        _options?: unknown,
      ): AsyncIterableIterator<IContent> {
        async function* yieldChunks(): AsyncIterableIterator<IContent> {
          for (const chunk of chunks) {
            yield chunk;
          }
        }
        return yieldChunks();
      },
    };

    const stream = provider.generateChatCompletion(streamRows([]), []);
    const collected: IContent[] = [];
    for await (const chunk of stream) {
      collected.push(chunk);
    }
    expect(collected).toHaveLength(2);
    const block = collected[0].blocks[0];
    if (block.type !== 'text') throw new Error('Expected text content');
    expect(block.text).toBe('Hello');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts a provider implementing only the required operations', () => {
    const provider: RuntimeProvider = {
      ...providerDefaults(),
      name: 'minimal',
    };

    expect(provider.name).toBe('minimal');
    expect(provider.getCurrentModel).toBeUndefined();
    expect(typeof provider.getModels).toBe('function');
    expect(provider.setModel).toBeUndefined();
    expect(typeof provider.generateChatCompletion).toBe('function');
  });
});

describe('RuntimeProvider flat tool declarations', () => {
  it('accepts ordered neutral declarations with faithful schemas', () => {
    const schema = {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    } as const;
    const declarations: RuntimeProviderToolset = [
      {
        name: 'read_file',
        description: 'Read a file',
        parametersJsonSchema: schema,
      },
      { name: 'no_args', parametersJsonSchema: true },
    ];

    expect(declarations.map(({ name }) => name)).toStrictEqual([
      'read_file',
      'no_args',
    ]);
    expect(declarations[0]?.parametersJsonSchema).toBe(schema);
    expect(declarations[1]?.parametersJsonSchema).toBe(true);
  });

  it('uses the same flat declarations for positional provider calls', () => {
    const declarations: ToolDeclaration[] = [
      { name: 'lookup', parametersJsonSchema: { type: 'object' } },
    ];
    const provider: RuntimeProvider = {
      ...providerDefaults(),
      name: 'test-provider',
      generateChatCompletion(
        _contents: RuntimeGenerateChatOptions | AsyncIterable<IContent>,
        tools?: RuntimeProviderToolset,
      ): AsyncIterableIterator<IContent> {
        expect(tools?.[0]?.name).toBe('lookup');
        return (async function* () {})();
      },
    };

    const stream = provider.generateChatCompletion(
      streamRows([]),
      declarations,
    );
    expect(stream).toBeDefined();
  });
});

describe('RuntimeProviderManager contract', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it(
    'accepts a structural manager that returns active provider',
    verifyManagerCase1,
  );

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts a manager that lists providers and models', verifyManagerCase2);

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('returns undefined when no active provider is set', () => {
    const manager: RuntimeProviderManager = {
      ...managerDefaults(),
      getActiveProvider(): RuntimeProvider | undefined {
        return undefined;
      },
      getActiveProviderName(): string | undefined {
        return undefined;
      },
      setActiveProvider(_name: string): void {},
      setRuntimeContext(): void {},
      getAvailableModels(): Promise<RuntimeModel[]> {
        return Promise.resolve([]);
      },
      listProviders(): string[] {
        return [];
      },
    };

    expect(manager.getActiveProvider()).toBeUndefined();
    expect(manager.getActiveProviderName()).toBeUndefined();
  });
});

function availableModelsOrEmpty(
  providerName: string | undefined,
  models: RuntimeModel[],
): Promise<RuntimeModel[]> {
  if (!providerName || providerName === 'openai') {
    return Promise.resolve(models);
  }
  return Promise.resolve([]);
}

async function* streamRows(
  rows: readonly IContent[],
): AsyncIterableIterator<IContent> {
  yield* rows;
}

function providerDefaults(): RuntimeProvider {
  return {
    name: 'test-provider',
    async getModels(): Promise<RuntimeModel[]> {
      return [];
    },
    async *generateChatCompletion(): AsyncIterableIterator<IContent> {},
  };
}

function managerDefaults(): RuntimeProviderManager {
  return {
    getActiveProvider: () => undefined,
    getActiveProviderName: () => undefined,
    setActiveProvider: () => {},
    getAvailableModels: async () => [],
    listProviders: () => [],
    getProviderByName: () => undefined,
    registerProvider: () => {},
    getProviderMetrics: () => ({}),
    getSessionTokenUsage: () => ({
      input: 0,
      output: 0,
      cache: 0,
      tool: 0,
      thought: 0,
      total: 0,
    }),
    setConfig: () => {},
    setRuntimeContext: () => {},
    hasActiveProvider: () => false,
    accumulateSessionTokens: () => {},
  };
}

function verifyManagerCase1(): void {
  const fakeProvider: RuntimeProvider = {
    ...providerDefaults(),
    name: 'openai',
  };

  const manager: RuntimeProviderManager = {
    ...managerDefaults(),
    getActiveProvider(): RuntimeProvider | undefined {
      return fakeProvider;
    },
    getActiveProviderName(): string | undefined {
      return 'openai';
    },
    setActiveProvider(_name: string): void {},
    setRuntimeContext(): void {},
    getAvailableModels(_providerName?: string): Promise<RuntimeModel[]> {
      return Promise.resolve([]);
    },
    getProviderNames(): string[] {
      return ['openai'];
    },
    listProviders(): string[] {
      return ['openai'];
    },
  };

  expect(manager.getActiveProvider()?.name).toBe('openai');
  expect(manager.getActiveProviderName()).toBe('openai');
}

async function verifyManagerCase2(): Promise<void> {
  const models: RuntimeModel[] = [
    { id: 'gpt-4', name: 'GPT-4', provider: 'openai', contextWindow: 8192 },
    {
      id: 'gpt-3.5',
      name: 'GPT-3.5',
      provider: 'openai',
      contextWindow: 4096,
    },
  ];

  const manager: RuntimeProviderManager = {
    ...managerDefaults(),
    getActiveProvider(): RuntimeProvider | undefined {
      return undefined;
    },
    getActiveProviderName(): string | undefined {
      return undefined;
    },
    setActiveProvider(_name: string): void {},
    setRuntimeContext(): void {},
    getAvailableModels(providerName?: string): Promise<RuntimeModel[]> {
      return availableModelsOrEmpty(providerName, models);
    },
    getProviderNames(): string[] {
      return ['openai', 'anthropic'];
    },
    listProviders(): string[] {
      return ['openai', 'anthropic'];
    },
  };

  expect(manager.listProviders()).toStrictEqual(['openai', 'anthropic']);
  const fetchedModels = await manager.getAvailableModels('openai');
  expect(fetchedModels).toHaveLength(2);
  expect(fetchedModels[0].id).toBe('gpt-4');
}

async function verifyProviderModels(): Promise<void> {
  const models: RuntimeModel[] = [
    {
      id: 'model-1',
      name: 'Test Model 1',
      provider: 'test-provider',
      contextWindow: 4096,
    },
    {
      id: 'model-2',
      name: 'Test Model 2',
      provider: 'test-provider',
      contextWindow: 8192,
    },
  ];

  const provider: RuntimeProvider = {
    ...providerDefaults(),
    name: 'test-provider',
    getModels(): Promise<RuntimeModel[]> {
      return Promise.resolve(models);
    },
  };

  const result = await provider.getModels();
  expect(result).toHaveLength(2);
  expect(result[0].id).toBe('model-1');
  expect(result[0].contextWindow).toBe(4096);
}
