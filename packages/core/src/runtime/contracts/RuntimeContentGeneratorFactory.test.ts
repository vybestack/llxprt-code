/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for RuntimeContentGeneratorFactory contract.
 *
 * Proves that core can receive a content generator through factory injection
 * without importing ProviderContentGenerator or the providers package.
 *
 * @plan:PLAN-20260603-ISSUE1584.P04
 * @requirement:REQ-TEST-001
 */

import { describe, it, expect } from 'vitest';
import type { RuntimeContentGeneratorFactory } from './RuntimeContentGeneratorFactory.js';
import type { RuntimeProviderManager } from './RuntimeProviderManager.js';
import type { RuntimeProvider } from './RuntimeProvider.js';

describe('RuntimeContentGeneratorFactory contract', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('creates a content generator from a provider manager', () => {
    const fakeProvider: RuntimeProvider = { name: 'openai' };

    const fakeManager: RuntimeProviderManager = {
      getActiveProvider(): RuntimeProvider | undefined {
        return fakeProvider;
      },
      getActiveProviderName(): string | undefined {
        return 'openai';
      },
      setActiveProvider(): void {},
      setRuntimeContext(): void {},
      getAvailableModels(): Promise<unknown[]> {
        return Promise.resolve([]);
      },
      listProviders(): string[] {
        return ['openai'];
      },
    };

    const fakeContentGenerator = {
      generate: (prompt: string) => `response to: ${prompt}`,
    };

    const factory: RuntimeContentGeneratorFactory<typeof fakeContentGenerator> =
      {
        createContentGenerator(
          manager: RuntimeProviderManager,
        ): typeof fakeContentGenerator {
          const providerName = manager.getActiveProviderName();
          expect(providerName).toStrictEqual('openai');
          return fakeContentGenerator;
        },
      };

    const generator = factory.createContentGenerator(fakeManager);
    expect(generator.generate('test')).toBe('response to: test');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts a factory returning unknown generator type', () => {
    const factory: RuntimeContentGeneratorFactory = {
      createContentGenerator(_manager: RuntimeProviderManager): unknown {
        return { stream: true, model: 'test-model' };
      },
    };

    const manager: RuntimeProviderManager = {
      getActiveProvider(): RuntimeProvider | undefined {
        return undefined;
      },
      getActiveProviderName(): string | undefined {
        return undefined;
      },
      setActiveProvider(): void {},
      setRuntimeContext(): void {},
      getAvailableModels(): Promise<unknown[]> {
        return Promise.resolve([]);
      },
      listProviders(): string[] {
        return [];
      },
    };

    const generator = factory.createContentGenerator(manager);
    expect(generator).toStrictEqual({ stream: true, model: 'test-model' });
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('can be used in content generation flow without importing provider package', () => {
    interface FakeStreamResult {
      chunks: string[];
    }

    const fakeGenerator: FakeStreamResult = {
      chunks: ['Hello', ' ', 'world'],
    };

    const factory: RuntimeContentGeneratorFactory<FakeStreamResult> = {
      createContentGenerator(
        _manager: RuntimeProviderManager,
      ): FakeStreamResult {
        return fakeGenerator;
      },
    };

    const manager: RuntimeProviderManager = {
      getActiveProvider(): RuntimeProvider | undefined {
        return undefined;
      },
      getActiveProviderName(): string | undefined {
        return 'test';
      },
      setActiveProvider(): void {},
      setRuntimeContext(): void {},
      getAvailableModels(): Promise<unknown[]> {
        return Promise.resolve([]);
      },
      listProviders(): string[] {
        return ['test'];
      },
    };

    const result = factory.createContentGenerator(manager);
    expect(result.chunks).toStrictEqual(['Hello', ' ', 'world']);
  });
});
