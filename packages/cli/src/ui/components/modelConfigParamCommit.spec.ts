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
 * These tests drive the real validation path the dialog uses (real
 * `parseValue`, real settings registry) and assert on the typed value the
 * save would write. Validation is pure (issue #2831): the dialog validates
 * every staged edit before applying any write, and the runtime-write
 * failure path is covered by the dialog's phase-2 rollback tests.
 *
 * Acceptance rows covered: A4, A5, A6.
 */

import { describe, it, expect } from 'bun:test';
import {
  validateModelParam,
  NOT_A_NUMBER_MESSAGE,
} from './modelConfigParamCommit.js';

describe('validateModelParam (issues #2896, #2831)', () => {
  // A4 — the exact input from the bug report.
  it('A4: validates ".95" for top_p as the number 0.95', () => {
    expect(validateModelParam('top_p', '.95')).toStrictEqual({
      success: true,
      value: 0.95,
    });
  });

  it('A4: validates "0.95" for top_p as the number 0.95', () => {
    expect(validateModelParam('top_p', '0.95')).toStrictEqual({
      success: true,
      value: 0.95,
    });
  });

  it('A4: validates negative and exponent forms as numbers', () => {
    expect(validateModelParam('presence_penalty', '-.5')).toStrictEqual({
      success: true,
      value: -0.5,
    });
    expect(validateModelParam('temperature', '1e-5')).toStrictEqual({
      success: true,
      value: 1e-5,
    });
  });

  // A5 — non-numeric input must be rejected, never returned as a string.
  it('A5: rejects "abc" for top_p', () => {
    expect(validateModelParam('top_p', 'abc')).toStrictEqual({
      success: false,
      message: NOT_A_NUMBER_MESSAGE,
    });
  });

  // '1e400' and '-1e400' are syntactically valid numbers that overflow to
  // +/-Infinity, which JSON-serializes to null — the finite guard must reject
  // them rather than hand back an unusable value.
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
  ])('A5: rejects %j for top_p', (raw) => {
    expect(validateModelParam('top_p', raw).success).toBe(false);
  });

  it('A5: rejects a JSON object for a number-typed param', () => {
    expect(validateModelParam('top_p', '{"a":1}').success).toBe(false);
  });

  it('A5: rejects a boolean literal for a number-typed param', () => {
    expect(validateModelParam('temperature', 'true').success).toBe(false);
  });

  // A6 — the remaining number-typed dialog fields, integer and fractional
  // alike, validate as numbers.
  it.each([
    ['max_tokens', '32000', 32000],
    ['top_k', '40', 40],
    ['frequency_penalty', '0', 0],
    ['presence_penalty', '1.25', 1.25],
    ['temperature', '0.7', 0.7],
  ])('A6: validates %s=%s as the number %s', (key, raw, expected) => {
    expect(validateModelParam(key, raw)).toStrictEqual({
      success: true,
      value: expected,
    });
  });

  // The numeric guard is registry-driven: a key with no number spec keeps the
  // previous pass-through behavior.
  it('passes an unregistered param through without numeric validation', () => {
    expect(validateModelParam('parse_reasoning', 'true')).toStrictEqual({
      success: true,
      value: true,
    });
  });
});
