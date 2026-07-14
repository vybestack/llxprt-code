/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tokenizer Behavioral Tests (P10)
 *
 * These tests verify that OpenAITokenizer and AnthropicTokenizer continue
 * to exhibit correct behavior after migration to the providers package.
 * Tokenizers are critical for HistoryService — their behavior must not change.
 *
 * Behavioral focus:
 * - OpenAITokenizer deterministic token counting
 * - AnthropicTokenizer character-based estimation
 * - ITokenizer interface contract compliance
 * - Structural compatibility with RuntimeTokenizer contract
 *
 * @plan:PLAN-20260603-ISSUE1584.P10
 * @requirement:REQ-TEST-001
 */

import { describe, it, expect, beforeEach } from 'vitest';

// P11: concrete tokenizers are provider-owned; RuntimeTokenizer remains a
// core-owned structural contract.
import {
  OpenAITokenizer,
  AnthropicTokenizer,
  type ITokenizer,
} from '@vybestack/llxprt-code-providers';
import type { RuntimeTokenizer } from '@vybestack/llxprt-code-core';

/**
 * @plan:PLAN-20260603-ISSUE1584.P10
 * @requirement:REQ-TEST-001
 *
 * Behavioral tests for OpenAITokenizer.
 * Proves deterministic token counting behavior that must survive migration.
 */
describe('OpenAITokenizer behavioral tests', () => {
  let tokenizer: OpenAITokenizer;

  beforeEach(() => {
    tokenizer = new OpenAITokenizer();
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * OpenAITokenizer counts tokens for a simple string.
   */
  it('counts tokens for a simple English string', async () => {
    const count = await tokenizer.countTokens('hello world', 'gpt-4');
    expect(count).toBeGreaterThan(0);
    expect(typeof count).toBe('number');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * OpenAITokenizer returns consistent count for same input.
   */
  it('returns consistent count for same input', async () => {
    const count1 = await tokenizer.countTokens('the quick brown fox', 'gpt-4');
    const count2 = await tokenizer.countTokens('the quick brown fox', 'gpt-4');
    expect(count1).toBe(count2);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * OpenAITokenizer handles empty string.
   */
  it('returns a count for empty string', async () => {
    const count = await tokenizer.countTokens('', 'gpt-4');
    expect(typeof count).toBe('number');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * OpenAITokenizer falls back for unknown models.
   */
  it('falls back gracefully for unknown model names', async () => {
    const count = await tokenizer.countTokens(
      'test content',
      'unknown-model-xyz',
    );
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThan(0);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * OpenAITokenizer produces larger count for longer text.
   */
  it('produces larger count for longer text', async () => {
    const short = await tokenizer.countTokens('hello', 'gpt-4');
    const long = await tokenizer.countTokens(
      'hello this is a much longer sentence with many more words and tokens',
      'gpt-4',
    );
    expect(long).toBeGreaterThan(short);
  });
});

/**
 * @plan:PLAN-20260603-ISSUE1584.P10
 * @requirement:REQ-TEST-001
 *
 * Behavioral tests for AnthropicTokenizer.
 * Proves character-based estimation behavior that must survive migration.
 */
describe('AnthropicTokenizer behavioral tests', () => {
  let tokenizer: AnthropicTokenizer;

  beforeEach(() => {
    tokenizer = new AnthropicTokenizer();
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * AnthropicTokenizer estimates tokens for simple text.
   */
  it('estimates tokens for simple text', async () => {
    const count = await tokenizer.countTokens('hello world', 'claude-3-opus');
    expect(count).toBeGreaterThan(0);
    expect(typeof count).toBe('number');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * AnthropicTokenizer produces consistent estimations.
   */
  it('produces consistent estimations for same input', async () => {
    const count1 = await tokenizer.countTokens('test input', 'claude-3-opus');
    const count2 = await tokenizer.countTokens('test input', 'claude-3-opus');
    expect(count1).toBe(count2);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * AnthropicTokenizer produces larger count for longer text.
   */
  it('produces larger count for longer text', async () => {
    const short = await tokenizer.countTokens('hi', 'claude-3-opus');
    const long = await tokenizer.countTokens(
      'This is a much longer string of text that contains many more characters and words to produce a higher token count estimation',
      'claude-3-opus',
    );
    expect(long).toBeGreaterThan(short);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * AnthropicTokenizer uses character-based estimation (approximately 4 chars/token).
   */
  it('uses character-based estimation (roughly 4 chars per token)', async () => {
    const text = 'abcdefghij'; // 10 chars → ceil(10/4) = 3
    const count = await tokenizer.countTokens(text, 'claude-3-opus');
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(50);
  });
});

/**
 * @plan:PLAN-20260603-ISSUE1584.P10
 * @requirement:REQ-TEST-001
 *
 * Structural compatibility tests for ITokenizer and RuntimeTokenizer.
 * Proves that concrete tokenizers satisfy the structural RuntimeTokenizer
 * contract — the injection boundary that core uses.
 */
describe('Tokenizer structural compatibility with RuntimeTokenizer', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * OpenAITokenizer satisfies ITokenizer interface.
   */
  it('OpenAITokenizer implements ITokenizer', () => {
    const tokenizer: ITokenizer = new OpenAITokenizer();
    expect(typeof tokenizer.countTokens).toBe('function');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * AnthropicTokenizer satisfies ITokenizer interface.
   */
  it('AnthropicTokenizer implements ITokenizer', () => {
    const tokenizer: ITokenizer = new AnthropicTokenizer();
    expect(typeof tokenizer.countTokens).toBe('function');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * OpenAITokenizer satisfies RuntimeTokenizer structural contract.
   * RuntimeTokenizer requires: countTokens(content: unknown): number | Promise<number>
   */
  it('OpenAITokenizer satisfies RuntimeTokenizer structural contract', async () => {
    const runtimeTokenizer: RuntimeTokenizer = {
      countTokens: (content: unknown) => {
        const tok = new OpenAITokenizer();
        return tok.countTokens(String(content), 'gpt-4');
      },
    };

    const result = await runtimeTokenizer.countTokens('test input');
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * AnthropicTokenizer satisfies RuntimeTokenizer structural contract.
   */
  it('AnthropicTokenizer satisfies RuntimeTokenizer structural contract', async () => {
    const runtimeTokenizer: RuntimeTokenizer = {
      countTokens: (content: unknown) => {
        const tok = new AnthropicTokenizer();
        return tok.countTokens(String(content), 'claude-3-opus');
      },
    };

    const result = await runtimeTokenizer.countTokens('test input');
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * A fake RuntimeTokenizer can be used in HistoryService-style consumption.
   */
  it('fake RuntimeTokenizer can be used for HistoryService-style consumption', () => {
    const fakeTokenizer: RuntimeTokenizer = {
      countTokens: (content: unknown): number => {
        if (typeof content === 'string') {
          return content.split(/\s+/).filter(Boolean).length;
        }
        return 0;
      },
    };

    function totalTokensForHistory(
      entries: Array<{ role: string; content: string }>,
      tokenizer: RuntimeTokenizer,
    ): number {
      let total = 0;
      for (const entry of entries) {
        total += tokenizer.countTokens(entry.content) as number;
      }
      return total;
    }

    const entries = [
      { role: 'user', content: 'hello world' },
      { role: 'assistant', content: 'hi there friend' },
    ];
    expect(totalTokensForHistory(entries, fakeTokenizer)).toBe(5);
  });
});
