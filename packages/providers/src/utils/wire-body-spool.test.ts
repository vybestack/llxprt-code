/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { appendFileSync, existsSync, readdirSync, truncateSync } from 'node:fs';
import { dirname } from 'node:path';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import {
  BoundedJsonBody,
  DEFAULT_STREAMING_JSON_CHUNK_BYTES,
} from './boundedJsonBody.js';
import {
  activeWireBodySpoolCount,
  WireBodySpool,
  withSpooledJsonHttpBody,
} from './wire-body-spool.js';

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    chunks.push(next.value);
  }
  return Buffer.concat(chunks);
}

function rangeErrorOf(run: () => unknown): RangeError {
  try {
    run();
  } catch (error) {
    if (error instanceof RangeError) return error;
    throw error;
  }
  throw new Error('Expected a RangeError');
}

function openFdCount(): number {
  return readdirSync('/dev/fd').length;
}

function scratchNames(): Set<string> {
  return new Set(readdirSync(getScratchRoot()));
}

function sealedSpool(...parts: Array<string | Uint8Array>): WireBodySpool {
  const spool = WireBodySpool.create('wire-body-spool-test');
  for (const part of parts) spool.append(part);
  spool.seal();
  return spool;
}

describe('WireBodySpool', () => {
  let startingSpools: number;
  let startingFds: number;
  let startingScratch: Set<string>;
  const spools: WireBodySpool[] = [];

  function expectNothingLeaked(): void {
    expect(activeWireBodySpoolCount()).toBe(startingSpools);
    expect(openFdCount()).toBe(startingFds);
    expect(scratchNames()).toStrictEqual(startingScratch);
  }

  function track(spool: WireBodySpool): WireBodySpool {
    spools.push(spool);
    return spool;
  }

  beforeEach(() => {
    startingSpools = activeWireBodySpoolCount();
    startingFds = openFdCount();
    startingScratch = scratchNames();
  });

  afterEach(() => {
    for (const spool of spools.splice(0)) spool.dispose();
    expectNothingLeaked();
  });

  it('seals to the exact byte length and streams the bytes it was given', async () => {
    const spool = track(WireBodySpool.create('wire-body-spool-test'));
    spool.append('{"text":"');
    spool.append('héllo 😀');
    spool.append(new Uint8Array([0x22, 0x7d]));
    const length = spool.seal();

    const expected = Buffer.from('{"text":"héllo 😀"}', 'utf8');
    expect(length).toBe(expected.byteLength);
    expect(spool.byteLength).toBe(expected.byteLength);
    const handle = spool.openStream();
    expect((await readAll(handle.stream)).equals(expected)).toBe(true);
    handle.dispose();
  });

  it('streams a body larger than the write buffer and the read chunk in order', async () => {
    const spool = track(WireBodySpool.create('wire-body-spool-test'));
    const pieces: Buffer[] = [];
    for (let index = 0; index < 5000; index += 1) {
      const piece = Buffer.from(`${index},`.repeat(7), 'utf8');
      pieces.push(piece);
      spool.append(piece);
    }
    const big = Buffer.alloc(3 * DEFAULT_STREAMING_JSON_CHUNK_BYTES + 5, 0x61);
    pieces.push(big);
    spool.append(big);
    const expected = Buffer.concat(pieces);

    expect(spool.seal()).toBe(expected.byteLength);
    const handle = spool.openStream();
    expect((await readAll(handle.stream)).equals(expected)).toBe(true);
    handle.dispose();
  });

  it('fails past the envelope limit with the BoundedJsonBody error text', () => {
    const limit = 32;
    const oversized = 'x'.repeat(40);
    const bounded = rangeErrorOf(
      () =>
        new BoundedJsonBody(oversized, {
          maxChunkBytes: 16,
          maxEnvelopeBytes: limit,
        }),
    );
    const spool = track(
      WireBodySpool.create('wire-body-spool-test', { maxEnvelopeBytes: limit }),
    );

    const spooled = rangeErrorOf(() => spool.append(JSON.stringify(oversized)));

    expect(spooled.message).toBe(bounded.message);
  });

  it('defaults to the 128 MiB envelope limit', () => {
    const spool = track(WireBodySpool.create('wire-body-spool-test'));
    const oversized = Buffer.allocUnsafe(128 * 1024 * 1024 + 1);

    const error = rangeErrorOf(() => spool.append(oversized));

    expect(error.message).toBe(
      'JSON request envelope exceeds 134217728 bytes (134217729 bytes)',
    );
  });

  it('stops writing when the signal aborts between appends', () => {
    const controller = new AbortController();
    const spool = track(
      WireBodySpool.create('wire-body-spool-test', {
        signal: controller.signal,
      }),
    );
    spool.append('first');
    controller.abort(new Error('caller gave up'));

    expect(() => spool.append('second')).toThrow('caller gave up');
    spool.dispose();
    expect(activeWireBodySpoolCount()).toBe(startingSpools);
  });

  it('opens a fresh stream for every attempt, concurrently or in turn', async () => {
    const spool = track(sealedSpool('attempt body'));
    const expected = Buffer.from('attempt body');

    const first = await withSpooledJsonHttpBody(spool, async (body) => {
      expect(body.byteLength).toBe(expected.byteLength);
      return readAll(body.stream);
    });
    const second = await withSpooledJsonHttpBody(spool, async (body) =>
      readAll(body.stream),
    );
    expect(first.equals(expected)).toBe(true);
    expect(second.equals(expected)).toBe(true);

    const early = spool.openStream();
    const late = spool.openStream();
    expect(spool.accounting().activeStreamCount).toBe(2);
    expect((await readAll(late.stream)).equals(expected)).toBe(true);
    expect((await readAll(early.stream)).equals(expected)).toBe(true);
    expect(spool.accounting().activeStreamCount).toBe(0);
  });

  it('closes the fd when a read stream is cancelled', async () => {
    const spool = track(sealedSpool('x'.repeat(200 * 1024)));
    const before = openFdCount();

    const handle = spool.openStream();
    expect(openFdCount()).toBe(before + 1);
    const reader = handle.stream.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(spool.accounting().activeStreamCount).toBe(1);

    await reader.cancel('transport gave up');

    expect(openFdCount()).toBe(before);
    expect(spool.accounting().activeStreamCount).toBe(0);
  });

  it('closes the attempt fd when the consumer fails', async () => {
    const spool = track(sealedSpool('body'));
    const before = openFdCount();

    await expect(
      withSpooledJsonHttpBody(spool, async (body) => {
        const reader = body.stream.getReader();
        await reader.read();
        throw new Error('transport failed');
      }),
    ).rejects.toThrow('transport failed');

    expect(openFdCount()).toBe(before);
    expect(spool.accounting().activeStreamCount).toBe(0);
  });

  it('closes every fd and then removes the directory on dispose', async () => {
    const spool = sealedSpool('y'.repeat(200 * 1024));
    const directory = dirname(spool.path);
    expect(existsSync(directory)).toBe(true);
    const before = openFdCount();
    const one = spool.openStream();
    const two = spool.openStream();
    const reader = one.stream.getReader();
    await reader.read();
    expect(openFdCount()).toBe(before + 2);
    expect(activeWireBodySpoolCount()).toBe(startingSpools + 1);

    spool.dispose();

    expect(openFdCount()).toBe(before);
    expect(existsSync(directory)).toBe(false);
    expect(activeWireBodySpoolCount()).toBe(startingSpools);
    await expect(reader.read()).rejects.toThrow('Wire body stream was closed');
    two.dispose();
    spool.dispose();
  });

  it('closes the write fd when disposed before sealing', () => {
    const spool = WireBodySpool.create('wire-body-spool-test');
    spool.append('unsealed');
    const directory = dirname(spool.path);

    spool.dispose();

    expect(openFdCount()).toBe(startingFds);
    expect(existsSync(directory)).toBe(false);
  });

  it('throws when the file is shorter than the sealed length', async () => {
    const spool = track(sealedSpool('z'.repeat(1000)));
    truncateSync(spool.path, 400);

    const handle = spool.openStream();
    await expect(readAll(handle.stream)).rejects.toThrow(
      'Request body served 400 bytes but declared 1000',
    );
    expect(spool.accounting().activeStreamCount).toBe(0);
  });

  it('throws when the file is longer than the sealed length', async () => {
    const spool = track(sealedSpool('z'.repeat(1000)));
    appendFileSync(spool.path, 'extra');

    const handle = spool.openStream();
    await expect(readAll(handle.stream)).rejects.toThrow(
      'Request body served more than 1000 bytes but declared 1000',
    );
    expect(spool.accounting().activeStreamCount).toBe(0);
  });

  it('serves an empty sealed body', async () => {
    const spool = track(sealedSpool());
    expect(spool.byteLength).toBe(0);
    const handle = spool.openStream();
    expect((await readAll(handle.stream)).byteLength).toBe(0);
  });

  it('refuses reads before sealing, writes after sealing and a length before sealing', () => {
    const spool = track(WireBodySpool.create('wire-body-spool-test'));
    expect(() => spool.openStream()).toThrow('is writing, expected sealed');
    expect(() => spool.byteLength).toThrow('not sealed');
    spool.seal();
    expect(() => spool.append('late')).toThrow('is sealed, expected writing');
  });

  it('counts a spool only until it is disposed', () => {
    const spool = WireBodySpool.create('wire-body-spool-test');
    expect(activeWireBodySpoolCount()).toBe(startingSpools + 1);
    spool.dispose();
    spool.dispose();
    expect(activeWireBodySpoolCount()).toBe(startingSpools);
  });
});
