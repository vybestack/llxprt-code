/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import * as fs from 'node:fs';
import { MutableRowDirectory, type NumericRow } from './mutableRowDirectory.js';

function row(index: number): NumericRow {
  return {
    source: 'durable',
    offset: index * 2048,
    bytes: 2048,
    chronologySeq: index + 1,
    pendingSlot: -1,
    invalidateResponses: false,
  };
}

function updatedRow(index: number): NumericRow {
  return {
    ...row(index),
    chronologyOverlay: true,
    chronologyUserTurn: index + 1,
    chronologyStep: 0,
    chronologyRecordedAt: 0,
    invalidateResponses: true,
  };
}

function withDirectory(run: (directory: MutableRowDirectory) => void): void {
  const directory = new MutableRowDirectory();
  try {
    run(directory);
  } finally {
    directory.close();
  }
}

function observeWrite(
  write: typeof fs.writeSync,
  observe: (write: () => number, partial: () => number) => number,
): typeof fs.writeSync {
  return (
    fd: number,
    buffer: NodeJS.ArrayBufferView | string,
    offset: number | null = null,
    length: number | BufferEncoding | null = null,
    position: number | null = null,
  ): number => {
    if (typeof buffer === 'string') {
      if (typeof length === 'number') throw new Error('Expected encoding');
      return write(fd, buffer, offset, length);
    }
    if (typeof length === 'string') throw new Error('Expected byte length');
    return observe(
      () => write(fd, buffer, offset, length, position),
      () => write(fd, buffer, offset, 7, position),
    );
  };
}

describe('startup chronology row replacement', () => {
  for (const size of [512, 8192]) {
    it(`replaces ${size} bindings with linear disk writes and unchanged row bytes`, () => {
      withDirectory((directory) => {
        for (let index = 0; index < size; index++) directory.append(row(index));
        const originalWrite = fs.writeSync;
        let writtenBytes = 0;
        const observer = vi.spyOn(fs, 'writeSync').mockImplementation(
          observeWrite(originalWrite, (write) => {
            const written = write();
            writtenBytes += written;
            return written;
          }),
        );
        try {
          for (let index = 0; index < size; index++)
            directory.replace(index, updatedRow(index));
        } finally {
          observer.mockRestore();
        }
        expect(writtenBytes).toBe(size * 64);
        expect(directory.metrics()).toStrictEqual({
          residentBufferBytes: 64,
          fileBytes: size * 64,
        });
        for (let index = 0; index < size; index++)
          expect(directory.rowAt(index)).toStrictEqual(updatedRow(index));
      });
    }, 120_000);
  }
});

describe('row replacement I/O failures', () => {
  it('reports both replacement and rollback I/O failures', () => {
    withDirectory((directory) => {
      directory.append(row(0));
      const fault = vi.spyOn(fs, 'writeSync').mockImplementation(() => {
        throw new Error('disk unavailable');
      });
      try {
        expect(() => directory.replace(0, updatedRow(0))).toThrow(
          AggregateError,
        );
      } finally {
        fault.mockRestore();
      }
      expect(directory.rowAt(0)).toStrictEqual(row(0));
    });
  });

  for (const failure of ['short', 'throw']) {
    it(`preserves every row after a ${failure} replacement write`, () => {
      withDirectory((directory) => {
        for (let index = 0; index < 3; index++) directory.append(row(index));
        const originalWrite = fs.writeSync;
        let failed = false;
        const fault = vi.spyOn(fs, 'writeSync').mockImplementation(
          observeWrite(originalWrite, (write, partial) => {
            if (!failed) {
              failed = true;
              partial();
              if (failure === 'throw') throw new Error('replacement I/O fault');
              return 7;
            }
            return write();
          }),
        );
        try {
          expect(() => directory.replace(1, updatedRow(1))).toThrow(
            failure === 'short'
              ? 'Short numeric row write'
              : 'replacement I/O fault',
          );
        } finally {
          fault.mockRestore();
        }
        expect(directory.length).toBe(3);
        for (let index = 0; index < 3; index++)
          expect(directory.rowAt(index)).toStrictEqual(row(index));
        directory.replace(1, updatedRow(1));
        expect(directory.rowAt(1)).toStrictEqual(updatedRow(1));
      });
    });
  }
});
