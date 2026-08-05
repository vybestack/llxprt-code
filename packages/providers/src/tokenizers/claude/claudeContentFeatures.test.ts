/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  CLAUDE_CONTENT_FEATURE_NAMES,
  extractClaudeContentFeatures,
  type ClaudeContentFeatures,
} from './claudeContentFeatures.js';

const SAMPLES: Readonly<Record<string, string>> = {
  prose: 'The quick brown fox jumps over the lazy dog before dusk.',
  code: 'function f(a){return [a?.b ?? {c: 1}, `x${a}`];} // done',
  json: '{"id":7,"tags":["alpha","beta"],"meta":{"weight":1.5,"on":true}}',
  cjk: '日本語のテキストです。한국어 텍스트입니다. Русский текст. Ελληνικό κείμενο. العربية.',
  emoji: 'ship it 🚀🇯🇵👩‍👩‍👧‍👦 done',
  combining: 'a\u0301e\u0300i\u0302o\u0303u\u0308 café mañana',
  markdown:
    '# Title\n\n- item `code`\n\n```json\n{"a": 1}\n```\n\n> quote 日本語\n',
};

function sumFeatures(
  parts: readonly ClaudeContentFeatures[],
): ClaudeContentFeatures {
  return parts.reduce((total, part) => ({
    codePoints: total.codePoints + part.codePoints,
    nonAsciiCodePoints: total.nonAsciiCodePoints + part.nonAsciiCodePoints,
    structuralCodePoints:
      total.structuralCodePoints + part.structuralCodePoints,
    whitespaceCodePoints:
      total.whitespaceCodePoints + part.whitespaceCodePoints,
  }));
}

/** Every offset that lands on a code-point boundary. */
function codePointBoundaries(text: string): readonly number[] {
  const boundaries: number[] = [];
  for (let index = 0; index <= text.length; index += 1) {
    if (index === 0 || index === text.length) {
      boundaries.push(index);
      continue;
    }
    const unit = text.charCodeAt(index);
    const isLowSurrogate = unit >= 0xdc00 && unit <= 0xdfff;
    const previous = text.charCodeAt(index - 1);
    const previousIsHigh = previous >= 0xd800 && previous <= 0xdbff;
    if (!(isLowSurrogate && previousIsHigh)) boundaries.push(index);
  }
  return boundaries;
}

describe('one-pass Claude content features', () => {
  it('returns zeroed, frozen features for empty input', () => {
    const features = extractClaudeContentFeatures('');
    expect(features).toEqual({
      codePoints: 0,
      nonAsciiCodePoints: 0,
      structuralCodePoints: 0,
      whitespaceCodePoints: 0,
    });
    expect(Object.isFrozen(features)).toBe(true);
  });

  it('exposes exactly the declared feature names', () => {
    expect(Object.keys(extractClaudeContentFeatures('abc')).sort()).toEqual(
      [...CLAUDE_CONTENT_FEATURE_NAMES].sort(),
    );
  });

  it.each(Object.entries(SAMPLES))(
    'is additive across every code-point boundary of %s content',
    (_name, text) => {
      const whole = extractClaudeContentFeatures(text);
      for (const boundary of codePointBoundaries(text)) {
        const parts = [
          extractClaudeContentFeatures(text.slice(0, boundary)),
          extractClaudeContentFeatures(text.slice(boundary)),
        ];
        expect(sumFeatures(parts)).toEqual(whole);
      }
    },
  );

  it('is additive across a three-way split of mixed content', () => {
    const text = SAMPLES.markdown + SAMPLES.cjk + SAMPLES.code;
    const whole = extractClaudeContentFeatures(text);
    const a = text.slice(0, 17);
    const b = text.slice(17, 41);
    const c = text.slice(41);
    expect(
      sumFeatures([
        extractClaudeContentFeatures(a),
        extractClaudeContentFeatures(b),
        extractClaudeContentFeatures(c),
      ]),
    ).toEqual(whole);
  });

  it('counts astral characters once, not once per UTF-16 unit', () => {
    const rocket = '🚀';
    expect(rocket.length).toBe(2);
    const features = extractClaudeContentFeatures(rocket);
    expect(features.codePoints).toBe(1);
    expect(features.nonAsciiCodePoints).toBe(1);
  });

  it('counts a family emoji sequence by code point', () => {
    const family = '👩‍👩‍👧‍👦';
    const features = extractClaudeContentFeatures(family);
    expect(features.codePoints).toBe([...family].length);
    expect(features.nonAsciiCodePoints).toBe(features.codePoints);
  });

  it('counts combining marks as their own code points', () => {
    const precomposed = extractClaudeContentFeatures('é');
    const decomposed = extractClaudeContentFeatures('e\u0301');
    expect(precomposed.codePoints).toBe(1);
    expect(decomposed.codePoints).toBe(2);
    expect(decomposed.nonAsciiCodePoints).toBe(1);
  });

  it('tolerates an unpaired surrogate as a single code point', () => {
    const lone = extractClaudeContentFeatures('a\uD83Db');
    expect(lone.codePoints).toBe(3);
    expect(lone.nonAsciiCodePoints).toBe(1);
  });

  it('classifies ASCII whitespace and structural punctuation disjointly', () => {
    const features = extractClaudeContentFeatures('{"a": 1}\n\tb');
    expect(features.codePoints).toBe(11);
    expect(features.whitespaceCodePoints).toBe(3);
    expect(features.structuralCodePoints).toBe(5);
    expect(features.nonAsciiCodePoints).toBe(0);
    expect(
      features.whitespaceCodePoints +
        features.structuralCodePoints +
        features.nonAsciiCodePoints,
    ).toBeLessThanOrEqual(features.codePoints);
  });

  it('never classifies a non-ASCII code point as structural or whitespace', () => {
    const features = extractClaudeContentFeatures('日本、【】　〜');
    expect(features.nonAsciiCodePoints).toBe(features.codePoints);
    expect(features.structuralCodePoints).toBe(0);
    expect(features.whitespaceCodePoints).toBe(0);
  });

  it('is deterministic for repeated extraction of long input', () => {
    const long = SAMPLES.markdown.repeat(2000);
    expect(extractClaudeContentFeatures(long)).toEqual(
      extractClaudeContentFeatures(long),
    );
    expect(extractClaudeContentFeatures(long).codePoints).toBe(
      [...long].length,
    );
  });
});
