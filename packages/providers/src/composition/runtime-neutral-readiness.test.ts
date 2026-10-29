/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import fs from 'node:fs';
import * as tiktoken from '@dqbd/tiktoken';
import { estimateTokens } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { NeutralTextStream } from '@vybestack/llxprt-code-core/utils/neutral-text-stream.js';
import { createRuntimeTokenizerFactory } from './runtimeTokenizerFactory.js';

describe('runtime neutral tokenizer readiness', () => {
  it('prepares history and usage counters before an unsupported provider becomes ready', async () => {
    const text = 'hello world';
    const oracle = tiktoken.get_encoding('o200k_base');
    const expected = oracle.encode(text).length;
    const prompt =
      'Read "the instructions" and complete the operation. '.repeat(40);
    const expectedPrompt = oracle.encode(prompt).length;
    oracle.free();
    const factory = createRuntimeTokenizerFactory();
    await factory.prepareTokenizer?.('fake', 'fake-model');
    const encoder = spyOn(tiktoken, 'encoding_for_model').mockImplementation(
      () => {
        throw new Error('Encoder initialization after readiness');
      },
    );
    const assets = spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('Tokenizer asset read after readiness');
    });
    try {
      expect(estimateTokens(text)).toBe(expected);
      expect(estimateTokens(prompt)).toBe(expectedPrompt);
      const stream = new NeutralTextStream();
      stream.append(Buffer.from(text));
      expect(stream.finish()).toBe(expected);
      expect(factory.getTokenizer('fake', 'fake-model')).toBeUndefined();
    } finally {
      assets.mockRestore();
      encoder.mockRestore();
    }
  });
});
