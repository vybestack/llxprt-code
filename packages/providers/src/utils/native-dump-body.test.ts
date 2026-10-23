/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import { NativeDumpBody, nativeDumpLiteral } from './native-dump-body.js';
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
