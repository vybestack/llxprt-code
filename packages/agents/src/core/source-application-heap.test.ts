/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { randomBytes } from 'node:crypto';
import {
  applicationHeapBytes,
  sourceApplicationHeap,
} from './__tests__/support/source-application-heap.js';

describe('source application heap measurement', () => {
  it('excludes compiled code while charging closures, strings, buffers and unfamiliar objects', () => {
    expect(
      applicationHeapBytes({
        nodes: [
          1, 2_000_000, 0, 0, 2, 100, 1, 0, 3, 200, 2, 0, 4, 300, 3, 0, 5, 400,
          4, 0, 6, 500, 5, 0,
        ],
        nodeClassNames: [
          'FunctionCodeBlock',
          'Function',
          'JSLexicalEnvironment',
          'string',
          'ArrayBuffer',
          'FutureApplicationOwner',
        ],
      }),
    ).toBe(1500);
  });

  it('rejects incomplete and invalid Inspector nodes rather than undercounting them', () => {
    expect(() =>
      applicationHeapBytes({ nodes: [1, 2, 0], nodeClassNames: ['Object'] }),
    ).toThrow('Incomplete Inspector node');
    expect(() =>
      applicationHeapBytes({
        nodes: [1, -2, 0, 0],
        nodeClassNames: ['Object'],
      }),
    ).toThrow('Invalid Inspector node');
    expect(() =>
      applicationHeapBytes({ nodes: [1, 2, 1, 0], nodeClassNames: ['Object'] }),
    ).toThrow('Invalid Inspector node');
  });

  it('detects a retained cloned string independently of row identity', async () => {
    const baseline = await sourceApplicationHeap();
    const held = randomBytes(1024 * 1024).toString('hex');
    const retained = await sourceApplicationHeap();
    expect(held).toHaveLength(2 * 1024 * 1024);
    expect(retained - baseline).toBeGreaterThan(1024 * 1024);
  }, 60_000);

  it('detects retained native buffer storage as application memory', async () => {
    const baseline = await sourceApplicationHeap();
    const held = Buffer.alloc(2 * 1024 * 1024, 42);
    const retained = await sourceApplicationHeap();
    expect(held.byteLength).toBe(2 * 1024 * 1024);
    expect(held[held.byteLength - 1]).toBe(42);
    expect(retained - baseline).toBeGreaterThan(1024 * 1024);
  }, 60_000);
});
