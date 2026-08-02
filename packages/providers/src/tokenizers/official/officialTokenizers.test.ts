/**
 * Copyright 2026 Vybestack LLC
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

import { describe, expect, it, afterAll } from 'vitest';
import { KimiK3Tokenizer } from './kimiK3Tokenizer.js';
import { GlmTokenizer } from './glmTokenizer.js';
import { MinimaxTokenizer } from './minimaxTokenizer.js';
import type { RuntimeTokenizer } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizer.js';

/**
 * Shared content fixtures covering the categories from acceptance
 * criterion 2: prose, code, JSON/tool-like content, CJK, emoji/Unicode,
 * special tokens, empty input, and long input.
 */
const FIXTURES = {
  prose: 'The quick brown fox jumps over the lazy dog near the riverbank.',
  code: [
    'function fibonacci(n) {',
    '  if (n <= 1) return n;',
    '  return fibonacci(n - 1) + fibonacci(n - 2);',
    '}',
  ].join('\n'),
  json: JSON.stringify(
    {
      name: 'tool_call',
      arguments: { city: 'San Francisco', units: 'metric' },
    },
    null,
    2,
  ),
  cjk: '你好世界，机器学习正在改变我们的生活方式。',
  emoji:
    'Hello \u{1F44B}\u{1F30D}\u{1F680} Unicode \u00A7\u00B6\u2020\u2021 test \u{1F4BB}\u{2728}',
  specialTokenText: 'This text contains <|endoftext|> which must not break.',
  empty: '',
  long: 'Lorem ipsum dolor sit amet. '.repeat(500),
} as const;

const MODEL_FACTORIES: ReadonlyArray<{
  name: string;
  create: () => RuntimeTokenizer;
}> = [
  { name: 'KimiK3Tokenizer', create: () => new KimiK3Tokenizer() },
  { name: 'GlmTokenizer', create: () => new GlmTokenizer() },
  { name: 'MinimaxTokenizer', create: () => new MinimaxTokenizer() },
];

describe.each(MODEL_FACTORIES)('Official tokenizer: $name', ({ create }) => {
  const tokenizer = create();
  afterAll(() => {
    if ('dispose' in tokenizer && typeof tokenizer.dispose === 'function') {
      tokenizer.dispose();
    }
  });

  it('counts prose tokens', () => {
    const count = tokenizer.countTokens(FIXTURES.prose);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(FIXTURES.prose.length);
  });

  it('counts code tokens', () => {
    const count = tokenizer.countTokens(FIXTURES.code);
    expect(count).toBeGreaterThan(5);
  });

  it('counts JSON/tool-like content tokens', () => {
    const count = tokenizer.countTokens(FIXTURES.json);
    expect(count).toBeGreaterThan(5);
  });

  it('counts CJK text tokens (fewer tokens per character than chars)', () => {
    const count = tokenizer.countTokens(FIXTURES.cjk);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(FIXTURES.cjk.length);
  });

  it('counts emoji and Unicode content', () => {
    const count = tokenizer.countTokens(FIXTURES.emoji);
    expect(count).toBeGreaterThan(0);
  });

  it('counts text containing special-token-looking strings without error', () => {
    const count = tokenizer.countTokens(FIXTURES.specialTokenText);
    expect(count).toBeGreaterThan(0);
  });

  it('returns 0 for empty input', () => {
    expect(tokenizer.countTokens(FIXTURES.empty)).toBe(0);
  });

  it('counts long input deterministically', () => {
    const a = tokenizer.countTokens(FIXTURES.long);
    const b = tokenizer.countTokens(FIXTURES.long);
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(1000);
  });

  it('JSON-stringifies non-string content', () => {
    const obj = { key: 'value', nested: [1, 2, 3] };
    const count = tokenizer.countTokens(obj);
    expect(count).toBe(tokenizer.countTokens(JSON.stringify(obj)));
  });

  it('produces deterministic results across repeated calls', () => {
    const inputs = [
      FIXTURES.prose,
      FIXTURES.code,
      FIXTURES.cjk,
      FIXTURES.emoji,
    ];
    for (const input of inputs) {
      const a = tokenizer.countTokens(input);
      const b = tokenizer.countTokens(input);
      expect(a).toBe(b);
    }
  });
});

