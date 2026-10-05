/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  streamPrettyCheckpointJson,
  CheckpointHistoryArray,
} from './pretty-json-stream.js';

async function encode(value: object): Promise<string> {
  let encoded = '';
  for await (const chunk of streamPrettyCheckpointJson(value)) encoded += chunk;
  return encoded;
}

describe('checkpoint pretty JSON compatibility', () => {
  it('matches JSON.stringify for escaping, omitted fields, sparse arrays, toJSON and scalar values', async () => {
    const value = {
      string:
        'q'.repeat(2047) +
        '🐈' +
        '\ud800\udc00\ud800\udc00\udc00\ud800\u0000\b\t\n\f\r"\\' +
        '中'.repeat(8192),
      array: [
        undefined,
        null,
        NaN,
        Infinity,
        -Infinity,
        -0,
        ...Array<unknown>(1),
        true,
        false,
        Symbol('omit'),
      ],
      sparse: Array<unknown>(1),
      omitted: undefined,
      fn: () => {},
      symbol: Symbol('omit'),
      number: new Number(3),
      boolean: new Boolean(false),
      boxed: new String('boxed'),
      date: new Date('2026-10-02T00:00:00Z'),
      custom: { toJSON: (key: string) => ({ key }) },
      empty: [{}, []],
    };
    expect(await encode(value)).toBe(JSON.stringify(value, null, 2));
  });

  it('rejects boxed BigInt rather than silently dropping its value', async () => {
    await expect(encode({ value: Object(1n) })).rejects.toThrow(
      /BigInt|bigint/,
    );
  });

  it('rejects cycles and closes a streamed row source on encoding failure', async () => {
    const row: { self?: object } = {};
    row.self = row;
    let closed = false;
    const source = {
      async *[Symbol.asyncIterator]() {
        try {
          yield row;
        } finally {
          closed = true;
        }
      },
    };
    await expect(
      encode({ clientHistory: new CheckpointHistoryArray(source) }),
    ).rejects.toThrow('circular');
    expect(closed).toBe(true);
  });
});
