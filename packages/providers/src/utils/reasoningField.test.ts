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
 *
 * @issue #2524 — Shared reasoning-field resolution for OpenAI-compatible providers.
 */

import { describe, it, expect } from 'bun:test';
import {
  resolveReasoningField,
  normalizeReasoningFieldName,
  isUsableReasoningValue,
} from './reasoningField.js';

describe('resolveReasoningField — shared fallback policy (#2524)', () => {
  it('captures configured explicit field when present', () => {
    const result = resolveReasoningField({
      fieldName: 'reasoning',
      delta: { reasoning: 'x' },
    });
    expect(result).toStrictEqual({
      value: 'x',
      actualFieldName: 'reasoning',
    });
  });

  it('returns undefined when configured field is absent (no fallback)', () => {
    const result = resolveReasoningField({
      fieldName: 'custom',
      delta: { reasoning_content: 'y' },
    });
    expect(result).toBeUndefined();
  });

  it('treats empty-string field name as unset', () => {
    const result = resolveReasoningField({
      fieldName: '',
      delta: { reasoning_content: 'z' },
    });
    expect(result).toStrictEqual({
      value: 'z',
      actualFieldName: 'reasoning_content',
    });
  });

  it('treats whitespace-only field name as unset', () => {
    const result = resolveReasoningField({
      fieldName: '  ',
      delta: { reasoning_content: 'z' },
    });
    expect(result).toStrictEqual({
      value: 'z',
      actualFieldName: 'reasoning_content',
    });
  });

  it('trims a whitespace-padded field name', () => {
    const result = resolveReasoningField({
      fieldName: '  reasoning  ',
      delta: { reasoning: 'w' },
    });
    expect(result).toStrictEqual({
      value: 'w',
      actualFieldName: 'reasoning',
    });
  });

  it('falls back to delta.reasoning when primary is empty string (unset field)', () => {
    const result = resolveReasoningField({
      fieldName: undefined,
      delta: { reasoning_content: '', reasoning: 'fb' },
    });
    expect(result).toStrictEqual({
      value: 'fb',
      actualFieldName: 'reasoning',
    });
  });

  it('falls back to delta.reasoning when primary is null (unset field)', () => {
    const result = resolveReasoningField({
      fieldName: undefined,
      delta: { reasoning_content: null, reasoning: 'fb' },
    });
    expect(result).toStrictEqual({
      value: 'fb',
      actualFieldName: 'reasoning',
    });
  });

  it('falls back to delta.reasoning when primary is undefined (unset field)', () => {
    const result = resolveReasoningField({
      fieldName: undefined,
      delta: { reasoning: 'fb' },
    });
    expect(result).toStrictEqual({
      value: 'fb',
      actualFieldName: 'reasoning',
    });
  });

  it('falls back to delta.reasoning when primary is a non-string object (unset field)', () => {
    const result = resolveReasoningField({
      fieldName: undefined,
      delta: { reasoning_content: { x: 1 }, reasoning: 'fb' },
    });
    expect(result).toStrictEqual({
      value: 'fb',
      actualFieldName: 'reasoning',
    });
  });

  it('preserves whitespace-only primary as usable (no fallback, issue #721)', () => {
    const result = resolveReasoningField({
      fieldName: undefined,
      delta: { reasoning_content: '  ', reasoning: 'fb' },
    });
    expect(result).toStrictEqual({
      value: '  ',
      actualFieldName: 'reasoning_content',
    });
  });

  it('captures standard-provider default field when present', () => {
    const result = resolveReasoningField({
      fieldName: undefined,
      delta: { reasoning_content: 'std' },
    });
    expect(result).toStrictEqual({
      value: 'std',
      actualFieldName: 'reasoning_content',
    });
  });

  it('prefers primary over fallback when both present and field unset', () => {
    const result = resolveReasoningField({
      fieldName: undefined,
      delta: { reasoning_content: 'std', reasoning: 'fb' },
    });
    expect(result).toStrictEqual({
      value: 'std',
      actualFieldName: 'reasoning_content',
    });
  });

  it('does not fall back when explicit field has non-usable value', () => {
    const result = resolveReasoningField({
      fieldName: 'custom',
      delta: { custom: '', reasoning: 'fb' },
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when no reasoning is present anywhere', () => {
    const result = resolveReasoningField({
      fieldName: undefined,
      delta: { content: 'hi' },
    });
    expect(result).toBeUndefined();
  });
});

describe('normalizeReasoningFieldName', () => {
  it('returns undefined for undefined input', () => {
    expect(normalizeReasoningFieldName(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(normalizeReasoningFieldName('')).toBeUndefined();
  });

  it('returns undefined for whitespace-only string', () => {
    expect(normalizeReasoningFieldName('   ')).toBeUndefined();
  });

  it('trims and returns non-empty field name', () => {
    expect(normalizeReasoningFieldName('  reasoning  ')).toBe('reasoning');
  });

  it('returns already-trimmed field name as-is', () => {
    expect(normalizeReasoningFieldName('reasoning')).toBe('reasoning');
  });
});

describe('isUsableReasoningValue', () => {
  it('returns true for non-empty string', () => {
    expect(isUsableReasoningValue('hello')).toBe(true);
  });

  it('returns true for whitespace-only string (issue #721)', () => {
    expect(isUsableReasoningValue('  ')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isUsableReasoningValue('')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isUsableReasoningValue(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isUsableReasoningValue(undefined)).toBe(false);
  });

  it('returns false for non-string object', () => {
    expect(isUsableReasoningValue({ x: 1 })).toBe(false);
  });
});
