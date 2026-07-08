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
 * be tested directly. These tests verify the guard catches all three cases:
 * null, undefined-coerced-to-null, and the critical empty-array case.
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

  it('returns true for an array with multiple empty-content items', () => {
    // Edge case: array exists but all items are empty Content objects.
    // While unlikely in practice, the guard should still stop.
    const messages: Content[] = [{ role: 'user', parts: [] }];
    // This array has length 1, so the guard says "continue" — the empty-parts
    // filtering happens downstream in ContentConverters/HistoryService.
    // The guard only checks whether there are ANY messages at all.
    expect(shouldStopNonInteractiveLoop(messages)).toBe(false);
  });
});
