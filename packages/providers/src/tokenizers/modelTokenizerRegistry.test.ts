/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, expect, it } from 'vitest';
import {
  getRegisteredTokenizer,
  isRegisteredModel,
  getRegisteredModelNames,
  createRegisteredTokenizerFactory,
} from './modelTokenizerRegistry.js';
import type { RuntimeTokenizer } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizer.js';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';

describe('modelTokenizerRegistry — anchored registrations (criterion 1)', () => {
  const SANCTIONED = ['kimi-k3', 'k3-256k', 'glm-5.2', 'minimax-m3'];

  it('registers exactly the sanctioned model names', () => {
    expect(getRegisteredModelNames().sort()).toStrictEqual(
      [...SANCTIONED].sort(),
    );
  });

  it('resolves each sanctioned model to a tokenizer', () => {
    for (const model of SANCTIONED) {
      const tokenizer = getRegisteredTokenizer(model);
      expect(tokenizer).toBeDefined();
      expect(typeof tokenizer?.countTokens).toBe('function');
    }
  });

  it('does NOT resolve near-miss names', () => {
    const nearMisses = [
      'kimi-k4',
      'kimi-k3-instruct',
      'kimi-k2',
      'kimi-for-coding',
      'glm-5',
      'glm-4',
      'glm-5.2-chat',
      'minimax-m2',
      'minimax-m3-instruct',
      'minimax-text-01',
      'kimi',
      'glm',
      'minimax',
      'kimi_k3',
    ];
    for (const name of nearMisses) {
      expect(getRegisteredTokenizer(name)).toBeUndefined();
      expect(isRegisteredModel(name)).toBe(false);
    }
  });

  it('resolves case-insensitively (providers return mixed-case model names)', () => {
    expect(getRegisteredTokenizer('Kimi-K3')).toBeDefined();
    expect(getRegisteredTokenizer('GLM-5.2')).toBeDefined();
    expect(getRegisteredTokenizer('MiniMax-M3')).toBeDefined();
    expect(isRegisteredModel('KIMI-K3')).toBe(true);
  });

  it('isRegisteredModel returns true only for exact matches', () => {
    for (const model of SANCTIONED) {
      expect(isRegisteredModel(model)).toBe(true);
    }
  });

  it('caches tokenizer instances (same identity on repeated calls)', () => {
    const a = getRegisteredTokenizer('kimi-k3');
    const b = getRegisteredTokenizer('kimi-k3');
    expect(a).toBe(b);
  });
});

describe('createRegisteredTokenizerFactory', () => {
  const fakeTokenizer: RuntimeTokenizer = {
    countTokens: () => 42,
  };
  const fallback: RuntimeTokenizerFactory = {
    getTokenizer: () => fakeTokenizer,
  };
  const factory = createRegisteredTokenizerFactory(fallback);

  it('returns the registered tokenizer for anchored models', () => {
    const tokenizer = factory.getTokenizer('kimi', 'kimi-k3');
    expect(tokenizer).toBeDefined();
    // Registered tokenizers use official BPE, not the fake 42-count.
    const count = tokenizer!.countTokens('hello world');
    expect(count).not.toBe(42);
  });

  it('delegates to fallback for unregistered models', () => {
    const tokenizer = factory.getTokenizer('openai', 'gpt-4o');
    expect(tokenizer).toBeDefined();
    expect(tokenizer!.countTokens('test')).toBe(42);
  });

  it('returns undefined when neither registered nor fallback matches', () => {
    const noFallback = createRegisteredTokenizerFactory(undefined);
    const tokenizer = noFallback.getTokenizer('unknown', 'unknown-model');
    expect(tokenizer).toBeUndefined();
  });

  it('checks registration by model name, not provider name', () => {
    // "kimi-k3" as model on any provider should resolve.
    const tokenizer = factory.getTokenizer('fireworks', 'kimi-k3');
    expect(tokenizer).toBeDefined();
    const count = tokenizer!.countTokens('hello');
    expect(count).not.toBe(42);
  });
});
