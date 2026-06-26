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

import { describe, it, expect } from 'vitest';
import type {
  RuntimeProvider,
  RuntimeToolDeclaration,
  RuntimeToolset,
} from './RuntimeProvider.js';
import type { RuntimeProviderManager } from './RuntimeProviderManager.js';
import type { RuntimeModel } from './RuntimeModel.js';

describe('RuntimeProvider contract', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts a structural provider with name property', () => {
    const provider: RuntimeProvider = {
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
  it('accepts a structural provider with getModels returning RuntimeModel array', async () => {
    const models: RuntimeModel[] = [
      { id: 'model-1', name: 'Test Model 1', contextWindow: 4096 },
      { id: 'model-2', name: 'Test Model 2', contextWindow: 8192 },
    ];

    const provider: RuntimeProvider = {
      name: 'test-provider',
      getModels(): Promise<RuntimeModel[]> {
        return Promise.resolve(models);
      },
    };

    const result = await provider.getModels();
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('model-1');
    expect(result[0].contextWindow).toBe(4096);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts a provider with generateChatCompletion that yields chunks', async () => {
    const chunks = [
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
    ];

    const provider: RuntimeProvider = {
      name: 'test-provider',
      generateChatCompletion(
        _messages: unknown[],
        _tools?: RuntimeToolset[],
        _options?: unknown,
      ): AsyncIterable<unknown> {
        async function* yieldChunks() {
          for (const chunk of chunks) {
            yield chunk;
          }
        }
        return yieldChunks();
      },
    };

    const stream = provider.generateChatCompletion([], []);
    const collected: unknown[] = [];
    for await (const chunk of stream as AsyncIterable<unknown>) {
      collected.push(chunk);
    }
    expect(collected).toHaveLength(2);
    expect((collected[0] as { text: string }).text).toBe('Hello');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts a minimal provider with only required name field', () => {
    const provider: RuntimeProvider = {
      name: 'minimal',
    };

    expect(provider.name).toBe('minimal');
    expect(provider.getCurrentModel).toBeUndefined();
    expect(provider.getModels).toBeUndefined();
    expect(provider.setModel).toBeUndefined();
    expect(provider.generateChatCompletion).toBeUndefined();
  });
});

describe('RuntimeToolDeclaration and RuntimeToolset', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts tool declarations with name and optional fields', () => {
    const declaration: RuntimeToolDeclaration = {
      name: 'read_file',
      description: 'Read a file',
      parametersJsonSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
      },
    };

    expect(declaration.name).toBe('read_file');
    expect(declaration.description).toBe('Read a file');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts tool declarations with minimal required fields', () => {
    const declaration: RuntimeToolDeclaration = {
      name: 'simple_tool',
    };

    expect(declaration.name).toBe('simple_tool');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts a toolset with function declarations', () => {
    const toolset: RuntimeToolset = {
      functionDeclarations: [
        { name: 'tool_a' },
        { name: 'tool_b', description: 'Tool B' },
      ],
    };

    expect(toolset.functionDeclarations).toHaveLength(2);
    expect(toolset.functionDeclarations[1].description).toBe('Tool B');
  });
});

describe('RuntimeProviderManager contract', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts a structural manager that returns active provider', () => {
    const fakeProvider: RuntimeProvider = { name: 'openai' };

    const manager: RuntimeProviderManager = {
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
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts a manager that lists providers and models', async () => {
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
      getActiveProvider(): RuntimeProvider | undefined {
        return undefined;
      },
      getActiveProviderName(): string | undefined {
        return undefined;
      },
      setActiveProvider(_name: string): void {},
      setRuntimeContext(): void {},
      getAvailableModels(providerName?: string): Promise<RuntimeModel[]> {
        if (!providerName || providerName === 'openai') {
          return Promise.resolve(models);
        }
        return Promise.resolve([]);
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
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('returns undefined when no active provider is set', () => {
    const manager: RuntimeProviderManager = {
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
