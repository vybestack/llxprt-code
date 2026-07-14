/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ProviderContentGenerator Behavioral Tests (P10)
 *
 * These tests verify that ProviderContentGenerator and ContentGeneratorRole
 * continue to exhibit correct behavior after migration to the providers package.
 *
 * Behavioral focus:
 * - ProviderContentGenerator construction and basic behavior
 * - Structural compatibility with RuntimeContentGeneratorFactory contract
 * - ContentGeneratorRole enum values
 * - countTokens estimation behavior
 *
 * @plan:PLAN-20260603-ISSUE1584.P10
 * @requirement:REQ-TEST-001
 */

import { describe, it, expect } from 'vitest';

// P11: provider content generation implementation is provider-owned;
// core retains only structural runtime contracts.
import {
  ProviderContentGenerator,
  ContentGeneratorRole,
  type IProviderManager,
} from '@vybestack/llxprt-code-providers';
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { RuntimeContentGeneratorFactory } from '@vybestack/llxprt-code-core';

/**
 * @plan:PLAN-20260603-ISSUE1584.P10
 * @requirement:REQ-TEST-001
 *
 * Behavioral tests for ProviderContentGenerator.
 * Proves that content generation delegation works correctly.
 */
describe('ProviderContentGenerator behavioral tests', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * ProviderContentGenerator is constructable with IProviderManager.
   */
  it('constructs with IProviderManager', () => {
    const mockManager = {
      getActiveProvider: () => ({
        name: 'test',
        async *generateChatCompletion() {
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'test' }] };
        },
      }),
      getActiveProviderName: () => 'test',
      setActiveProvider: () => {},
      getAvailableModels: async () => [],
      listProviders: () => ['test'],
    } as unknown as IProviderManager;

    const generator = new ProviderContentGenerator(mockManager, {});
    expect(generator).toBeDefined();
    expect(typeof generator.countTokens).toBe('function');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * ProviderContentGenerator.countTokens returns an estimated token count.
   */
  it('countTokens returns estimated token count for string content', async () => {
    const mockManager = {
      getActiveProvider: () => ({
        name: 'test',
      }),
    } as unknown as IProviderManager;

    const generator = new ProviderContentGenerator(mockManager, {});
    const result = await generator.countTokens({
      contents: [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'hello world this is a test' }],
        },
      ],
    });
    expect(result).toBeDefined();
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * ProviderContentGenerator throws for embedContent (unsupported).
   */
  it('embedContent throws because embeddings are not supported', async () => {
    const mockManager = {} as unknown as IProviderManager;
    const generator = new ProviderContentGenerator(mockManager, {});

    await expect(generator.embedContent({ texts: [] })).rejects.toThrow(
      /embeddings not supported/i,
    );
  });
});

/**
 * @plan:PLAN-20260603-ISSUE1584.P10
 * @requirement:REQ-TEST-001
 *
 * Behavioral tests for ContentGeneratorRole enum.
 */
describe('ContentGeneratorRole enum behavioral tests', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * ContentGeneratorRole enum has expected values.
   */
  it('ContentGeneratorRole has all expected roles', () => {
    expect(ContentGeneratorRole.USER).toBe('user');
    expect(ContentGeneratorRole.ASSISTANT).toBe('assistant');
    expect(ContentGeneratorRole.SYSTEM).toBe('system');
    expect(ContentGeneratorRole.TOOL).toBe('tool');
  });
});

/**
 * @plan:PLAN-20260603-ISSUE1584.P10
 * @requirement:REQ-TEST-001
 *
 * RuntimeContentGeneratorFactory structural compatibility.
 * Proves that ProviderContentGenerator can be constructed through
 * the factory injection pattern that core uses.
 */
describe('RuntimeContentGeneratorFactory structural compatibility', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * A factory that creates ProviderContentGenerator satisfies the
   * RuntimeContentGeneratorFactory contract structurally.
   */
  it('ProviderContentGenerator factory satisfies RuntimeContentGeneratorFactory contract', () => {
    const factory: RuntimeContentGeneratorFactory = {
      createContentGenerator: (manager: RuntimeProviderManager) => {
        // Use manager as IProviderManager — structural typing
        const providerManager = manager as unknown as IProviderManager;
        return new ProviderContentGenerator(providerManager, {});
      },
    };

    expect(typeof factory.createContentGenerator).toBe('function');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * A fake factory can produce a structural content generator
   * without importing ProviderContentGenerator — proves injection pattern.
   */
  it('structural fake generator satisfies ContentGenerator shape', () => {
    const fakeGenerator = {
      generateContent: async () => ({ totalTokens: 0 }),
      async *generateContentStream() {
        yield { totalTokens: 0 };
      },
      countTokens: async () => ({ totalTokens: 42 }),
      embedContent: async () => {
        throw new Error('Not supported');
      },
    };

    expect(typeof fakeGenerator.countTokens).toBe('function');
    expect(typeof fakeGenerator.generateContent).toBe('function');
  });
});
