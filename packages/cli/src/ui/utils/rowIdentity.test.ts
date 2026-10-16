/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260917-ISSUE854.P02b
 * @requirement G5
 *
 * Row identity + live correlation. A scrollback row's identity is
 * (journal envelope byte offset, projection discriminator) so a row keeps
 * its slot across regeneration, paging, and live-commit merges. chronologySeq
 * is ordering data, never identity: replay display ids restart at −1 per
 * converter invocation and tool groups carry seqSpan, not a point seq.
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core';
import {
  pendingRowIdentity,
  resolvePendingRowIdentity,
  rowIdentity,
  rowIdentityKey,
  sameRowIdentity,
} from './rowIdentity.js';
import { iContentToHistoryItems } from './iContentToHistoryItems.js';
import { createHistoryLedger } from '../stores/turn/historyLedger.js';
import type { HistoryItem } from '../types.js';

function chronology(seq: number) {
  return { seq, userTurn: 1, step: 1, recordedAt: 0 };
}

function user(text: string, seq?: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    ...(seq !== undefined ? { metadata: { chronology: chronology(seq) } } : {}),
  };
}

function aiText(text: string, seq?: number): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    ...(seq !== undefined ? { metadata: { chronology: chronology(seq) } } : {}),
  };
}

function aiToolCall(id: string, seq?: number): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'tool_call', id, name: 'ls', parameters: {} }],
    ...(seq !== undefined ? { metadata: { chronology: chronology(seq) } } : {}),
  };
}

function toolResponse(id: string, seq?: number): IContent {
  return {
    speaker: 'tool',
    blocks: [
      { type: 'tool_response', callId: id, toolName: 'ls', result: 'ok' },
    ],
    ...(seq !== undefined ? { metadata: { chronology: chronology(seq) } } : {}),
  };
}

function userItem(id: number, rowIdentityShape: unknown): HistoryItem {
  return {
    id,
    type: 'user',
    text: `item-${id}`,
    rowIdentity: rowIdentityShape as HistoryItem['rowIdentity'],
  };
}

