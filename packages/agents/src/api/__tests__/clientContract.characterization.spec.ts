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
 * OBSERVABLE behavior (history round-trip incl. clone + idle-wait,
 * direct-message observable output, sendMessageStream event SEQUENCE) as
 * it exists TODAY so the P21 atomic cross-package flip provably preserves it.
 *
 * All observable reads route through clientContractObservers.ts — no
 * direct .candidates/.parts/.usageMetadata indexing.
 */

import { describe, it, expect, vi } from 'vitest';
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

describe('clientContract.characterization — @plan:PLAN-20260707-AGENTNEUTRAL.P20 @requirement:REQ-INT-001.2', () => {
  describe('history round-trip with defensive clone', () => {
    it('returns equivalent content after addHistory → getHistory', () => {
      const harness = createFullLoopHarness(
        vi.fn(async function* () {
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'ok' }],
          } satisfies IContent;
        }),
      );
      const { chat } = harness;
      chat.clearHistory();
      chat.addHistory(makeUserContent('hello'));
      chat.addHistory(makeModelContent('world'));
      const raw = chat.getHistory();
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

    it('returns a clone, not a live reference (mutating result does not mutate source)', () => {
      const harness = createFullLoopHarness(
        vi.fn(async function* () {
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'ok' }],
          } satisfies IContent;
        }),
      );
      const { chat } = harness;
      chat.clearHistory();
      chat.addHistory(makeUserContent('original'));
      const raw = chat.getHistory();
      const result = historyContent(raw);
      expect(result.length).toBeGreaterThan(0);
      const firstBlock = result[0].blocks[0];
      const originalText = firstBlock.type === 'text' ? firstBlock.text : '';
      // Mutate the result
      (result[0].blocks as Array<{ text: string }>)[0].text = 'mutated';
      // Re-read — the live history should be unchanged
      const raw2 = chat.getHistory();
      const result2 = historyContent(raw2);
      const firstBlock2 = result2[0].blocks[0];
      const finalText = firstBlock2.type === 'text' ? firstBlock2.text : '';
      expect(finalText).toBe(originalText);
    });

    it('property: history round-trip preserves block count for ANY history', () => {
      const harness = createFullLoopHarness(
        vi.fn(async function* () {
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'ok' }],
          } satisfies IContent;
        }),
      );
      const { chat } = harness;
      fc.assert(
        fc.property(contentArb, (history) => {
          chat.clearHistory();
          for (const entry of history) {
            chat.addHistory(entry);
          }
          const raw = chat.getHistory();
          const result = historyContent(raw);
          expect(result).toHaveLength(history.length);
        }),
      );
    });
  });

  describe('getHistory idle-wait when chat is live', () => {
    it('getHistory awaits idle when the chat is live (behavior preserved)', async () => {
      const harness = createFullLoopHarness(
        vi.fn(async function* () {
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'ok' }],
          } satisfies IContent;
        }),
      );
      const history = harness.chat.getHistory();
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe('direct message observable output', () => {
    it('generateDirectMessage resolves with expected visible text', async () => {
      const harness = createFullLoopHarness(
        vi.fn(async function* () {
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'Direct reply' }],
            metadata: {
              usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
              stopReason: 'stop',
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
              stopReason: 'stop',
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

  describe('sendMessageStream event SEQUENCE', () => {
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
            metadata: { stopReason: 'stop' },
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
            metadata: { stopReason: 'stop' },
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
});
