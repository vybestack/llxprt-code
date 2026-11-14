/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalFormatError } from './errors.js';
import {
  type Aggregate,
  AGGREGATE_BYTES,
  AGGREGATE_LAYOUT,
  AGGREGATE_PLAIN_BYTES,
  NO_LABEL,
  decodeAggregate,
  encodeAggregate,
  encodeAggregateInto,
} from './aggregate.js';
import { assertContiguous } from './__tests__/support/layoutChecks.js';
import { randomAggregate } from './__tests__/support/randomRecords.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

describe('aggregate', () => {
  it('is 1,208 bytes: a 320-byte plain part and three 296-byte summary slots', () => {
    expect(AGGREGATE_BYTES).toBe(1208);
    expect(AGGREGATE_PLAIN_BYTES).toBe(320);
    expect(AGGREGATE_PLAIN_BYTES + 3 * 296).toBe(1208);
    expect(encodeAggregate(randomAggregate(new SeededRandom(1))).length).toBe(
      1208,
    );
  });

  it('lays the plain fields out contiguously, 316 bytes plus 4 reserved', () => {
    const { reserved, summaries, ...fields } = AGGREGATE_LAYOUT;

    assertContiguous(fields, 316);
    expect(reserved).toStrictEqual({ offset: 316, size: 4 });
    expect(summaries).toStrictEqual({ offset: 320, size: 888 });
  });

  it('sizes each field group as the design table does', () => {
    const sizes = Object.fromEntries(
      Object.entries(AGGREGATE_LAYOUT).map(([name, span]) => [name, span.size]),
    );

    expect(sizes.rows + sizes.curated + sizes.units).toBe(12);
    expect(sizes.tokens + sizes.tokensMissing).toBe(48);
    expect(sizes.liveBytes).toBe(8);
    expect(sizes.mediaChars).toBe(8);
    expect(sizes.imageChars).toBe(24);
    expect(sizes.pdfBytes).toBe(24);
    expect(
      sizes.imageRows +
        sizes.thinkingRows +
        sizes.callRows +
        sizes.reconRows +
        sizes.pairSensitiveRows +
        sizes.imageContribRows,
    ).toBe(24);
    expect(sizes.callBlocks + sizes.unmappedBlocks).toBe(8);
    expect(
      sizes.lastThinking + sizes.lastInvalidate + sizes.lastCacheable,
    ).toBe(24);
    expect(sizes.firstAnchor + sizes.firstImage).toBe(16);
    expect(sizes.ownerBloom).toBe(8);
    expect(sizes.missingBase + sizes.missingImg).toBe(24);
    expect(sizes.stamp).toBe(24);
  });

  it('writes each field at its layout offset', () => {
    const aggregate = randomAggregate(new SeededRandom(2));
    const view = viewOf(encodeAggregate(aggregate));
    const at = AGGREGATE_LAYOUT;

    expect(view.getUint32(at.rows.offset, true)).toBe(aggregate.rows);
    expect(view.getUint32(at.units.offset, true)).toBe(aggregate.units);
    expect(Number(view.getBigUint64(at.tokens.offset + 24, true))).toBe(
      aggregate.tokens[3],
    );
    expect(view.getUint32(at.tokensMissing.offset + 12, true)).toBe(
      aggregate.tokensMissing[3],
    );
    expect(Number(view.getBigUint64(at.liveBytes.offset, true))).toBe(
      aggregate.liveBytes,
    );
    expect(Number(view.getBigUint64(at.imageChars.offset + 16, true))).toBe(
      aggregate.imageChars[2],
    );
    expect(view.getUint32(at.imageContribRows.offset, true)).toBe(
      aggregate.imageContribRows,
    );
    expect(view.getBigUint64(at.lastCacheable.offset, true)).toBe(
      aggregate.lastCacheable,
    );
    expect(view.getBigUint64(at.ownerBloom.offset, true)).toBe(
      aggregate.ownerBloom,
    );
    expect(view.getUint32(at.missingImg.offset + 8, true)).toBe(
      aggregate.missingImg[2],
    );
    expect(view.getUint32(at.stamp.offset + 16, true)).toBe(
      aggregate.stamp[2].gen,
    );
    expect(view.getUint32(at.stamp.offset + 20, true)).toBe(
      aggregate.stamp[2].imageGen,
    );
  });

  it('writes the statistics counters and last-row fields at the offsets of design 2.5', () => {
    const base = randomAggregate(new SeededRandom(5));
    const aggregate: Aggregate = {
      ...base,
      humanRows: 11,
      aiRows: 12,
      toolCallBlocks: 13,
      responseBlocks: 14,
      noChronologyRows: 15,
      firstSeq: 0xffff_ffff_ffff_ffffn,
      lastSeq: 0x0123_4567_89ab_cdefn,
      lastHuman: 21n,
      lastAi: 22n,
      lastTool: 23n,
    };

    const view = viewOf(encodeAggregate(aggregate));

    const at = AGGREGATE_LAYOUT;
    expect(view.getUint32(at.humanRows.offset, true)).toBe(11);
    expect(view.getUint32(at.aiRows.offset, true)).toBe(12);
    expect(view.getUint32(at.toolCallBlocks.offset, true)).toBe(13);
    expect(view.getUint32(at.responseBlocks.offset, true)).toBe(14);
    expect(view.getUint32(at.noChronologyRows.offset, true)).toBe(15);
    expect(view.getBigUint64(at.firstSeq.offset, true)).toBe(
      0xffff_ffff_ffff_ffffn,
    );
    expect(view.getBigUint64(at.lastSeq.offset, true)).toBe(
      0x0123_4567_89ab_cdefn,
    );
    expect(view.getBigUint64(at.lastHuman.offset, true)).toBe(21n);
    expect(view.getBigUint64(at.lastAi.offset, true)).toBe(22n);
    expect(view.getBigUint64(at.lastTool.offset, true)).toBe(23n);
  });

  it('round-trips randomized aggregates, summary slots included', () => {
    const random = new SeededRandom(3);
    for (let round = 0; round < 300; round++) {
      const aggregate = randomAggregate(random);
      expect(decodeAggregate(encodeAggregate(aggregate))).toStrictEqual(
        aggregate,
      );
    }
  });

  it('stores 0 for a max-label or min-label field that no row qualifies for', () => {
    const labelFields = [
      'lastThinking',
      'lastInvalidate',
      'lastCacheable',
      'firstAnchor',
      'firstImage',
    ] as const;
    const empty: Aggregate = {
      ...randomAggregate(new SeededRandom(8)),
      lastThinking: NO_LABEL,
      lastInvalidate: NO_LABEL,
      lastCacheable: NO_LABEL,
      firstAnchor: NO_LABEL,
      firstImage: NO_LABEL,
    };

    const bytes = encodeAggregate(empty);
    const view = viewOf(bytes);

    expect(NO_LABEL).toBe(0n);
    for (const field of labelFields) {
      expect(view.getBigUint64(AGGREGATE_LAYOUT[field].offset, true)).toBe(0n);
    }
    expect(decodeAggregate(bytes)).toStrictEqual(empty);
    for (const field of labelFields) {
      const one = { ...empty, [field]: 1n };
      expect(decodeAggregate(encodeAggregate(one))[field]).toBe(1n);
    }
  });

  it('encodes an aggregate with no rows as all zero bytes', () => {
    const zeros = [0, 0, 0] as const;
    const none: Aggregate = {
      rows: 0,
      curated: 0,
      units: 0,
      tokens: [0, 0, 0, 0],
      tokensMissing: [0, 0, 0, 0],
      liveBytes: 0,
      mediaChars: 0,
      imageChars: zeros,
      pdfBytes: zeros,
      imageRows: 0,
      mediaContribRows: 0,
      thinkingRows: 0,
      callRows: 0,
      reconRows: 0,
      pairSensitiveRows: 0,
      imageContribRows: 0,
      callBlocks: 0,
      unmappedBlocks: 0,
      humanRows: 0,
      aiRows: 0,
      toolCallBlocks: 0,
      responseBlocks: 0,
      noChronologyRows: 0,
      firstSeq: 0n,
      lastSeq: 0n,
      lastHuman: NO_LABEL,
      lastAi: NO_LABEL,
      lastTool: NO_LABEL,
      lastThinking: NO_LABEL,
      lastInvalidate: NO_LABEL,
      lastCacheable: NO_LABEL,
      firstAnchor: NO_LABEL,
      firstImage: NO_LABEL,
      ownerBloom: 0n,
      missingBase: zeros,
      missingImg: zeros,
      stamp: [
        { gen: 0, imageGen: 0 },
        { gen: 0, imageGen: 0 },
        { gen: 0, imageGen: 0 },
      ],
      summaries: [
        new Uint8Array(296),
        new Uint8Array(296),
        new Uint8Array(296),
      ],
    };

    const bytes = encodeAggregate(none);

    expect(bytes.every((byte) => byte === 0)).toBe(true);
    expect(decodeAggregate(bytes)).toStrictEqual(none);
  });

  it('writes into and reads from an offset inside a larger record', () => {
    const aggregate = randomAggregate(new SeededRandom(4));
    const record = new Uint8Array(40 + AGGREGATE_BYTES + 9);

    encodeAggregateInto(record, 40, aggregate);

    expect(decodeAggregate(record, 40)).toStrictEqual(aggregate);
    expect(record.subarray(0, 40).every((b) => b === 0)).toBe(true);
    expect(record.subarray(40 + AGGREGATE_BYTES).every((b) => b === 0)).toBe(
      true,
    );
  });

  it('refuses values that do not fit their field and summaries of the wrong size', () => {
    const good = randomAggregate(new SeededRandom(5));

    expect(() => encodeAggregate({ ...good, rows: 2 ** 32 })).toThrow(/rows/);
    expect(() => encodeAggregate({ ...good, liveBytes: -1 })).toThrow(
      /liveBytes/,
    );
    expect(() => encodeAggregate({ ...good, ownerBloom: 1n << 64n })).toThrow(
      /ownerBloom/,
    );
    expect(() =>
      encodeAggregate({
        ...good,
        summaries: [good.summaries[0], new Uint8Array(295), good.summaries[2]],
      }),
    ).toThrow(/296/);
  });

  it('rejects an aggregate that is cut short or whose reserved bytes are not zero', () => {
    const bytes = encodeAggregate(randomAggregate(new SeededRandom(6)));
    const dirty = bytes.slice();
    dirty[316] = 1;

    expect(() => decodeAggregate(bytes.subarray(0, 1207))).toThrow(
      JournalFormatError,
    );
    expect(() => decodeAggregate(dirty)).toThrow(/reserved/);
  });

  it('refuses a u64 count that exceeds the exact integer range of a number', () => {
    const bytes = encodeAggregate(randomAggregate(new SeededRandom(7)));
    viewOf(bytes).setBigUint64(
      AGGREGATE_LAYOUT.liveBytes.offset,
      1n << 60n,
      true,
    );

    expect(() => decodeAggregate(bytes)).toThrow(/liveBytes/);
  });
});
