/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { SynchronousValueSpool } from './synchronous-value-spool.js';

function decodeText(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid text ticket');
  return value;
}

describe('disk ticket storage recycling', () => {
  it('restarts ordinals and preserves complete replacement values after draining', () => {
    let spool = new SynchronousValueSpool(decodeText);
    try {
      for (let index = 0; index < 512; index++) {
        const value = `${index}:\u0000é😀${'payload'.repeat(512 - index)}`;
        expect(spool.append(value)).toBe(0);
        expect(spool.read(0)).toBe(value);
        spool = spool.reset();
        expect(spool.length).toBe(0);
      }
      expect(() => spool.read(0)).toThrow('ordinal is invalid');
    } finally {
      spool.close();
    }
    expect(() => spool.reset()).toThrow('retired');
  });

  it('keeps all old disk values readable while a pinned reader survives recycling', () => {
    let spool = new SynchronousValueSpool(decodeText);
    const values = Array.from(
      { length: 512 },
      (_, index) => `${index}:é😀${'old-value'.repeat(index + 1)}`,
    );
    for (const value of values) spool.append(value);
    const reader = spool.pin();
    try {
      spool = spool.reset();
      expect(spool.length).toBe(0);
      const replacement = `replacement:${'new-value'.repeat(2048)}`;
      expect(spool.append(replacement)).toBe(0);
      spool.close();
      for (let index = 0; index < values.length; index++)
        expect(reader.read(index)).toBe(values[index]);
      expect(reader.length).toBe(values.length);
    } finally {
      reader.close();
      spool.close();
    }
    expect(() => reader.read(0)).toThrow('closed');
  });
});
