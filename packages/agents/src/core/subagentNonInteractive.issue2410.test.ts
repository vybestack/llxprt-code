/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for issue #2410 (Layer 1):
 * When `processFunctionCalls` returns `[]` (an empty, truthy array) — e.g.
 * because all function calls were hook-restricted — the non-interactive loop
 * must STOP rather than continue with `messages: []`. Previously `![]`
 * evaluated to `false`, so the loop continued, producing an empty user turn
 * that z.ai rejected with HTTP 400 error 1213.
 *
 * The loop guard `hasNonInteractiveMessages` was extracted into a type guard
 * so it can be tested directly. These tests verify it returns false for null
 * and empty arrays (stop cases), and true for non-empty arrays (continue case).
 */

import { describe, it, expect } from 'vitest';
import type { Content } from '@google/genai';
import { hasNonInteractiveMessages } from './subagentNonInteractive.js';

describe('issue #2410 – hasNonInteractiveMessages type guard', () => {
  it('returns false for null (no further messages)', () => {
    expect(hasNonInteractiveMessages(null)).toBe(false);
  });

  it('returns false for an empty array — the critical bug case', () => {
    // This is the crux of the bug: processFunctionCalls returns [] (truthy,
    // not null) when all calls are hook-restricted. The old `!nextMessages`
    // guard evaluated `![]` as `false`, so the loop continued and sent an
    // empty user turn to the provider (causing z.ai error 1213).
    const emptyArray: Content[] = [];
    expect(hasNonInteractiveMessages(emptyArray)).toBe(false);
  });

  it('returns true for a non-empty array — loop should continue', () => {
    const messages: Content[] = [{ role: 'user', parts: [{ text: 'result' }] }];
    expect(hasNonInteractiveMessages(messages)).toBe(true);
  });

  it('returns true for a non-empty array even if individual parts are empty', () => {
    // The guard only checks whether there are ANY messages at all (array
    // length). It does NOT inspect individual Content.parts — empty-parts
    // filtering is handled downstream by ContentConverters/HistoryService.
    const messages: Content[] = [{ role: 'user', parts: [] }];
    expect(hasNonInteractiveMessages(messages)).toBe(true);
  });
});
