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

  it('refuses a CRC-valid pre-token-summary journal', () => {
    const bytes = encodeJournalHeader(createJournalHeader(Date.now));
    const view = new DataView(bytes.buffer);
    view.setUint32(8, 8, true);
    view.setUint32(60, crc32(bytes.subarray(0, 60)), true);
    expect(() => decodeJournalHeader(bytes)).toThrow('format version mismatch');
  });
});
