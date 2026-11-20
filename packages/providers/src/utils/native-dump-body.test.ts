/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { gcAndSweep } from 'bun:jsc';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import {
  NativeDumpBody,
  nativeDumpLiteral,
  nativeDumpSeparatedValue,
  nativeDumpValue,
  type NativeDumpPiece,
} from './native-dump-body.js';
import { dumpSDKRequestContext } from './dumpSDKContext.js';

describe('native dump stream cleanup', () => {
  const parent = join(import.meta.dir, '../../../../tmp/dump-native');
  let root: string;
  let storage: ReturnType<typeof spyOn<typeof Storage, 'getGlobalCacheDir'>>;
  beforeEach(async () => {
    await mkdir(parent, { recursive: true });
    root = await mkdtemp(join(parent, 'capture-'));
    storage = spyOn(Storage, 'getGlobalCacheDir').mockReturnValue(root);
  });
  afterEach(async () => {
    storage.mockRestore();
    await rm(root, { recursive: true, force: true });
  });

  it('emits only nonempty wire chunks while retaining diagnostic-only pieces', async () => {
    const body = new NativeDumpBody(async function* () {
      yield nativeDumpLiteral('', '{"messages":');
      yield nativeDumpLiteral('[]', '[]}');
      yield nativeDumpLiteral('');
    });
    const result = await dumpSDKRequestContext(
      'test',
      '/messages',
      body.dump,
      'http://local',
    );
    const chunks: Uint8Array[] = [];
    for await (const chunk of body.stream()) chunks.push(chunk);
    await body.dispose();
    expect(chunks).toStrictEqual([Buffer.from('[]')]);
    expect(
      await Bun.file(join(result.dumpDir, result.requestFilename)).json(),
    ).toMatchObject({ request: { body: { messages: [] } } });
  });

  it('removes an incomplete dump when cancellation aborts its remaining source', async () => {
    const signal = new AbortController();
    const body = new NativeDumpBody(async function* () {
      signal.signal.throwIfAborted();
      yield nativeDumpLiteral('{"messages":[');
      signal.signal.throwIfAborted();
      yield nativeDumpLiteral(']}');
    });
    await dumpSDKRequestContext('test', '/messages', body.dump, 'http://local');
    const stream = body.stream();
    await stream.next();
    signal.abort(new Error('cancelled source'));
    await expect(stream.return(undefined)).rejects.toThrow('cancelled source');
    await body.dispose();
    expect(await readdir(join(root, 'dumps'))).toStrictEqual([]);
  });

  it('finishes a dump from the same iterator when the HTTP consumer stops at Content-Length', async () => {
    let walks = 0;
    const body = new NativeDumpBody(async function* () {
      walks++;
      yield nativeDumpLiteral('{"messages":[]}');
    });
    const result = await dumpSDKRequestContext(
      'test',
      '/messages',
      body.dump,
      'http://local',
    );
    expect(walks).toBe(0);
    const stream = body.stream();
    expect((await stream.next()).value).toStrictEqual(
      Buffer.from('{"messages":[]}'),
    );
    await stream.return(undefined);
    await body.dispose();
    expect(walks).toBe(1);
    const dump: unknown = await Bun.file(
      join(result.dumpDir, result.requestFilename),
    ).json();
    expect(dump).toMatchObject({ request: { body: { messages: [] } } });
  });
});

type ListPieces = (
  values: AsyncIterable<{ readonly content: string }>,
) => AsyncGenerator<NativeDumpPiece>;

/**
 * Serializes three list values and, while the consumer holds each `,`
 * separator, collects garbage and reports which values are still live.
 */
async function liveValuesAtSeparators(list: ListPieces): Promise<boolean[][]> {
  const values: Array<WeakRef<object>> = [];
  async function* source(): AsyncGenerator<{ readonly content: string }> {
    for (let index = 0; index < 3; index++) {
      await sleep(0);
      const value = { content: `${index}:`.padEnd(64 * 1024, '雪') };
      values.push(new WeakRef(value));
      yield value;
    }
  }
  const live: boolean[][] = [];
  for await (const piece of list(source())) {
    if (Buffer.from(piece.wire).toString() !== ',') continue;
    await sleep(0);
    gcAndSweep();
    live.push(values.map((value) => value.deref() !== undefined));
  }
  return live;
}

describe('native dump list values', () => {
  it('holds only the value whose separator the consumer is reading', async () => {
    const live = await liveValuesAtSeparators(async function* (values) {
      let separator = '';
      for await (const value of values) {
        yield* nativeDumpSeparatedValue(separator, value);
        separator = ',';
      }
    });
    expect(live).toStrictEqual([
      [false, true],
      [false, false, true],
    ]);
  });

  it('detects the previous value a separator yielded on its own keeps live', async () => {
    const live = await liveValuesAtSeparators(async function* (values) {
      let separator = '';
      for await (const value of values) {
        yield nativeDumpLiteral(separator);
        yield* nativeDumpValue(value);
        separator = ',';
      }
    });
    expect(live).toStrictEqual([
      [true, true],
      [false, true, true],
    ]);
  });
});
