/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type { Key } from './KeypressContext.js';
import { createKeypressPipeline, ESC_TIMEOUT } from './KeypressContext.js';
import { keyMatchers, Command } from '../keyMatchers.js';

/**
 * One live pipeline plus the keys it has decoded so far. Tests that span the
 * ESC_TIMEOUT boundary must keep pushing into the SAME pipeline: a fresh one
 * has no pending escape state, so feeding it the second chunk would prove
 * nothing about disambiguation.
 */
const startPipeline = (): {
  push: (data: string) => void;
  keys: Key[];
} => {
  const keys: Key[] = [];
  return { push: createKeypressPipeline((k) => keys.push(k)), keys };
};

/** Feed the given chunks through one pipeline and collect decoded keys. */
const feed = (chunks: string[]): Key[] => {
  const { push, keys } = startPipeline();
  for (const chunk of chunks) push(chunk);
  return keys;
};

/** Assert exactly one key was decoded and return it. */
const only = (keys: Key[]): Key => {
  expect(keys).toHaveLength(1);
  return keys[0];
};

// The bare-Escape cases below assert the Command.ESCAPE matcher rather than
// the `meta` flag. The parser reports `meta: true` for a lone Escape because
// the byte arrives through the escaped branch, which is incidental; what
// callers depend on is that the key still triggers the escape binding. The
// matcher assertion is the regression guard for that: constrain the ESCAPE
// binding on modifiers and Escape stops working, and these tests fail.
describe('escape vs Alt-key disambiguation (AC3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a lone ESC emits nothing until ESC_TIMEOUT and then one escape key that matches Command.ESCAPE (AC3.1)', () => {
    const keys = feed(['\x1b']);
    expect(keys).toHaveLength(0);

    vi.advanceTimersByTime(ESC_TIMEOUT);
    const key = only(keys);
    expect(key.name).toBe('escape');
    expect(key.sequence).toBe('\x1b');
    expect(keyMatchers[Command.ESCAPE](key)).toBe(true);
  });

  it('ESC plus a letter in one chunk is Alt+letter, not Escape then letter (AC3.2)', () => {
    const keys = feed(['\x1bb']);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toStrictEqual({
      name: 'b',
      meta: true,
      shift: false,
      ctrl: false,
      sequence: '\x1bb',
      insertable: true,
    });
  });

  it('ESC, then a letter after the timeout, emits escape then an unmodified letter (AC3.3)', () => {
    const { push, keys } = startPipeline();

    push('\x1b');
    vi.advanceTimersByTime(ESC_TIMEOUT);
    push('b');

    // Same pipeline throughout: this is the disambiguation contract. If the
    // parser kept its escaped state across the flush, the letter would arrive
    // as Alt+b instead of a bare b.
    expect(keys.map(({ name }) => name)).toStrictEqual(['escape', 'b']);
    expect(keyMatchers[Command.ESCAPE](keys[0])).toBe(true);
    expect(keys[1].meta).toBe(false);
    expect(keys[1].sequence).toBe('b');
  });

  it('two ESC bytes in one chunk emit one escape key matching Command.ESCAPE (AC3.4)', () => {
    const keys = feed(['\x1b\x1b']);
    vi.advanceTimersByTime(ESC_TIMEOUT);
    const key = only(keys);
    expect(key.name).toBe('escape');
    expect(key.sequence).toBe('\x1b');
    expect(keyMatchers[Command.ESCAPE](key)).toBe(true);
  });

  it('treats ESC [ as a CSI introducer (AC3.5)', () => {
    const keys = feed(['\x1b[A']);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toStrictEqual({
      name: 'up',
      shift: false,
      meta: false,
      ctrl: false,
      sequence: '\x1b[A',
      insertable: false,
    });
  });

  // The `sequence` field is deliberately not asserted here. The SS3 reader
  // reports `\x1bA` rather than the `\x1bOA` bytes it consumed, dropping the
  // `O`, which is inconsistent with the CSI reader above. That inconsistency
  // is out of scope for this coverage change and asserting it would freeze it
  // as the contract, so only the decoded key identity is pinned.
  it('treats ESC O as an SS3 introducer (AC3.6)', () => {
    const key = only(feed(['\x1bOA']));
    expect(key.name).toBe('up');
    expect(key.meta).toBe(false);
    expect(key.ctrl).toBe(false);
    expect(key.shift).toBe(false);
  });
});
