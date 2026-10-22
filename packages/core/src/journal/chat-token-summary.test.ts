/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { crc32 } from 'node:zlib';
import {
  encodeSlotSummary,
  decodeSlotSummary,
  type ChatSummary,
} from './slotSummary.js';
import {
  identitySlotSummary,
  composeSlotSummaries,
} from './summaryComposition.js';
import {
  createJournalHeader,
  encodeJournalHeader,
  decodeJournalHeader,
} from './fileHeader.js';

describe('stored Chat token summaries', () => {
  it('persists and composes both token variants without changing wire transfer counters', () => {
    const identity = identitySlotSummary('chat');
    if (identity.kind !== 'chat') throw new Error('Chat identity required');
    const left: ChatSummary = { ...identity, tokens: [13, 7] };
    const right: ChatSummary = { ...identity, tokens: [19, 11] };
    const combined = composeSlotSummaries(left, right);
    const decoded = decodeSlotSummary(encodeSlotSummary(combined), {
      summaryKind: 'chat',
    });
    expect(decoded).toStrictEqual({ ...identity, tokens: [32, 18] });
  });

  it('persists normalized unit ranks and composes the last thinking coordinate associatively', () => {
    const identity = identitySlotSummary('chat');
    if (identity.kind !== 'chat') throw new Error('Chat identity required');
    const first: ChatSummary = {
      ...identity,
      thinkingRank: { units: 4, last: 2 },
    };
    const middle: ChatSummary = {
      ...identity,
      thinkingRank: { units: 3, last: 0 },
    };
    const last: ChatSummary = {
      ...identity,
      thinkingRank: { units: 5, last: 4 },
    };
    const combine = composeSlotSummaries(
      composeSlotSummaries(first, middle),
      last,
    );
    expect(combine).toStrictEqual(
      composeSlotSummaries(first, composeSlotSummaries(middle, last)),
    );
    expect(
      decodeSlotSummary(encodeSlotSummary(combine), { summaryKind: 'chat' }),
    ).toStrictEqual({ ...identity, thinkingRank: { units: 12, last: 11 } });
    expect(composeSlotSummaries(first, middle)).toStrictEqual({
      ...identity,
      thinkingRank: { units: 7, last: 2 },
    });
  });

  it('refuses unknown rank revisions, impossible coordinates and nonzero reserved bytes', () => {
    const identity = identitySlotSummary('chat');
    if (identity.kind !== 'chat') throw new Error('Chat identity required');
    const original = encodeSlotSummary({
      ...identity,
      thinkingRank: { units: 2, last: 1 },
    });
    for (const [offset, value] of [
      [272, 2],
      [276, 0],
      [280, 3],
      [284, 1],
    ]) {
      const changed = original.slice();
      new DataView(changed.buffer).setUint32(offset, value, true);
      expect(() => decodeSlotSummary(changed, { summaryKind: 'chat' })).toThrow(
        /padding|thinking rank/,
      );
    }
  });
  it('refuses a CRC-valid pre-token-summary journal', () => {
    const bytes = encodeJournalHeader(createJournalHeader(Date.now));
    const view = new DataView(bytes.buffer);
    view.setUint32(8, 8, true);
    view.setUint32(60, crc32(bytes.subarray(0, 60)), true);
    expect(() => decodeJournalHeader(bytes)).toThrow('format version mismatch');
  });
});
