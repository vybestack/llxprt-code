/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  RecordingFailureStore,
  RecordingFailureStorageError,
} from './recording-failure-report.js';

function thrown(operation: () => void): unknown {
  try {
    operation();
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected failed report storage');
}

describe('recording failure I/O ownership', () => {
  it('orders original persistence, storage, and failed scratch cleanup causes', () => {
    const root = mkdtempSync(join(tmpdir(), 'recording-report-io-order-'));
    mkdirSync(join(root, '1.jsonl.tmp'));
    const original = new Error('original persistence failure');
    try {
      const error = thrown(() =>
        new RecordingFailureStore(root).record(1, original),
      );
      if (!(error instanceof RecordingFailureStorageError)) throw error;
      expect(error.cause).toBe(original);
      expect(error.storageError).toBeInstanceOf(Error);
      expect(error.cleanupError).toBeInstanceOf(Error);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('propagates the persistence cause before a disk reporting fault', () => {
    const root = mkdtempSync(join(tmpdir(), 'recording-report-io-'));
    const file = join(root, 'not-a-directory');
    writeFileSync(file, 'blocked');
    const original = new Error('save already failed');
    try {
      const error = thrown(() =>
        new RecordingFailureStore(file).record(1, original),
      );
      if (!(error instanceof RecordingFailureStorageError)) throw error;
      expect(error.cause).toBe(original);
      expect(error.storageError).toBeInstanceOf(Error);
      expect(error.cleanupError).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
describe('recording report cleanup', () => {
  it('makes failed cleanup retryable without losing the next generation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'recording-report-cleanup-'));
    const store = new RecordingFailureStore(root);
    try {
      store.record(1, new Error('earlier'));
      store.record(2, new Error('later'));
      const first = store.takeThrough(1, 'earlier');
      if (first === undefined) throw new Error('Missing first report');
      const file = join(root, '1.jsonl');
      rmSync(file);
      mkdirSync(file);
      await expect(first.close()).rejects.toThrow(/EISDIR|EPERM/);
      expect(readdirSync(root)).toHaveLength(2);
      rmSync(file, { recursive: true });
      await first.close();
      const second = store.takeThrough(2, 'later');
      if (second === undefined) throw new Error('Missing second report');
      expect(second.count).toBe(1);
      await second.close();
      expect(readdirSync(root)).toStrictEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
