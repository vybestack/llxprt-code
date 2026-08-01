/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @issue #2896 - The model config dialog wrote numeric model params as
 * strings (`"top_p": ".95"`), which OpenRouter rejects with
 * `top_p: Invalid input: expected number, received string`.
 *
 * These tests drive the real commit path the dialog uses (real `parseValue`,
 * real settings registry) and assert on what the runtime actually receives.
 *
 * Acceptance rows covered: A4, A5, A6.
 */

import { describe, it, expect } from 'vitest';
import {
  commitModelParam,
  NOT_A_NUMBER_MESSAGE,
} from './modelConfigParamCommit.js';

/** Captures exactly what the dialog would write into the runtime. */
function recorder() {
  const writes: unknown[] = [];
  return {
    writes,
    set: (value: unknown) => {
      writes.push(value);
    },
  };
}

describe('commitModelParam (issue #2896)', () => {
  // A4 — the exact input from the bug report.
  it('A4: commits ".95" for top_p as the number 0.95', () => {
    const r = recorder();
    const result = commitModelParam('top_p', '.95', r.set);

    expect(result.success).toBe(true);
    expect(r.writes).toStrictEqual([0.95]);
    expect(typeof r.writes[0]).toBe('number');
  });

  it('A4: commits "0.95" for top_p as the number 0.95', () => {
    const r = recorder();
    commitModelParam('top_p', '0.95', r.set);
    expect(r.writes).toStrictEqual([0.95]);
  });

  it('A4: commits negative and exponent forms as numbers', () => {
    const r = recorder();
    commitModelParam('presence_penalty', '-.5', r.set);
    commitModelParam('temperature', '1e-5', r.set);
    expect(r.writes).toStrictEqual([-0.5, 1e-5]);
  });

  // A5 — non-numeric input must be rejected, not written as a string.
  it('A5: rejects "abc" for top_p and writes nothing', () => {
    const r = recorder();
    const result = commitModelParam('top_p', 'abc', r.set);

    expect(result.success).toBe(false);
    expect(result.message).toBe(NOT_A_NUMBER_MESSAGE);
    expect(r.writes).toStrictEqual([]);
  });

  // '1e400' and '-1e400' are syntactically valid numbers that overflow to
  // +/-Infinity, which JSON-serializes to null — the finite guard must reject
  // them rather than write an unusable value.
  it.each([
    '.',
    '-',
    '-.',
    '1.2.3',
    'Infinity',
    'NaN',
    '0x10',
    '1_000',
    '1e400',
    '-1e400',
  ])('A5: rejects %j for top_p and writes nothing', (raw) => {
    const r = recorder();
    const result = commitModelParam('top_p', raw, r.set);

    expect(result.success).toBe(false);
    expect(r.writes).toStrictEqual([]);
  });

  it('A5: rejects a JSON object for a number-typed param', () => {
    const r = recorder();
    const result = commitModelParam('top_p', '{"a":1}', r.set);

    expect(result.success).toBe(false);
    expect(r.writes).toStrictEqual([]);
  });

  it('A5: rejects a boolean literal for a number-typed param', () => {
    const r = recorder();
    const result = commitModelParam('temperature', 'true', r.set);

    expect(result.success).toBe(false);
    expect(r.writes).toStrictEqual([]);
  });

  // A6 — the remaining number-typed dialog fields keep their integer typing.
  it.each([
    ['max_tokens', '32000', 32000],
    ['top_k', '40', 40],
    ['frequency_penalty', '0', 0],
    ['presence_penalty', '1.25', 1.25],
    ['temperature', '0.7', 0.7],
  ])('A6: commits %s=%s as the number %d', (key, raw, expected) => {
    const r = recorder();
    const result = commitModelParam(key, raw, r.set);

    expect(result.success).toBe(true);
    expect(r.writes).toStrictEqual([expected]);
    expect(typeof r.writes[0]).toBe('number');
  });

  // The numeric guard is registry-driven: a key with no number spec keeps the
  // previous pass-through behavior.
  it('passes an unregistered param through without numeric validation', () => {
    const r = recorder();
    const result = commitModelParam('parse_reasoning', 'true', r.set);

    expect(result.success).toBe(true);
    expect(r.writes).toStrictEqual([true]);
  });

  it('surfaces a runtime write failure as a validation message', () => {
    const result = commitModelParam('top_p', '0.5', () => {
      throw new Error('no active provider');
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe('no active provider');
  });
});
