/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from './rowOwnership.js';

describe('shared row ownership', () => {
  it('keeps consumer ownership after the producer releases and counts identities once', () => {
    const meter = new RowOwnership();
    const row = { text: 'λ' };
    meter.retain(row);
    meter.retain(row);
    meter.release(row);
    expect(meter.snapshot()).toMatchObject({
      liveRows: 1,
      peakRows: 1,
      acquisitions: 2,
    });
    expect(meter.snapshot().liveSerializedBytes).toBe(
      Buffer.byteLength(JSON.stringify(row)),
    );
    meter.release(row);
    expect(meter.snapshot().liveRows).toBe(0);
    expect(() => meter.release(row)).toThrow('Unowned');
  });
});

describe('retention peak predicate', () => {
  it('rejects retained consumers with the same peak predicate after producer exhaustion', () => {
    const meter = new RowOwnership();
    const retained = [];
    for (let index = 0; index < 100; index += 1) {
      const row = { text: String(index) };
      meter.retain(row);
      meter.retain(row);
      retained.push(row);
      meter.release(row);
    }
    expect(meter.within({ rows: 4, serializedBytes: 1024 })).toBe(false);
    expect(meter.snapshot().liveRows).toBe(100);
    for (const row of retained) meter.release(row);
    expect(meter.snapshot().liveRows).toBe(0);
  });
});

describe('copied row ownership', () => {
  it('counts overlapping copies separately and preserves the peak after release', () => {
    const meter = new RowOwnership();
    const first = { text: 'abc' };
    const copy = { ...first };
    meter.retain(first);
    meter.retain(copy);
    meter.release(first);
    meter.release(copy);
    expect(meter.snapshot()).toMatchObject({
      liveRows: 0,
      peakRows: 2,
      liveSerializedBytes: 0,
    });
    expect(meter.within({ rows: 1, serializedBytes: 1024 })).toBe(false);
    expect(meter.within({ rows: 2, serializedBytes: 1 })).toBe(false);
    expect(meter.within({ rows: 2, serializedBytes: 1024 })).toBe(true);
  });
});
