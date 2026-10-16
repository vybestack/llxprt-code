/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalFormatError } from './errors.js';
import {
  AGGREGATE_BYTES,
  AGGREGATE_LAYOUT,
  AGGREGATE_PLAIN_BYTES,
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
  it('is 1,144 bytes: a 256-byte plain part and three 296-byte summary slots', () => {
    expect(AGGREGATE_BYTES).toBe(1144);
    expect(AGGREGATE_PLAIN_BYTES).toBe(256);
    expect(AGGREGATE_PLAIN_BYTES + 3 * 296).toBe(1144);
    expect(encodeAggregate(randomAggregate(new SeededRandom(1))).length).toBe(
      1144,
    );
  });

  it('lays the plain fields out contiguously, 252 bytes plus 4 reserved', () => {
    const { reserved, summaries, ...fields } = AGGREGATE_LAYOUT;

    assertContiguous(fields, 252);
    expect(reserved).toStrictEqual({ offset: 252, size: 4 });
    expect(summaries).toStrictEqual({ offset: 256, size: 888 });
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

  it('round-trips randomized aggregates, summary slots included', () => {
    const random = new SeededRandom(3);
    for (let round = 0; round < 300; round++) {
      const aggregate = randomAggregate(random);
      expect(decodeAggregate(encodeAggregate(aggregate))).toStrictEqual(
        aggregate,
      );
    }
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
    dirty[254] = 1;

    expect(() => decodeAggregate(bytes.subarray(0, 1143))).toThrow(
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
