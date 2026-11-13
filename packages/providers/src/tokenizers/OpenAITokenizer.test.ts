/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { get_encoding } from '@dqbd/tiktoken';
import { OpenAITokenizer } from './OpenAITokenizer.js';

describe('OpenAI tokenizer instance-owned encoding facts', () => {
  it('matches the pinned codec for short, Unicode and long pieces across tokenizer instances', async () => {
    const oracle = get_encoding('o200k_base');
    const first = new OpenAITokenizer();
    const second = new OpenAITokenizer();
    try {
      for (const text of ['hello world', '雪 café 👩🏽‍💻', 'a'.repeat(8193)]) {
        const expected = oracle.encode(text).length;
        expect(await first.countTokens(text, 'gpt-4o-mini')).toBe(expected);
        expect(await second.countTokens(text, 'gpt-4o-mini')).toBe(expected);
      }
    } finally {
      first.dispose();
      second.dispose();
      oracle.free();
    }
  });
});
