/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { foldDurableRows, pinReadableFile } from './durableRowFold.js';
import { MetadataJsonProjection } from './metadataJsonProjection.js';
import { RowOwnership } from './rowOwnership.js';
import type { IContent } from '../services/history/IContent.js';
import {
  PURGE_BUFFER_BOUND,
  withPurgeFile,
  writePurgeFixture,
} from './purge-durable-fold-test-helpers.js';

function slots(value: unknown, seen = new Set<object>()): number {
  if (typeof value !== 'object' || value === null || seen.has(value)) return 0;
  seen.add(value);
  return Object.values(value).reduce(
    (sum: number, child: unknown) => sum + 1 + slots(child, seen),
    0,
  );
}
function observeProjection(): {
  readonly sample: () => {
    readonly peakSlots: number;
    readonly peakChunkBytes: number;
    readonly peakTokenBytes: number;
  };
  readonly close: () => void;
} {
  const push = MetadataJsonProjection.prototype.push;
  let peakSlots = 0;
  let peakChunkBytes = 0;
  let peakTokenBytes = 0;
  const watch = spyOn(
    MetadataJsonProjection.prototype,
    'push',
  ).mockImplementation(function (
    this: MetadataJsonProjection,
    text: string,
  ): void {
    push.call(this, text);
    peakChunkBytes = Math.max(peakChunkBytes, Buffer.byteLength(text));
    peakTokenBytes = Math.max(
      peakTokenBytes,
      this.metrics().maxTokenCharacters * 4,
    );
    const frames: unknown = Reflect.get(this, 'stack');
    if (!Array.isArray(frames)) throw new Error('Missing parser frames');
    const retained = frames.map((frame: unknown) => {
      if (typeof frame !== 'object' || frame === null)
        throw new Error('Invalid parser frame');
      return Reflect.get(frame, 'value');
    });
    peakSlots = Math.max(peakSlots, slots(retained));
  });
  return {
    sample: () => ({ peakSlots, peakChunkBytes, peakTokenBytes }),
    close: () => watch.mockRestore(),
  };
}

describe('oversized purge deterministic allocation and owner bounds', () => {
  it('bounds scanned chunks and projected owners without retaining the 8192-row history', async () => {
    await withPurgeFile(async (root, file) => {
      const bytes = writePurgeFixture(file);
      const pinned = pinReadableFile(file);
      let peakBuffer = 0;
      const source = {
        ...pinned,
        handle: {
          ...pinned.handle,
          read: async (
            buffer: Buffer,
            offset: number,
            length: number,
            position: number,
          ): Promise<number> => {
            peakBuffer = Math.max(peakBuffer, buffer.byteLength);
            return pinned.handle.read(buffer, offset, length, position);
          },
        },
      };
      const observer = observeProjection();
      const ownership = new RowOwnership();
      try {
        const fold = await foldDurableRows({
          maxBytes: bytes,
          pinnedJournal: source,
          scratchRoot: root,
          chunkBytes: PURGE_BUFFER_BOUND + 1,
        });
        try {
          expect(fold.length).toBe(8192);
          for (let index = 0; index < fold.length; index++) {
            const row = await fold.readRow(index);
            ownership.retain(row);
            ownership.release(row);
          }
          expect(
            ownership.within({
              rows: 440,
              serializedBytes: PURGE_BUFFER_BOUND,
            }),
          ).toBe(true);
          expect(ownership.snapshot().liveRows).toBe(0);
          expect(observer.sample().peakSlots).toBeLessThanOrEqual(440);
          expect(observer.sample().peakChunkBytes).toBeLessThanOrEqual(
            64 * 1024 + 3,
          );
          expect(observer.sample().peakTokenBytes).toBeLessThanOrEqual(
            PURGE_BUFFER_BOUND,
          );
          expect(peakBuffer).toBeLessThanOrEqual(64 * 1024);
        } finally {
          await fold.close();
        }
      } finally {
        observer.close();
        pinned.release();
      }
    });
  });
});

describe('oversized purge retained owner control', () => {
  it('rejects an explicitly retained 8192-row control under the same 8 MiB and 440-owner predicate', async () => {
    await withPurgeFile(async (root, file) => {
      const bytes = writePurgeFixture(file);
      const ownership = new RowOwnership();
      const retained: IContent[] = [];
      const fold = await foldDurableRows({
        filePath: file,
        maxBytes: bytes,
        scratchRoot: root,
      });
      try {
        for (let index = 0; index < fold.length; index++) {
          const row = await fold.readRow(index);
          ownership.retain(row);
          retained.push(row);
        }
        expect(ownership.snapshot().peakRows).toBe(8192);
        expect(ownership.snapshot().peakSerializedBytes).toBeGreaterThan(
          PURGE_BUFFER_BOUND,
        );
        expect(
          ownership.within({ rows: 440, serializedBytes: PURGE_BUFFER_BOUND }),
        ).toBe(false);
      } finally {
        for (const row of retained) ownership.release(row);
        await fold.close();
      }
      expect(ownership.snapshot().liveRows).toBe(0);
    });
  });
});
