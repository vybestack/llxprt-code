/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ScratchRootOwner } from '../storage/scratch-root.js';
import { RecordingFailureStore } from './recording-failure-report.js';

const scratchRoots = new ScratchRootOwner();

describe('recording failure scratch ownership', () => {
  afterEach(() => scratchRoots.removeRoot());
  it('stores separate reports under the supplied startup root and removes consumed directories', async () => {
    const first = new RecordingFailureStore(scratchRoots);
    const second = new RecordingFailureStore(scratchRoots);
    first.record(1, new Error('first recording failed'));
    second.record(1, new Error('second recording failed'));
    const root = scratchRoots.getRoot();
    const directories = readdirSync(root);
    expect(directories).toHaveLength(2);
    for (const directory of directories)
      expect(existsSync(join(root, directory, '1.jsonl'))).toBe(true);
    const firstReport = first.takeThrough(1, 'first');
    const secondReport = second.takeThrough(1, 'second');
    if (firstReport === undefined || secondReport === undefined)
      throw new Error('Expected both recording failure reports');
    await firstReport.close();
    expect(readdirSync(root)).toHaveLength(1);
    await secondReport.close();
    expect(readdirSync(root)).toStrictEqual([]);
  });

  it('preserves an explicit report directory while using the supplied owner for default storage', async () => {
    const directory = scratchRoots.createDirSync('explicit-reports-');
    const store = new RecordingFailureStore(scratchRoots, directory);
    store.record(1, new Error('explicit recording failed'));
    expect(existsSync(join(directory, '1.jsonl'))).toBe(true);
    const report = store.takeThrough(1, 'explicit');
    if (report === undefined)
      throw new Error('Expected recording failure report');
    await report.close();
    expect(existsSync(directory)).toBe(true);
    expect(readdirSync(directory)).toStrictEqual([]);
  });
});
