/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gcAndSweep, heapStats } from 'bun:jsc';
import { StageRowLog } from './stageRowLog.js';

function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

function text(index: number, size: number): string {
  return `${index}:🌊é${'x'.repeat(size)}`;
}

describe('StageRowLog', () => {
  let root: string;
  let log: StageRowLog | undefined;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'stage-row-log-'));
  });
  afterEach(() => {
    log?.close();
    log = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  it('matches an in-memory model across random appends and reads of mixed sizes', () => {
    log = new StageRowLog(root, 'model');
    const model: string[] = [];
    const indices: number[] = [];
    const observed: string[] = [];
    const next = sequence(11);
    for (let step = 0; step < 3000; step++) {
      const choice = next() % 10;
      if (choice < 5 || model.length === 0) {
        const size = [0, 7, 200, 5000, 40_000, 90_000][next() % 6];
        const value = text(model.length, size);
        indices.push(log.append(value));
        model.push(value);
      } else {
        const index =
          choice < 8 ? next() % model.length : Math.max(0, model.length - 1);
        observed.push(log.read(index));
        indices.push(-1 - index);
      }
    }
    const written = indices.filter((index) => index >= 0);
    expect(written).toStrictEqual(written.map((_, position) => position));
    const expected = indices
      .filter((index) => index < 0)
      .map((index) => model[-1 - index]);
    expect(observed).toStrictEqual(expected);
    expect(log.length).toBe(model.length);
    const sequential = model.map((_, index) => log?.read(index));
    expect(sequential).toStrictEqual(model);
  });

  it('rejects positions it has not written', () => {
    log = new StageRowLog(root, 'range');
    log.append('a');
    expect(() => log?.read(1)).toThrow('Stage row log index is out of range');
    expect(() => log?.read(-1)).toThrow('Stage row log index is out of range');
    expect(() => log?.read(0.5)).toThrow('Stage row log index is out of range');
  });

  it('keeps two files per stage and refuses use after close', () => {
    log = new StageRowLog(root, 'files');
    log.append('a');
    expect(readdirSync(root).sort()).toStrictEqual([
      'files.offsets',
      'files.rows',
    ]);
    log.close();
    expect(() => log?.append('b')).toThrow('Stage row log is closed');
    expect(() => log?.read(0)).toThrow('Stage row log is closed');
    log.close();
  });

  it('returns its append buffer once the rows are read back', () => {
    log = new StageRowLog(root, 'release');
    for (let index = 0; index < 200; index++) log.append(text(index, 20));
    gcAndSweep();
    const buffered = heapStats().extraMemorySize;
    expect(log.read(0)).toBe(text(0, 20));
    gcAndSweep();
    // The 64 KiB append buffer goes; the 32 KiB read window arrives.
    expect(buffered - heapStats().extraMemorySize).toBeGreaterThan(16 * 1024);
    log.append(text(200, 20));
    expect(log.read(200)).toBe(text(200, 20));
    expect(log.read(0)).toBe(text(0, 20));
  });

  it('does not create a log over an existing stage file', () => {
    log = new StageRowLog(root, 'dup');
    expect(() => new StageRowLog(root, 'dup')).toThrow('EEXIST');
  });
});
