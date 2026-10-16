/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { MUTATION, RECORD_KIND, isRecordKind } from './recordKinds.js';

describe('record kinds', () => {
  it('have the codes of design section 2.3', () => {
    expect(RECORD_KIND).toStrictEqual({
      ROW: 0x01,
      RTNODE: 0x02,
      ITNODE: 0x03,
      LENS: 0x04,
      VALUE: 0x05,
      EVENT: 0x06,
      TRAILER: 0x7f,
    });
  });

  it('recognizes exactly those codes', () => {
    const known: ReadonlySet<number> = new Set(Object.values(RECORD_KIND));
    for (let code = 0; code < 256; code++) {
      expect(isRecordKind(code)).toBe(known.has(code));
    }
  });
});

describe('mutation codes', () => {
  it('number the mutations of design section 2.5 in their listed order, from 1', () => {
    expect(MUTATION).toStrictEqual({
      append: 1,
      pop: 2,
      compress: 3,
      replace: 4,
      density: 5,
      purge: 6,
      clear: 7,
      insert: 8,
      owner: 9,
      fill: 10,
      state: 11,
      clone: 12,
      restore: 13,
    });
  });
});
