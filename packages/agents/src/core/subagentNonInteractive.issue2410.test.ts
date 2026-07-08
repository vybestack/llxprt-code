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
 * The loop guard was extracted into `shouldStopNonInteractiveLoop` so it can
 * be tested directly. These tests verify the guard catches null and the
 * critical empty-array case, and allows continuation for non-empty arrays.
 */

import { describe, it, expect } from 'vitest';
import type { Content } from '@google/genai';
import { shouldStopNonInteractiveLoop } from './subagentNonInteractive.js';

describe('issue #2410 – shouldStopNonInteractiveLoop guard', () => {
  it('returns true for null (no further messages)', () => {
    expect(shouldStopNonInteractiveLoop(null)).toBe(true);
  });

  it('returns true for an empty array — the critical bug case', () => {
    // This is the crux of the bug: processFunctionCalls returns [] (truthy,
    // not null) when all calls are hook-restricted. The old `!nextMessages`
    // guard evaluated `![]` as `false`, so the loop continued and sent an
    // empty user turn to the provider (causing z.ai error 1213).
    const emptyArray: Content[] = [];
    expect(shouldStopNonInteractiveLoop(emptyArray)).toBe(true);
  });

  it('returns false for a non-empty array — loop should continue', () => {
    const messages: Content[] = [{ role: 'user', parts: [{ text: 'result' }] }];
    expect(shouldStopNonInteractiveLoop(messages)).toBe(false);
  });

  it('returns false for a non-empty array even if individual parts are empty', () => {
    // The guard only checks whether there are ANY messages at all (array
    // length). It does NOT inspect individual Content.parts — empty-parts
    // filtering is handled downstream by ContentConverters/HistoryService.
    const messages: Content[] = [{ role: 'user', parts: [] }];
    expect(shouldStopNonInteractiveLoop(messages)).toBe(false);
  });
});