describe('rowIdentity', () => {
  describe('committed identity construction', () => {
    it('gives the same envelope offset and different discriminators different rows', () => {
      const text = rowIdentity({ kind: 'journal', offset: 500 }, 'text');
      const group = rowIdentity({ kind: 'journal', offset: 500 }, 'toolGroup');

      expect(sameRowIdentity(text, group)).toBe(false);
      expect(rowIdentityKey(text)).not.toBe(rowIdentityKey(group));
    });

    it('keeps a summaryRow identity distinct from projection rows at the same compressed-envelope offset', () => {
      const summaryRow = rowIdentity(
        { kind: 'journal', offset: 4242 },
        'summaryRow',
      );
      const text = rowIdentity({ kind: 'journal', offset: 4242 }, 'text');
      const toolGroup = rowIdentity(
        { kind: 'journal', offset: 4242 },
        'toolGroup',
      );

      expect(sameRowIdentity(summaryRow, text)).toBe(false);
      expect(sameRowIdentity(summaryRow, toolGroup)).toBe(false);
    });

    it('constructs a stable identity for repeated calls with the same source', () => {
      const first = rowIdentity({ kind: 'journal', offset: 900 }, 'text');
      const second = rowIdentity({ kind: 'journal', offset: 900 }, 'text');

      expect(sameRowIdentity(first, second)).toBe(true);
      expect(rowIdentityKey(first)).toBe(rowIdentityKey(second));
    });

    it('distinguishes two envelopes that only differ by byte offset', () => {
      const first = rowIdentity({ kind: 'journal', offset: 12 }, 'text');
      const second = rowIdentity({ kind: 'journal', offset: 123 }, 'text');

      expect(sameRowIdentity(first, second)).toBe(false);
    });
  });

  describe('pending identity and live correlation', () => {
    it('keeps a pending row identity stable while it streams, so nothing swaps mid-flight', () => {
      const first = pendingRowIdentity('turn-7:0');
      const second = pendingRowIdentity('turn-7:0');

      expect(sameRowIdentity(first, second)).toBe(true);
      expect(rowIdentityKey(first)).toBe(rowIdentityKey(second));
    });

    it('carries the pending prefix so a streaming row can never collide with a committed slot', () => {
      const pending = pendingRowIdentity('turn-7:0');
      const committedHere = rowIdentity(
        { kind: 'journal', offset: 500 },
        'text',
      );
      const committedLegacy = rowIdentity({ kind: 'legacy', index: 0 }, 'text');

      expect(rowIdentityKey(pending).startsWith('pending:')).toBe(true);
      expect(rowIdentityKey(pending)).not.toBe(rowIdentityKey(committedHere));
      expect(rowIdentityKey(pending)).not.toBe(rowIdentityKey(committedLegacy));
    });

    it('resolves a pending row to the committed identity it became, idempotently', () => {
      const pending = pendingRowIdentity('turn-7:0');
      const committed = rowIdentity({ kind: 'journal', offset: 500 }, 'text');

      const resolution = resolvePendingRowIdentity(pending, committed);
      expect(resolution).toBeDefined();
      expect(resolution?.pendingKey).toBe('turn-7:0');
      expect(sameRowIdentity(resolution?.committed ?? pending, committed)).toBe(
        true,
      );

      const again = resolvePendingRowIdentity(pending, committed);
      expect(rowIdentityKey(again?.committed ?? pending)).toBe(
        rowIdentityKey(resolution?.committed ?? pending),
      );
    });

    it('refuses to correlate a committed identity as if it were pending', () => {
      const committed = rowIdentity({ kind: 'journal', offset: 500 }, 'text');
      const other = rowIdentity({ kind: 'journal', offset: 501 }, 'text');

      expect(resolvePendingRowIdentity(committed, other)).toBeUndefined();
    });
  });

  describe('serialization round-trip', () => {
    it('survives JSON serialization with equality and canonical key intact', () => {
      const identities = [
        rowIdentity({ kind: 'journal', offset: 4242 }, 'summaryRow'),
        rowIdentity({ kind: 'journal', offset: 500 }, 'toolGroup'),
        rowIdentity({ kind: 'legacy', index: 3 }, 'text'),
        pendingRowIdentity('turn-7:0'),
      ];

      for (const identity of identities) {
        const restored = JSON.parse(
          JSON.stringify(identity),
        ) as typeof identity;
        expect(sameRowIdentity(identity, restored)).toBe(true);
        expect(rowIdentityKey(restored)).toBe(rowIdentityKey(identity));
      }
    });
  });

  describe('iContentToHistoryItems row identities', () => {
    it('stamps every projected row with its envelope offset and discriminator', () => {
      const contents = [
        user('hi'),
        aiText('hello'),
        aiToolCall('c1'),
        toolResponse('c1'),
      ];
      const output = iContentToHistoryItems(contents, 'allowed', {
        envelopeOffsets: [100, 200, 300, 400],
      });

      expect(output).toHaveLength(3);
      expect(output[0].rowIdentity).toStrictEqual({
        kind: 'journal',
        offset: 100,
        discriminator: 'text',
      });
      expect(output[1].rowIdentity).toStrictEqual({
        kind: 'journal',
        offset: 200,
        discriminator: 'text',
      });
      expect(output[2].rowIdentity).toStrictEqual({
        kind: 'journal',
        offset: 300,
        discriminator: 'toolGroup',
      });
    });

    it('gives one envelope projecting text and a tool group two distinct identities', () => {
      const contents = [
        {
          speaker: 'ai' as const,
          blocks: [
            { type: 'text' as const, text: 'running ls' },
            {
              type: 'tool_call' as const,
              id: 'c1',
              name: 'ls',
              parameters: {},
            },
          ],
        },
        toolResponse('c1'),
      ];
      const output = iContentToHistoryItems(contents, 'allowed', {
        envelopeOffsets: [500, 600],
      });

      expect(output).toHaveLength(2);
      const text = output[0].rowIdentity;
      const group = output[1].rowIdentity;
      expect(text).toStrictEqual({
        kind: 'journal',
        offset: 500,
        discriminator: 'text',
      });
      expect(group).toStrictEqual({
        kind: 'journal',
        offset: 500,
        discriminator: 'toolGroup',
      });
      expect(sameRowIdentity(text!, group!)).toBe(false);
    });

    it('produces identical identities when the same records are converted again', () => {
      const contents = [
        user('u'),
        aiText('a'),
        aiToolCall('c'),
        toolResponse('c'),
      ];
      const offsets = [100, 200, 300, 400];
      const first = iContentToHistoryItems(contents, 'allowed', {
        envelopeOffsets: offsets,
      });
      const second = iContentToHistoryItems(contents, 'allowed', {
        envelopeOffsets: offsets,
      });

      expect(first.map((item) => item.id)).toStrictEqual(
        second.map((item) => item.id),
      );
      expect(first.map((item) => item.rowIdentity)).toStrictEqual(
        second.map((item) => item.rowIdentity),
      );
    });

    it('falls back to (legacy local index, discriminator) when no journal offsets exist', () => {
      const contents = [
        user('u'),
        aiText('a'),
        aiToolCall('c'),
        toolResponse('c'),
      ];
      const output = iContentToHistoryItems(contents, 'allowed');

      expect(output).toHaveLength(3);
      expect(output[0].rowIdentity).toStrictEqual({
        kind: 'legacy',
        index: 0,
        discriminator: 'text',
      });
      expect(output[1].rowIdentity).toStrictEqual({
        kind: 'legacy',
        index: 1,
        discriminator: 'text',
      });
      expect(output[2].rowIdentity).toStrictEqual({
        kind: 'legacy',
        index: 2,
        discriminator: 'toolGroup',
      });
    });

    it('keeps legacy fallback identities stable across regeneration', () => {
      const contents = [user('u'), aiText('a')];
      const first = iContentToHistoryItems(contents, 'allowed');
      const second = iContentToHistoryItems(contents, 'allowed');

      expect(first.map((item) => item.rowIdentity)).toStrictEqual(
        second.map((item) => item.rowIdentity),
      );
    });

    it('handles a mixed batch where some records carry offsets and others do not', () => {
      const contents = [user('u'), aiText('a'), aiText('b')];
      const output = iContentToHistoryItems(contents, 'allowed', {
        envelopeOffsets: [100, undefined, 300],
      });

      expect(output[0].rowIdentity).toStrictEqual({
        kind: 'journal',
        offset: 100,
        discriminator: 'text',
      });
      expect(output[1].rowIdentity).toStrictEqual({
        kind: 'legacy',
        index: 1,
        discriminator: 'text',
      });
      expect(output[2].rowIdentity).toStrictEqual({
        kind: 'journal',
        offset: 300,
        discriminator: 'text',
      });
    });

    it('stays distinct when replay ids and chronology seqs restart across invocations', () => {
      const first = iContentToHistoryItems([aiText('a', 7)], 'allowed', {
        envelopeOffsets: [900],
      });
      const second = iContentToHistoryItems([aiText('b', 7)], 'allowed', {
        envelopeOffsets: [901],
      });

      expect(first[0].id).toBe(-1);
      expect(second[0].id).toBe(-1);
      expect(
        sameRowIdentity(first[0].rowIdentity!, second[0].rowIdentity!),
      ).toBe(false);
    });

    it('keeps a density-replaced interior row stable within a session (same offset, inherited seq)', () => {
      const before = iContentToHistoryItems(
        [aiText('a long original answer', 12)],
        'allowed',
        { envelopeOffsets: [77] },
      );
      const after = iContentToHistoryItems(
        [aiText('condensed', 12)],
        'allowed',
        {
          envelopeOffsets: [77],
        },
      );

      expect(
        sameRowIdentity(before[0].rowIdentity!, after[0].rowIdentity!),
      ).toBe(true);
    });

    it('derives identity from data, not array position, across page out/page in cycles', () => {
      const contents = [user('u1'), aiText('a1'), user('u2'), aiText('a2')];
      const offsets = [10, 20, 30, 40];
      const full = iContentToHistoryItems(contents, 'allowed', {
        envelopeOffsets: offsets,
      });

      const pageOut = full.slice(0, 2);
      const pageIn = iContentToHistoryItems(contents.slice(2), 'allowed', {
        envelopeOffsets: offsets.slice(2),
      });

      expect(
        sameRowIdentity(pageIn[0].rowIdentity!, full[2].rowIdentity!),
      ).toBe(true);
      expect(
        sameRowIdentity(pageIn[1].rowIdentity!, full[3].rowIdentity!),
      ).toBe(true);
      expect(
        sameRowIdentity(pageIn[0].rowIdentity!, pageOut[0].rowIdentity!),
      ).toBe(false);
    });

    it('marks a compression boundary summaryRow distinct from the summary content row at the same offset', () => {
      const contents = [
        {
          speaker: 'ai' as const,
          blocks: [{ type: 'text' as const, text: 'summary of prior turns' }],
          metadata: { isSummary: true },
        },
      ];
      const output = iContentToHistoryItems(contents, 'allowed', {
        envelopeOffsets: [4242],
      });

      const boundaryRow = rowIdentity(
        { kind: 'journal', offset: 4242 },
        'summaryRow',
      );
      expect(output[0].rowIdentity).toStrictEqual({
        kind: 'journal',
        offset: 4242,
        discriminator: 'text',
      });
      expect(sameRowIdentity(output[0].rowIdentity!, boundaryRow)).toBe(false);
    });

    it('makes row-key collisions impossible under adversarial multi-row projections', () => {
      const contents = [
        aiText('one'),
        aiToolCall('c1'),
        toolResponse('c1'),
        aiText('two'),
        aiToolCall('c2'),
        toolResponse('c2'),
        aiText('three'),
        aiToolCall('c3'),
        toolResponse('c3'),
      ];
      const offsets = contents.map((_, index) => 1000 + index * 10);
      const output = iContentToHistoryItems(contents, 'allowed', {
        envelopeOffsets: offsets,
      });

      const keys = output.map((item) => rowIdentityKey(item.rowIdentity!));
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('keeps the source identity on the blocked error replacement and none on synthesized feedback', () => {
      const blocked = iContentToHistoryItems(
        [{ speaker: 'ai', blocks: [{ type: 'text', text: 'Done \u2705' }] }],
        'error',
        { envelopeOffsets: [64] },
      );
      expect(blocked).toHaveLength(1);
      expect(blocked[0].type).toBe('error');
      expect(blocked[0].rowIdentity).toStrictEqual({
        kind: 'journal',
        offset: 64,
        discriminator: 'text',
      });

      const warned = iContentToHistoryItems(
        [{ speaker: 'ai', blocks: [{ type: 'text', text: 'Done \u2705' }] }],
        'warn',
        { envelopeOffsets: [64] },
      );
      expect(warned).toHaveLength(2);
      expect(warned[0].type).toBe('gemini');
      expect(warned[0].rowIdentity).toStrictEqual({
        kind: 'journal',
        offset: 64,
        discriminator: 'text',
      });
      expect(warned[1].type).toBe('info');
      expect(warned[1].rowIdentity).toBeUndefined();
    });
  });

  describe('historyLedger identity threading', () => {
    it('locates a resident row by identity without a session-sized lookup contract change', () => {
      const ledger = createHistoryLedger({
        maxItems: 100,
        maxBytes: 1_000_000,
      });
      const identity = rowIdentity({ kind: 'journal', offset: 500 }, 'text');
      ledger.append(userItem(1, identity));
      ledger.append(
        userItem(2, rowIdentity({ kind: 'journal', offset: 600 }, 'text')),
      );

      expect(ledger.findIndexByIdentity(identity)).toBe(0);
      expect(
        ledger.findIndexByIdentity(
          rowIdentity({ kind: 'journal', offset: 999 }, 'text'),
        ),
      ).toBe(-1);
      expect(
        ledger.findIndexByIdentity(
          rowIdentity({ kind: 'journal', offset: 500 }, 'toolGroup'),
        ),
      ).toBe(-1);
    });

    it('preserves the identity through the oversized display-bound fallback', () => {
      const ledger = createHistoryLedger({ maxItems: 100, maxBytes: 200 });
      const identity = rowIdentity(
        { kind: 'journal', offset: 700 },
        'toolGroup',
      );
      ledger.append({
        id: 3,
        type: 'tool_group',
        rowIdentity: identity,
        tools: [
          {
            callId: 'c1',
            name: 'read_file',
            description: 'read a big file',
            resultDisplay: 'x'.repeat(500),
            status: 'success' as never,
            confirmationDetails: undefined,
          },
        ],
      });

      const entry = ledger.getState().entries[0];
      expect(entry.item.type).toBe('info');
      expect(entry.item.rowIdentity).toStrictEqual(identity);
    });

    it('keeps the identity across an update and a load', () => {
      const ledger = createHistoryLedger({
        maxItems: 100,
        maxBytes: 1_000_000,
      });
      const identity = rowIdentity({ kind: 'journal', offset: 500 }, 'text');
      ledger.append(userItem(1, identity));
      ledger.update(1, (prev) => ({ text: `${prev.text}-updated` }));
      expect(ledger.getState().entries[0].item.rowIdentity).toStrictEqual(
        identity,
      );

      const reloaded = createHistoryLedger({
        maxItems: 100,
        maxBytes: 1_000_000,
      });
      reloaded.load([userItem(9, identity)]);
      expect(reloaded.getState().entries[0].item.rowIdentity).toStrictEqual(
        identity,
      );
      expect(reloaded.findIndexByIdentity(identity)).toBe(0);
    });
  });
});
