/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RecordingFailureStore,
  RecordingFailureStorageError,
} from './recording-failure-report.js';

describe('failure reporting write and descriptor cleanup faults', () => {
  it('preserves a failed report write before the descriptor close error', () => {
    const root = fs.mkdtempSync(join(tmpdir(), 'recording-write-close-'));
    const original = new Error('persistence failed');
    const writeFailure = new Error('diagnostic write failed');
    const closeFailure = new Error('descriptor close failed');
    const close = fs.closeSync;
    const writeMock = vi.spyOn(fs, 'writeSync').mockImplementation(() => {
      throw writeFailure;
    });
    const closeMock = vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
      close(fd);
      throw closeFailure;
    });
    let failure: unknown;
    try {
      new RecordingFailureStore(root).record(1, original);
    } catch (error: unknown) {
      failure = error;
    } finally {
      writeMock.mockRestore();
      closeMock.mockRestore();
      fs.rmSync(root, { recursive: true, force: true });
    }
    if (!(failure instanceof RecordingFailureStorageError)) throw failure;
    expect(failure.cause).toBe(original);
    if (!(failure.storageError instanceof AggregateError))
      throw failure.storageError;
    expect(failure.storageError.errors).toStrictEqual([
      writeFailure,
      closeFailure,
    ]);
  });
});
