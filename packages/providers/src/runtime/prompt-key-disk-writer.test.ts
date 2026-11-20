/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import * as fs from 'node:fs';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PromptKeyDiskWriter } from './prompt-key-disk-writer.js';

function countWritesTo(path: string): { count: () => number } {
  // Call-through spies; counts are read from the recorded calls at assertion
  // time. Descriptor numbers are reused after close, so each write is
  // attributed to the latest preceding open that returned its descriptor.
  const openSpy = vi.spyOn(fs, 'openSync');
  const writeSpy = vi.spyOn(fs, 'writeSync');
  return {
    count: () => {
      const opens = openSpy.mock.calls.flatMap((call, position) => {
        const result = openSpy.mock.results[position];
        if (result.type !== 'return') return [];
        return [
          {
            order: openSpy.mock.invocationCallOrder[position],
            fd: result.value,
            tracked: String(call[0]) === path,
          },
        ];
      });
      return writeSpy.mock.calls.filter((call, position) => {
        const order = writeSpy.mock.invocationCallOrder[position];
        const owner = opens
          .filter((open) => open.fd === call[0] && open.order < order)
          .reduce<
            (typeof opens)[number] | undefined
          >((_, open) => open, undefined);
        return owner?.tracked === true;
      }).length;
    },
  };
}

describe('PromptKeyDiskWriter buffering', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'prompt-key-writer-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('writes many small pieces with a handful of system writes', () => {
    const path = join(root, 'key');
    const writes = countWritesTo(path);
    const writer = new PromptKeyDiskWriter(path, join(root, 'costs'), 'm');
    const rows = Array.from({ length: 4000 }, (_, index) => ({
      role: 'user',
      content: `row ${index}`,
    }));
    writer.value(rows);
    writer.close();
    expect(readFileSync(path, 'utf8')).toBe(JSON.stringify(rows));
    expect(writes.count()).toBeLessThanOrEqual(4);
  });

  it('keeps text larger than the buffer intact and in order', () => {
    const path = join(root, 'key');
    const writer = new PromptKeyDiskWriter(path, join(root, 'costs'), 'm');
    const big = 'é𝄞x'.repeat(60_000);
    writer.append('[');
    writer.string(big);
    writer.append(',');
    writer.value({ tail: 'end' });
    writer.append(']');
    writer.close();
    expect(readFileSync(path, 'utf8')).toBe(
      JSON.stringify([big, { tail: 'end' }]),
    );
  });

  it('encodes buffered text as utf16le when asked', () => {
    const path = join(root, 'key');
    const writer = new PromptKeyDiskWriter(
      path,
      join(root, 'costs'),
      'm',
      undefined,
      'utf16le',
    );
    writer.string('héllo 𝄞', false);
    writer.close();
    expect(readFileSync(path).toString('utf16le')).toBe('héllo 𝄞');
  });

  it('reports a failed flush from close and still closes the descriptors', () => {
    const path = join(root, 'key');
    const writer = new PromptKeyDiskWriter(path, join(root, 'costs'), 'm');
    writer.append('pending');
    vi.spyOn(fs, 'writeSync').mockImplementation(() => {
      throw new Error('EIO: simulated');
    });
    const closed: number[] = [];
    const originalClose = fs.closeSync;
    vi.spyOn(fs, 'closeSync').mockImplementation((fd: number) => {
      closed.push(fd);
      originalClose(fd);
    });
    expect(() => writer.close()).toThrow('EIO: simulated');
    expect(closed).toHaveLength(2);
  });

  it('does not write after an abort and reports the abort', () => {
    const controller = new AbortController();
    const path = join(root, 'key');
    const writer = new PromptKeyDiskWriter(
      path,
      join(root, 'costs'),
      'm',
      controller.signal,
    );
    writer.append('before');
    controller.abort(new Error('stop'));
    expect(() => writer.append('after')).toThrow('stop');
    writer.close();
  });
});
