/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { rowPieceParts, rowSourceParts } from './rowPiece.js';

describe('ROW byte sources', () => {
  it('preserves piece CRCs across empty, synchronous and asynchronous sources', async () => {
    const bytes = new TextEncoder().encode(
      'quote " newline\n unicode ' + String.fromCharCode(0xd83c, 0xdf19),
    );
    const actual = await Array.fromAsync(
      rowSourceParts([
        { length: 0, chunks: [] },
        {
          length: bytes.length,
          chunks: [bytes.subarray(0, 3), bytes.subarray(3)],
        },
        {
          length: bytes.length,
          chunks: (async function* () {
            for (const byte of bytes) yield new Uint8Array([byte]);
          })(),
        },
      ]),
    );
    const expected = Array.from(
      rowPieceParts([new Uint8Array(), bytes, bytes]),
    );
    expect(Buffer.concat(actual)).toStrictEqual(Buffer.concat(expected));
  });
  it('rejects a byte source whose declared length does not match its output', async () => {
    await expect(
      Array.fromAsync(
        rowSourceParts([{ length: 2, chunks: [new Uint8Array([1])] }]),
      ),
    ).rejects.toThrow('ROW byte source length mismatch');
  });
});
