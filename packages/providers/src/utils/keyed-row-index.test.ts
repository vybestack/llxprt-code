/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import { textRow } from '../__tests__/requestRowsTestSupport.js';
import { KeyedRowIndex } from './keyed-row-index.js';

function scratchNames(): Set<string> {
  return new Set(readdirSync(getScratchRoot()));
}

function textOf(row: IContent): string {
  const block = row.blocks[0];
  if (block.type !== 'text') throw new Error('Expected a text block');
  return block.text;
}

async function* streamOf(rows: IContent[]): AsyncGenerator<IContent> {
  yield* rows;
}

describe('KeyedRowIndex', () => {
  it('stores JSON values by key, answers has() and returns undefined for unset keys', () => {
    const index = KeyedRowIndex.create('keyed-row-index-test');
    try {
      index.set('a', { mapped: 'x', n: 3 });
      index.set('b', 1);
      expect(index.get('a')).toStrictEqual({ mapped: 'x', n: 3 });
      expect(index.has('b')).toBe(true);
      expect(index.has('missing')).toBe(false);
      expect(index.get('missing')).toBeUndefined();
    } finally {
      index.close();
    }
  });

  it('keeps the last write for a key', () => {
    const index = KeyedRowIndex.create('keyed-row-index-test');
    try {
      index.set('k', 'first');
      index.set('k', 'second');
      expect(index.get('k')).toBe('second');
    } finally {
      index.close();
    }
  });

  it('keeps every key through table growth and similar-looking keys apart', () => {
    const index = KeyedRowIndex.create('keyed-row-index-test');
    try {
      for (let i = 0; i < 2000; i++) index.set(`id:${i}`, i);
      for (let i = 0; i < 2000; i += 97) expect(index.get(`id:${i}`)).toBe(i);
      expect(index.has('id:2000')).toBe(false);
      expect(index.has('id:')).toBe(false);
    } finally {
      index.close();
    }
  });

  it('builds from rows in order, one observe call per row', async () => {
    const rows = ['one', 'two', 'three'].map((text) => textRow(text));
    const seen: string[] = [];
    const index = await KeyedRowIndex.build(
      'keyed-row-index-test',
      streamOf(rows),
      (row, keys) => {
        seen.push(textOf(row));
        keys.set(`text:${textOf(row)}`, seen.length);
      },
    );
    try {
      expect(seen).toStrictEqual(['one', 'two', 'three']);
      expect(index.get('text:three')).toBe(3);
      expect(index.has('text:four')).toBe(false);
    } finally {
      index.close();
    }
  });

  it('removes its directory on close, and closing twice is harmless', () => {
    const before = scratchNames();
    const index = KeyedRowIndex.create('keyed-row-index-test');
    expect(scratchNames().size).toBe(before.size + 1);
    index.close();
    index.close();
    expect(scratchNames()).toStrictEqual(before);
  });

  it('refuses reads and writes after close', () => {
    const index = KeyedRowIndex.create('keyed-row-index-test');
    index.close();
    expect(() => index.get('a')).toThrow('closed');
    expect(() => index.set('a', 1)).toThrow('closed');
  });

  it('removes the directory and rethrows when observe fails', async () => {
    const before = scratchNames();
    const failure = new Error('observe failed');
    await expect(
      KeyedRowIndex.build(
        'keyed-row-index-test',
        streamOf([textRow('a'), textRow('b')]),
        () => {
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
    expect(scratchNames()).toStrictEqual(before);
  });

  it('stops on abort between rows, with the abort reason, and leaves no directory', async () => {
    const before = scratchNames();
    const controller = new AbortController();
    const reason = new Error('aborted while indexing');
    let observed = 0;
    await expect(
      KeyedRowIndex.build(
        'keyed-row-index-test',
        streamOf([textRow('a'), textRow('b'), textRow('c')]),
        () => {
          observed++;
          controller.abort(reason);
        },
        controller.signal,
      ),
    ).rejects.toBe(reason);
    expect(observed).toBe(1);
    expect(scratchNames()).toStrictEqual(before);
  });

  it('closes the source stream when the build fails', async () => {
    let closed = false;
    async function* source(): AsyncGenerator<IContent> {
      try {
        yield textRow('a');
        yield textRow('b');
      } finally {
        closed = true;
      }
    }
    await expect(
      KeyedRowIndex.build('keyed-row-index-test', source(), () => {
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');
    expect(closed).toBe(true);
  });
});
