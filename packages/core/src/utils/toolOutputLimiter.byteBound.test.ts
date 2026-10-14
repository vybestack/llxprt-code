/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it, vi } from 'bun:test';
import { encoding_for_model } from '@dqbd/tiktoken';
import {
  estimateTokens,
  getEffectiveTokenLimit,
  limitOutputTokensWithLimits,
} from './toolOutputLimiter.js';

describe('limitOutputTokensWithLimits byte bound', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function spyOnEncode(): ReturnType<typeof vi.spyOn> {
    estimateTokens('warm the cached encoder');
    const probe = encoding_for_model('gpt-4o');
    const prototype: object = Object.getPrototypeOf(probe);
    probe.free();
    return vi.spyOn(prototype as { encode: () => Uint32Array }, 'encode');
  }

  it('passes output without tokenizing it when its bytes already fit the limit', () => {
    const encode = spyOnEncode();
    const limit = {
      tokenLimit: { kind: 'limited', maxTokens: 1000 },
    } as const;
    const content = 'x'.repeat(getEffectiveTokenLimit(1000));
    expect(limitOutputTokensWithLimits(content, limit, 'tool')).toStrictEqual({
      content,
      wasTruncated: false,
    });
    expect(encode).not.toHaveBeenCalled();
  });

  it('counts bytes, not UTF-16 units, before skipping the tokenizer', () => {
    const encode = spyOnEncode();
    const limit = {
      tokenLimit: { kind: 'limited', maxTokens: 100 },
    } as const;
    // 40 three-byte characters are 120 bytes, over the 80-token effective limit.
    const content = '€'.repeat(40);
    limitOutputTokensWithLimits(content, limit, 'tool');
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it('still truncates output whose token count exceeds the limit', () => {
    const limit = {
      tokenLimit: { kind: 'limited', maxTokens: 50 },
      truncateMode: 'truncate',
    } as const;
    const content = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
    const result = limitOutputTokensWithLimits(content, limit, 'tool');
    expect(result.wasTruncated).toBe(true);
  });
});
