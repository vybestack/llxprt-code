/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the streamed-content pipeline (issue #2852).
 *
 * These pin the three properties the fix has to hold simultaneously:
 *
 * 1. Every delta advances the display — the terminal must not update in
 *    batches. A coalescing implementation fails "publishes on every delta".
 * 2. The committed transcript is byte-identical to sanitising the whole
 *    response in one pass.
 * 3. Per-delta work is proportional to the delta, not to the accumulated
 *    response, so a long response is linear rather than quadratic.
 */

import { describe, it, expect, vi } from 'bun:test';
import type React from 'react';
import { EmojiFilter, type ThinkingBlock } from '@vybestack/llxprt-code-core';
import type { HistoryItemWithoutId } from '../../../types.js';
import {
  processContentEvent,
  type ContentEventDeps,
} from '../contentEventProcessor.js';
import { PendingResponseBuffer } from '../pendingResponseBuffer.js';
import { findLastSafeSplitPoint } from '../../../utils/markdownUtilities.js';

interface Harness {
  readonly deps: ContentEventDeps;
  readonly committed: HistoryItemWithoutId[];
  readonly renders: string[];
  stream(deltas: readonly string[]): void;
  finish(): string;
}

function createHarness(filter?: EmojiFilter): Harness {
  const committed: HistoryItemWithoutId[] = [];
  const renders: string[] = [];
  const pendingHistoryItemRef = {
    current: null,
  } as React.MutableRefObject<HistoryItemWithoutId | null>;
  const pendingResponse = new PendingResponseBuffer(filter);

  const setPendingHistoryItem = (
    next:
      | HistoryItemWithoutId
      | null
      | ((prev: HistoryItemWithoutId | null) => HistoryItemWithoutId | null),
  ) => {
    const resolved =
      typeof next === 'function' ? next(pendingHistoryItemRef.current) : next;
    pendingHistoryItemRef.current = resolved;
    if (resolved && typeof resolved.text === 'string') {
      renders.push(resolved.text);
    }
  };

  const deps: ContentEventDeps = {
    addItem: vi.fn((item: HistoryItemWithoutId) => {
      committed.push(item);
      return committed.length;
    }) as unknown as ContentEventDeps['addItem'],
    pendingResponse,
    sanitizeContent: (text: string) => ({ text, blocked: false }),
    flushPendingHistoryItem: vi.fn(),
    pendingHistoryItemRef,
    thinkingBlocksRef: { current: [] } as React.MutableRefObject<
      ThinkingBlock[]
    >,
    turnCancelledRef: { current: false },
    setPendingHistoryItem:
      setPendingHistoryItem as ContentEventDeps['setPendingHistoryItem'],
    getContentPrefixIdentity: () => null,
  };

  return {
    deps,
    committed,
    renders,
    stream(deltas) {
      let buffer = '';
      for (const delta of deltas) {
        buffer = processContentEvent(delta, buffer, 1_000, deps);
      }
    },
    finish() {
      const result = pendingResponse.materialize();
      const committedText = committed
        .filter(
          (item) => item.type === 'gemini' || item.type === 'gemini_content',
        )
        .map((item) => (item as { text: string }).text)
        .join('');
      return committedText + result.text;
    },
  };
}

function splitIntoDeltas(text: string, size: number): string[] {
  const deltas: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    deltas.push(text.slice(index, index + size));
  }
  return deltas;
}

const LONG_PROSE = Array.from(
  { length: 30 },
  (_, i) => `Paragraph ${i} describes a step of the plan in some detail.`,
).join('\n\n');

const LONG_CODE_BLOCK =
  'Here is the implementation:\n\n```ts\n' +
  Array.from(
    { length: 400 },
    (_, i) => `const value${i} = compute(${i});`,
  ).join('\n');

describe('streamed content pipeline (issue #2852)', () => {
  it('publishes on every delta so streaming is not batched', () => {
    const harness = createHarness();
    const deltas = splitIntoDeltas('The quick brown fox jumps over it.', 1);

    harness.stream(deltas);

    // One render per delta, plus the empty item created when the assistant
    // response begins.
    expect(harness.renders).toHaveLength(deltas.length + 1);
  });

  it('advances the rendered text on every delta', () => {
    const harness = createHarness();
    const deltas = ['Hel', 'lo ', 'wor', 'ld'];

    harness.stream(deltas);

    expect(harness.renders).toStrictEqual([
      '',
      'Hel',
      'Hello ',
      'Hello wor',
      'Hello world',
    ]);
  });

  it('commits prose byte-identically to whole-text streaming', () => {
    for (const size of [1, 3, 7, 64]) {
      const harness = createHarness();
      harness.stream(splitIntoDeltas(LONG_PROSE, size));
      expect({ size, text: harness.finish() }).toStrictEqual({
        size,
        text: LONG_PROSE,
      });
    }
  });

  it('commits an unterminated code block byte-identically', () => {
    for (const size of [1, 5, 32]) {
      const harness = createHarness();
      harness.stream(splitIntoDeltas(LONG_CODE_BLOCK, size));
      expect({ size, text: harness.finish() }).toStrictEqual({
        size,
        text: LONG_CODE_BLOCK,
      });
    }
  });

  it('commits emoji-bearing content identically to whole-text filtering', () => {
    const source =
      'Result ✅ ready.\n\nWarning ⚠️ applies to step 1️⃣ only.\n\nDone 😀 now.';
    const expected = new EmojiFilter({ mode: 'auto' }).filterText(source)
      .filtered as string;

    for (const size of [1, 2, 9]) {
      const harness = createHarness(new EmojiFilter({ mode: 'auto' }));
      harness.stream(splitIntoDeltas(source, size));
      expect({ size, text: harness.finish() }).toStrictEqual({
        size,
        text: expected,
      });
    }
  });

  it('splits committed prose at the same markdown boundaries as the batch helper', () => {
    const harness = createHarness();
    harness.stream(splitIntoDeltas(LONG_PROSE, 4));

    const committedText = harness.committed
      .map((item) => (item as { text: string }).text)
      .join('');
    // Everything committed mid-stream must be a prefix ending on a boundary the
    // batch implementation also considers safe.
    expect(LONG_PROSE.startsWith(committedText)).toBe(true);
    expect(findLastSafeSplitPoint(committedText)).toBe(committedText.length);
  });

  it('keeps retained pending text bounded while prose streams', () => {
    const harness = createHarness();
    harness.stream(splitIntoDeltas(LONG_PROSE, 4));

    // Paragraph splitting must actually be happening: the pending tail should
    // hold roughly one paragraph, not the whole response.
    expect(harness.deps.pendingResponse.stableText.length).toBeLessThan(
      LONG_PROSE.length / 4,
    );
  });

  it('does not lose a trailing partial word when the stream ends', () => {
    const harness = createHarness(new EmojiFilter({ mode: 'auto' }));
    harness.stream(['complete words then trailing', 'Frag']);
    expect(harness.finish()).toBe('complete words then trailingFrag');
  });

  it('drops all per-turn state on reset', () => {
    const harness = createHarness(new EmojiFilter({ mode: 'auto' }));
    harness.stream(['abandoned text']);
    harness.deps.pendingResponse.reset();
    expect(harness.deps.pendingResponse.materialize().text).toBe('');
  });

  it('ignores deltas once the turn is cancelled', () => {
    const harness = createHarness();
    harness.stream(['before cancel ']);
    const rendersBefore = harness.renders.length;
    harness.deps.turnCancelledRef.current = true;
    harness.stream(['after cancel']);
    expect(harness.renders).toHaveLength(rendersBefore);
  });
});
