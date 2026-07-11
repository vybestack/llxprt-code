/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for StreamBatcher's blocked-path timer handling (issue #1604
 * FINDING E1/E2). These drive the REAL StreamBatcher over a REAL EmojiFilter in
 * `error` mode and a real-ish sendUpdate collector — no result-shaped mocks —
 * with fake timers so the batch-timer race is deterministically observable.
 *
 * FINDING E1: a normal chunk arms the 100ms batch timer; a following blocked
 *   chunk must CLEAR that timer (as flush() does) before building its blocked
 *   chain. Otherwise the stale timer later fires a SECOND flush()+flushBuffer()
 *   chain that races the blocked-path chain and re-flushes already-flushed
 *   content after the error message. We assert both the exact emitted sequence
 *   AND that the real EmojiFilter.flushBuffer is not called an extra time by a
 *   stray timer after the blocked chunk settled.
 * FINDING E2: the emitted blocked message equals the exported
 *   STREAM_BLOCKED_MESSAGE constant (single source of truth), not a duplicated
 *   literal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as acp from '@agentclientprotocol/sdk';
import { EmojiFilter } from '@vybestack/llxprt-code-core';
import { StreamBatcher, STREAM_BLOCKED_MESSAGE } from './zed-stream-batcher.js';

/** Collects the text of every agent_message_chunk / agent_thought_chunk sent. */
interface UpdateCollector {
  readonly sendUpdate: (update: acp.SessionUpdate) => Promise<void>;
  readonly texts: () => string[];
}

function buildCollector(): UpdateCollector {
  const texts: string[] = [];
  return {
    sendUpdate: async (update: acp.SessionUpdate) => {
      const maybe = update as { content?: { text?: string } };
      if (typeof maybe.content?.text === 'string') {
        texts.push(maybe.content.text);
      }
    },
    texts: () => [...texts],
  };
}

describe('StreamBatcher blocked-path timer handling (issue #1604 E1/E2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('E1: clears the pending batch timer on a blocked chunk so no stray secondary flush fires after the blocked sequence', async () => {
    const filter = new EmojiFilter({ mode: 'error' });
    // Spy (pass-through) on the REAL flushBuffer so we can count how many times a
    // flush path runs: the blocked path calls it once (residual), and flush()
    // calls it once per flush. A stray timer firing after the blocked chunk
    // would call it an EXTRA time — the regression this guards.
    const flushBufferSpy = vi.spyOn(filter, 'flushBuffer');
    const collector = buildCollector();
    const batcher = new StreamBatcher(filter, collector.sendUpdate);

    // 1) A normal clean chunk: emits nothing yet but ARMS the 100ms batch timer.
    batcher.append('clean text ', false);

    // 2) A blocked chunk (carries an emoji, error mode → blocked): must clear the
    // armed timer, flush the residual, then emit the blocked error message.
    batcher.append('oops \u{1F600}', false);

    // Let the blocked-path microtask chain settle.
    await vi.runAllTimersAsync();
    const flushCountAfterBlocked = flushBufferSpy.mock.calls.length;
    const textsAfterBlocked = collector.texts();

    // Advance well past the batch interval: if the timer had NOT been cleared it
    // would fire here, running an extra flush()+flushBuffer() chain.
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    // No additional flushBuffer invocation occurred after the blocked chunk
    // settled — the stale timer was cleared, so nothing fired late.
    expect(flushBufferSpy.mock.calls.length).toBe(flushCountAfterBlocked);
    // And no additional text was emitted by a stray flush.
    expect(collector.texts()).toStrictEqual(textsAfterBlocked);

    // The emitted sequence is the residual clean text THEN exactly one blocked
    // error message — no duplicate/secondary flush of already-flushed content.
    expect(collector.texts()).toStrictEqual([
      'clean text ',
      STREAM_BLOCKED_MESSAGE,
    ]);
    // Exactly one blocked error message overall.
    expect(
      collector.texts().filter((t) => t === STREAM_BLOCKED_MESSAGE),
    ).toHaveLength(1);
  });

  it('E2: the blocked message emitted equals the exported STREAM_BLOCKED_MESSAGE constant', async () => {
    const filter = new EmojiFilter({ mode: 'error' });
    const collector = buildCollector();
    const batcher = new StreamBatcher(filter, collector.sendUpdate);

    batcher.append('bad \u{1F600}', false);
    await vi.runAllTimersAsync();

    expect(collector.texts()).toContain(STREAM_BLOCKED_MESSAGE);
    // The constant is the exact wire literal (guards accidental drift).
    expect(STREAM_BLOCKED_MESSAGE).toBe(
      '[Error: Response blocked due to emoji detection]',
    );
  });
});
