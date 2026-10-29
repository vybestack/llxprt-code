/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  decodeSlotSummary,
  encodeSlotSummary,
  type ChatSummary,
} from './slotSummary.js';
import {
  composeSlotSummaries,
  identityAffineTable,
  CHAT_MEDIA_PENDING_MASK,
} from './summaryComposition.js';

describe('Chat continuation omission summary', () => {
  it('keeps both six-state transfer variants and token fields intact beside a wide omission value', () => {
    const variant = {
      ...identityAffineTable(6, CHAT_MEDIA_PENDING_MASK),
      bytes: [11, 23, 37, 41, 59, 61],
      count: [1, 2, 3, 4, 5, 6],
      p: [71, 83, 97, 101, 103, 107],
    };
    const summary: ChatSummary = {
      kind: 'chat',
      variants: [
        variant,
        { ...variant, bytes: [109, 127, 131, 137, 139, 149] },
      ],
      tokens: [157, 163],
      thinkingRank: { units: 167, last: 151 },
      omittedReasoningBytes: 2 ** 40 + 173,
    };
    const encoded = encodeSlotSummary(summary);
    expect(encoded.length).toBe(296);
    expect(new DataView(encoded.buffer).getBigUint64(284, true)).toBe(
      BigInt(2 ** 40 + 173),
    );
    expect(decodeSlotSummary(encoded, { summaryKind: 'chat' })).toStrictEqual(
      summary,
    );
  });
  it('persists and composes typed continuation byte contributions without changing the transfer states', () => {
    const variant = identityAffineTable(6, CHAT_MEDIA_PENDING_MASK);
    const left: ChatSummary = {
      kind: 'chat',
      variants: [variant, variant],
      tokens: [17, 11],
      thinkingRank: { units: 2, last: 1 },
      omittedReasoningBytes: 31,
    };
    const right: ChatSummary = {
      ...left,
      thinkingRank: { units: 3, last: 2 },
      omittedReasoningBytes: 47,
    };
    const encoded = encodeSlotSummary(left);
    expect(new DataView(encoded.buffer).getUint32(272, true)).toBe(2);
    expect(decodeSlotSummary(encoded, { summaryKind: 'chat' })).toStrictEqual(
      left,
    );
    const combined = composeSlotSummaries(left, right);
    expect(combined).toStrictEqual({
      ...left,
      tokens: [34, 22],
      thinkingRank: { units: 5, last: 4 },
      omittedReasoningBytes: 78,
    });
    expect(
      decodeSlotSummary(encodeSlotSummary(combined), { summaryKind: 'chat' }),
    ).toStrictEqual(combined);
    const corrupted = encoded.slice();
    corrupted[292] = 1;
    expect(() => decodeSlotSummary(corrupted, { summaryKind: 'chat' })).toThrow(
      /padding/,
    );
  });
});