describe('Kimi K3 XTML segment encoding (acceptance criterion 3)', () => {
  const tokenizer = new KimiK3Tokenizer();
  afterAll(() => tokenizer.dispose());

  it('treats user text containing special-token strings as ordinary BPE', () => {
    const userText = 'The token <|endoftext|> appears in my text';
    const ordinaryCount = tokenizer.countTokens(userText);

    const segmentCount = tokenizer.countSegments([
      { text: userText, allowSpecial: false },
    ]);
    expect(segmentCount).toBe(ordinaryCount);
  });

  it('collapses known special tokens when allowSpecial is true', () => {
    const marker = '<|end_of_msg|>';
    const ordinaryCount = tokenizer.countTokens(marker);
    const specialCount = tokenizer.countSegments([
      { text: marker, allowSpecial: true },
    ]);
    expect(specialCount).toBe(1);
    expect(specialCount).toBeLessThan(ordinaryCount);
  });

  it('preserves segment ordering: structural + user + structural', () => {
    const segments = [
      { text: '<|open|>', allowSpecial: true },
      { text: 'Hello world with <|close|> in it', allowSpecial: false },
      { text: '<|close|>', allowSpecial: true },
    ];
    const count = tokenizer.countSegments(segments);
    expect(count).toBeGreaterThan(0);

    const userOrdinary = tokenizer.countTokens(
      'Hello world with <|close|> in it',
    );
    expect(count).toBe(1 + userOrdinary + 1);
  });

  it('skips empty segments without affecting the count', () => {
    const withEmpty = tokenizer.countSegments([
      { text: 'hello', allowSpecial: false },
      { text: '', allowSpecial: false },
      { text: 'world', allowSpecial: false },
    ]);
    const withoutEmpty = tokenizer.countSegments([
      { text: 'helloworld', allowSpecial: false },
    ]);
    expect(withEmpty).toBe(
      tokenizer.countTokens('hello') + tokenizer.countTokens('world'),
    );
    expect(withEmpty).not.toBe(withoutEmpty);
  });
});

/**
 * Golden token-count fixtures with exact expected counts.
 *
 * These values were computed from the pinned BPE assets at the time of
 * implementation. Any change to the BPE file, regex pattern, or special
 * token map will cause these assertions to fail, catching regressions
 * that broad-range assertions would miss.
 */
describe('Golden token-count fixtures (exact counts)', () => {
  const kimi = new KimiK3Tokenizer();
  const glm = new GlmTokenizer();
  const minimax = new MinimaxTokenizer();
  afterAll(() => {
    kimi.dispose();
    glm.dispose();
    minimax.dispose();
  });

  it('prose: exact counts match pinned BPE output', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    expect(kimi.countTokens(text)).toBe(10);
    expect(glm.countTokens(text)).toBe(10);
    expect(minimax.countTokens(text)).toBe(10);
  });

  it('code: exact counts match pinned BPE output', () => {
    const text = 'function add(a, b) { return a + b; }';
    expect(kimi.countTokens(text)).toBe(13);
    expect(glm.countTokens(text)).toBe(13);
    expect(minimax.countTokens(text)).toBe(13);
  });

  it('JSON/tool-like: exact counts match pinned BPE output', () => {
    const text = '{"name":"test","value":42,"active":true}';
    expect(kimi.countTokens(text)).toBe(13);
    expect(glm.countTokens(text)).toBe(13);
    expect(minimax.countTokens(text)).toBe(13);
  });

  it('CJK: exact counts match pinned BPE output', () => {
    const text = '你好世界，这是一个中文测试。';
    expect(kimi.countTokens(text)).toBe(7);
    expect(glm.countTokens(text)).toBe(7);
    expect(minimax.countTokens(text)).toBe(6);
  });

  it('emoji/Unicode: exact counts match pinned BPE output', () => {
    const text =
      'Hello \u{1F44B} World \u{1F30D} emoji test \u{1F600}\u{1F389}';
    expect(kimi.countTokens(text)).toBe(13);
    expect(glm.countTokens(text)).toBe(11);
    expect(minimax.countTokens(text)).toBe(11);
  });

  /**
   * Guards against every family silently resolving to the same BPE asset.
   *
   * Short ASCII converges across these vocabularies, so agreement there is
   * expected and proves nothing. CJK and emoji exercise the parts of each
   * vocabulary that genuinely differ, so at least one family must disagree.
   */
  it('distinct vocabularies produce distinct counts on CJK and emoji', () => {
    const cjk = '人工智能正在改变世界，深度学习模型需要大量的计算资源。';
    const cjkCounts = [
      kimi.countTokens(cjk),
      glm.countTokens(cjk),
      minimax.countTokens(cjk),
    ];
    expect(new Set(cjkCounts).size).toBeGreaterThan(1);

    // Escape sequences keep the astral-plane code points intact in source.
    const emoji =
      'Deploy \u{1F680} the model \u{1F916} now! \u{1F389}\u{1F389}\u{1F389}';
    const emojiCounts = [
      kimi.countTokens(emoji),
      glm.countTokens(emoji),
      minimax.countTokens(emoji),
    ];
    expect(new Set(emojiCounts).size).toBe(3);
  });
});
