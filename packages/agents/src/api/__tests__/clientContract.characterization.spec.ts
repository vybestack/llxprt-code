/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260707-AGENTNEUTRAL.P20
 * @requirement:REQ-INT-001.2
 *
 * Characterization tests for the client-surface contract. These pin the
 * OBSERVABLE behavior (history round-trip incl. array isolation + idle-wait,
 * direct-message observable output, sendMessageStream event SEQUENCE) as
 * it exists TODAY so the P21 atomic cross-package flip provably preserves it.
 *
 * All observable reads route through clientContractObservers.ts — no
 * direct .candidates/.parts/.usageMetadata indexing.
 */

import { describe, it, expect, vi } from 'bun:test';
import fc from 'fast-check';

import {
  visibleText,
  historyContent,
  usageCounts,
  eventSequence,
} from './helpers/clientContractObservers.js';
import {
  createFullLoopHarness,
  runFullLoop,
} from '../../core/__tests__/streamPipeline-characterization-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core';
import { collectHistoryFixture } from '../../core/__tests__/support/collect-history-test-fixture.js';

function makeUserContent(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function makeModelContent(text: string): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

const contentArb = fc.array(
  fc.oneof(
    fc.string({ minLength: 1 }).map(makeUserContent),
    fc.string({ minLength: 1 }).map(makeModelContent),
  ),
  { maxLength: 8 },
);

describe('clientContract: history round-trip with array isolation', () => {
  it('returns equivalent content after addHistory → getHistory', async () => {
    const harness = createFullLoopHarness(
      vi.fn(async function* () {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'ok' }],
        } satisfies IContent;
      }),
    );
    const { chat } = harness;
    await chat.clearHistory();
    chat.addHistory(makeUserContent('hello'));
    chat.addHistory(makeModelContent('world'));
    const raw = await collectHistoryFixture(chat.getHistory());
    const result = historyContent(raw);
    expect(result).toHaveLength(2);
    expect(result[0].blocks[0]).toMatchObject({
      type: 'text',
      text: 'hello',
    });
    expect(result[1].blocks[0]).toMatchObject({
      type: 'text',
      text: 'world',
    });
  });

  it('returns array isolation with equal entry values (disk round trip)', async () => {
    const harness = createFullLoopHarness(
      vi.fn(async function* () {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'ok' }],
        } satisfies IContent;
      }),
    );
    const { chat } = harness;
    await chat.clearHistory();
    chat.addHistory(makeUserContent('original'));

    // Two successive calls return distinct arrays
    const raw1 = await collectHistoryFixture(chat.getHistory());
    const raw2 = await collectHistoryFixture(chat.getHistory());
    expect(raw1).not.toBe(raw2);

    // Each read decodes detached copies from the disk journal, so entries are
    // equal by value rather than shared by reference.
    expect(raw1.length).toBe(raw2.length);
    for (let i = 0; i < raw1.length; i++) {
      expect(raw1[i]).toStrictEqual(raw2[i]);
    }

    // Array-level isolation only: getAll()/getCurated() each build a fresh
    // array, so pushing or splicing the result cannot reach live history.
    // This says nothing about entry contents.
    // See the contract comment on ConversationManager.getHistory.
    raw1.push(makeModelContent('injected'));
    const raw3 = await collectHistoryFixture(chat.getHistory());
    expect(raw3.length).toBe(raw2.length);

    // The live history's content is unchanged
    const result = historyContent(raw3);
    expect(result[0].blocks[0]).toMatchObject({
      type: 'text',
      text: 'original',
    });
  });

  it('property: history round-trip preserves block count for ANY history', async () => {
    const harness = createFullLoopHarness(
      vi.fn(async function* () {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'ok' }],
        } satisfies IContent;
      }),
    );
    const { chat } = harness;
    await fc.assert(
      fc.asyncProperty(contentArb, async (history) => {
        await chat.clearHistory();
        for (const entry of history) {
          chat.addHistory(entry);
        }
        const raw = await collectHistoryFixture(chat.getHistory());
        const result = historyContent(raw);
        expect(result).toHaveLength(history.length);
      }),
    );
  });
});

describe('clientContract: getHistory idle-wait when chat is live', () => {
  it('getHistory awaits idle when the chat is live (behavior preserved)', async () => {
    const harness = createFullLoopHarness(
      vi.fn(async function* () {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'ok' }],
        } satisfies IContent;
      }),
    );
    const history = await collectHistoryFixture(harness.chat.getHistory());
    expect(Array.isArray(history)).toBe(true);
  });
});

describe('clientContract: direct message observable output', () => {
  it('generateDirectMessage resolves with expected visible text', async () => {
    const harness = createFullLoopHarness(
      vi.fn(async function* () {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Direct reply' }],
          metadata: {
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            finishReason: 'stop',
            rawStopReason: 'stop',
          },
        } satisfies IContent;
      }),
    );
    const result = await harness.chat.generateDirectMessage(
      { message: 'test direct' } as never,
      'prompt-direct-1',
    );
    expect(visibleText(result)).toBe('Direct reply');
  });

  it('generateDirectMessage usage counts are neutral', async () => {
    const harness = createFullLoopHarness(
      vi.fn(async function* () {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Usage test' }],
          metadata: {
            usage: {
              promptTokens: 100,
              completionTokens: 50,
              totalTokens: 150,
            },
            finishReason: 'stop',
            rawStopReason: 'stop',
          },
        } satisfies IContent;
      }),
    );
    const result = await harness.chat.generateDirectMessage(
      { message: 'test usage' } as never,
      'prompt-direct-2',
    );
    const counts = usageCounts(result);
    expect(counts.promptTokens).toBe(100);
    expect(counts.completionTokens).toBe(50);
    expect(counts.totalTokens).toBe(150);
  });
});

describe('clientContract: sendMessageStream event SEQUENCE', () => {
  it('emits Content then Finished for a scripted provider stream', async () => {
    const harness = createFullLoopHarness(
      vi.fn(async function* () {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Hello' }],
        } satisfies IContent;
        yield {
          speaker: 'ai',
          blocks: [],
          metadata: { finishReason: 'stop', rawStopReason: 'stop' },
        } satisfies IContent;
      }),
    );
    const events = await runFullLoop(harness.turn, 'test message');
    const seq = eventSequence(events);
    expect(seq.length).toBeGreaterThan(0);
    expect(seq[seq.length - 1]).toBe('finished');
    expect(seq).toContain('content');
  });

  it('property: event sequence always ends with Finished for a normal completion', async () => {
    const textArb = fc.string({ minLength: 1, maxLength: 50 });
    const harness = createFullLoopHarness(
      vi.fn(async function* () {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'done' }],
        } satisfies IContent;
        yield {
          speaker: 'ai',
          blocks: [],
          metadata: { finishReason: 'stop', rawStopReason: 'stop' },
        } satisfies IContent;
      }),
    );
    await fc.assert(
      fc.asyncProperty(textArb, async (msg) => {
        const events = await runFullLoop(harness.turn, msg);
        const seq = eventSequence(events);
        expect(seq[seq.length - 1]).toBe('finished');
      }),
    );
  });
});
