/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for RuntimeTokenizer and RuntimeTokenizerFactory contracts.
 *
 * These tests prove that core can define and use tokenizer behavior via injection,
 * never constructing or importing provider tokenizer implementations.
 *
 * @plan:PLAN-20260603-ISSUE1584.P04
 * @requirement:REQ-TEST-001
 */

import { describe, it, expect } from 'bun:test';
import type {
  RuntimeTokenizer,
  RuntimeTokenizerFactory as RuntimeTokenizerFactoryType,
} from './RuntimeTokenizer.js';
import type { RuntimeTokenizerFactory as _RuntimeTokenizerFactory } from './RuntimeTokenizerFactory.js';

describe('RuntimeTokenizer contract', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts a structural tokenizer object implementing countTokens', () => {
    const deterministicTokenizer: RuntimeTokenizer = {
      countTokens: wordCountTokens,
    };

    const result = deterministicTokenizer.countTokens('hello world foo');
    expect(result).toBe(3);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts a structural tokenizer returning a promise from countTokens', async () => {
    const asyncTokenizer: RuntimeTokenizer = {
      countTokens: charLengthTokens,
    };

    const result = asyncTokenizer.countTokens('hello');
    expect(result).toBeInstanceOf(Promise);
    const resolved = await result;
    expect(resolved).toBe(5);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('handles empty content via injected tokenizer', () => {
    const tokenizer: RuntimeTokenizer = {
      countTokens(_content: unknown): number {
        return 0;
      },
    };

    expect(tokenizer.countTokens('')).toBe(0);
    expect(tokenizer.countTokens(null)).toBe(0);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('can be used in a history-service-style consumer without importing providers', () => {
    type HistoryEntry = { role: string; content: string };

    function countHistoryTokens(
      entries: HistoryEntry[],
      tokenizer: RuntimeTokenizer,
    ): number {
      let total = 0;
      for (const entry of entries) {
        total += tokenizer.countTokens(entry.content);
      }
      return total;
    }

    const fakeTokenizer: RuntimeTokenizer = {
      countTokens: spaceSplitTokens,
    };

    const entries: HistoryEntry[] = [
      { role: 'user', content: 'hello world' },
      { role: 'assistant', content: 'hi there friend' },
    ];

    expect(countHistoryTokens(entries, fakeTokenizer)).toBe(5);
  });
});

describe('RuntimeTokenizerFactory contract', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('returns a tokenizer for a known provider name', () => {
    const factory: RuntimeTokenizerFactoryType = {
      getTokenizer(
        providerName: string,
        _model?: string,
      ): RuntimeTokenizer | undefined {
        return tokenizerForProvider(providerName);
      },
    };

    const openaiTokenizer = factory.getTokenizer('openai');
    expect(openaiTokenizer).toBeDefined();
    expect(openaiTokenizer!.countTokens('hello')).toBe(5);

    const anthropicTokenizer = factory.getTokenizer('anthropic');
    expect(anthropicTokenizer).toBeDefined();
    expect(anthropicTokenizer!.countTokens('hello')).toBe(2);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('returns undefined for an unknown provider', () => {
    const factory: RuntimeTokenizerFactoryType = {
      getTokenizer(
        _providerName: string,
        _model?: string,
      ): RuntimeTokenizer | undefined {
        return undefined;
      },
    };

    expect(factory.getTokenizer('unknown')).toBeUndefined();
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('can accept a model hint for provider-specific tokenization', () => {
    const factory: RuntimeTokenizerFactoryType = {
      getTokenizer(
        providerName: string,
        model?: string,
      ): RuntimeTokenizer | undefined {
        return tokenizerForOpenAi(model);
      },
    };

    const modelSpecific = factory.getTokenizer('openai', 'gpt-4');
    expect(modelSpecific?.countTokens('any')).toBe(42);

    const defaultTokenizer = factory.getTokenizer('openai');
    expect(defaultTokenizer?.countTokens('any')).toBe(7);
  });
});

function wordCountTokens(content: unknown): number {
  if (typeof content === 'string') {
    return content.split(/\s+/).filter(Boolean).length;
  }
  return 0;
}

function charLengthTokens(content: unknown): number | Promise<number> {
  if (typeof content === 'string') {
    return Promise.resolve(content.length);
  }
  return 0;
}

function spaceSplitTokens(content: unknown): number {
  return typeof content === 'string' ? content.split(' ').length : 0;
}

function stringLengthTokenCount(content: unknown): number {
  return typeof content === 'string' ? content.length : 0;
}

function tokenizerForProvider(
  providerName: string,
): RuntimeTokenizer | undefined {
  if (providerName === 'openai') {
    return { countTokens: stringLengthTokenCount };
  }
  if (providerName === 'anthropic') {
    return {
      countTokens: (c: unknown) =>
        typeof c === 'string' ? Math.ceil(c.length / 4) : 0,
    };
  }
  return undefined;
}

function tokenizerForOpenAi(
  model: string | undefined,
): RuntimeTokenizer | undefined {
  if (model === 'gpt-4') {
    return { countTokens: () => 42 };
  }
  return { countTokens: () => 7 };
}
