/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  cleanupBounds,
  cleanupRow,
  recordCleanupOwners,
} from '../../../utils/cleanup-history-test-helpers.js';
import {
  checkpointTool,
  checkpointUiHistory,
  saveCheckpoint,
  savedCheckpoint,
  trackingFs,
  withCheckpoint,
} from './checkpoint-disk-test-helpers.js';

for (const size of [512, 8192]) {
  for (const active of [false, true]) {
    describe(`invoked CLI checkpoint save ${active ? 'active' : 'inactive'} ${size}`, () => {
      const retainingModes: ReadonlyArray<'borrowed' | 'copy'> = [
        'borrowed',
        'copy',
      ];
      for (const retaining of retainingModes) {
        it(`detects ${retaining} retaining consumers against unchanged bounds`, async () => {
          await withCheckpoint(size, active, async (fixture, dir) => {
            fixture.history.retaining = retaining;
            await saveCheckpoint(fixture, dir, trackingFs().ops);
            recordCleanupOwners(
              size,
              active,
              `checkpoint-retaining-${retaining}`,
              fixture,
            );
            expect(fixture.history.external.snapshot().peakRows).toBe(size);
            expect(fixture.history.external.within(cleanupBounds)).toBe(
              process.env.CHECKPOINT_RETAINING_TRAP === '1',
            );
            expect(fixture.reader.snapshot().liveRows).toBe(0);
            fixture.history.releaseExternal();
            expect(fixture.history.external.snapshot().liveRows).toBe(0);
          });
        }, 180000);
      }
    });
    describe(`invoked CLI checkpoint save ${active ? 'active' : 'inactive'} ${size}`, () => {
      it('preserves exact pretty JSON bytes without eager history or an eager encoded row', async () => {
        await withCheckpoint(size, active, async (fixture, dir) => {
          const fs = trackingFs();
          await saveCheckpoint(fixture, dir, fs.ops);
          const saved = await savedCheckpoint(dir);
          const expected = JSON.stringify(
            {
              history: checkpointUiHistory,
              clientHistory: Array.from({ length: size }, (_, index) =>
                cleanupRow(index, 2048, size, fixture.reference),
              ),
              toolCall: {
                name: checkpointTool.request.name,
                args: checkpointTool.request.args,
              },
              commitHash: 'checkpoint-snapshot',
              filePath: checkpointTool.request.args.file_path,
            },
            null,
            2,
          );
          expect(saved.bytes).toBe(expected);
          recordCleanupOwners(size, active, 'checkpoint-saved', fixture);
          expect(fixture.history.delivered).toBe(size);
          expect(fixture.reader.within(cleanupBounds)).toBe(true);
          expect(fixture.reader.snapshot().liveRows).toBe(0);
          expect(fixture.history.closed).toBe(1);
          expect(fs.chunks().peakBytes).toBeLessThanOrEqual(64 * 1024);
          expect(fs.chunks().count).toBeGreaterThan(1);
        });
      }, 180000);
    });
    describe(`invoked CLI checkpoint save ${active ? 'active' : 'inactive'} ${size}`, () => {
      it('keeps a paused source lazy and removes staged output on cancellation', async () => {
        await withCheckpoint(size, active, async (fixture, dir) => {
          fixture.history.pauseAt = 1;
          const controller = new AbortController();
          const saving = saveCheckpoint(
            fixture,
            dir,
            trackingFs().ops,
            controller.signal,
          );
          const outcome = await Promise.race([
            fixture.history.paused.promise.then(() => 'paused'),
            saving.then(
              () => 'finished',
              (error: unknown) => String(error),
            ),
          ]);
          try {
            expect(outcome).toBe('paused');
            expect(fixture.decoded()).toBe(1);
            expect(fixture.reader.snapshot().liveRows).toBe(1);
            expect(
              (await readdir(dir)).every((file) => !file.endsWith('.json')),
            ).toBe(true);
            controller.abort(new Error('checkpoint cancelled'));
          } finally {
            fixture.history.resume.resolve();
          }
          await expect(saving).rejects.toThrow(/checkpoint|aborted/);
          expect(await readdir(dir)).toStrictEqual([]);
          expect(fixture.reader.snapshot().liveRows).toBe(0);
          expect(fixture.history.closed).toBe(1);
        });
      }, 180000);
    });
    describe(`invoked CLI checkpoint save ${active ? 'active' : 'inactive'} ${size}`, () => {
      it('closes a failing history source without publishing a partial checkpoint', async () => {
        await withCheckpoint(size, active, async (fixture, dir) => {
          fixture.history.failAt = 7;
          await expect(
            saveCheckpoint(fixture, dir, trackingFs().ops),
          ).rejects.toThrow('cleanup source fault');
          expect(await readdir(dir)).toStrictEqual([]);
          expect(fixture.reader.snapshot().liveRows).toBe(0);
          expect(fixture.history.closed).toBe(1);
        });
      }, 180000);
    });
  }
}

describe('CLI checkpoint publication faults', () => {
  const faults: ReadonlyArray<'write' | 'sync' | 'close' | 'rename'> = [
    'write',
    'sync',
    'close',
    'rename',
  ];
  for (const fault of faults) {
    it(`removes staged output on ${fault} failure and preserves existing checkpoints`, async () => {
      await withCheckpoint(512, true, async (fixture, dir) => {
        const previous = join(dir, 'previous.json');
        await writeFile(previous, '{"previous":true}');
        await expect(
          saveCheckpoint(fixture, dir, trackingFs(fault).ops),
        ).rejects.toThrow(`checkpoint ${fault} fault`);
        expect(await readdir(dir)).toStrictEqual(['previous.json']);
        expect(await readFile(previous, 'utf8')).toBe('{"previous":true}');
        expect(fixture.reader.snapshot().liveRows).toBe(0);
      });
    }, 180000);
  }

  it('does not decode a pre-aborted source or open a staged file', async () => {
    await withCheckpoint(512, false, async (fixture, dir) => {
      const controller = new AbortController();
      controller.abort(new Error('checkpoint pre-abort'));
      await expect(
        saveCheckpoint(fixture, dir, trackingFs().ops, controller.signal),
      ).rejects.toThrow(/checkpoint|aborted/);
      expect(await readdir(dir)).toStrictEqual([]);
      expect(fixture.decoded()).toBe(0);
    });
  }, 180000);

  it('accepts a nine MiB row with bounded encoding chunks and exact bytes', async () => {
    const bytes = 9 * 1024 * 1024;
    await withCheckpoint(
      1,
      false,
      async (fixture, dir) => {
        const fs = trackingFs();
        await saveCheckpoint(fixture, dir, fs.ops);
        const saved = await savedCheckpoint(dir);
        expect(saved.bytes).toBe(
          JSON.stringify(
            {
              history: checkpointUiHistory,
              clientHistory: [cleanupRow(0, bytes, 1, fixture.reference)],
              toolCall: {
                name: checkpointTool.request.name,
                args: checkpointTool.request.args,
              },
              commitHash: 'checkpoint-snapshot',
              filePath: checkpointTool.request.args.file_path,
            },
            null,
            2,
          ),
        );
        expect(fs.chunks().peakBytes).toBeLessThanOrEqual(64 * 1024);
        expect(fs.chunks().count).toBeGreaterThan(140);
        expect(fixture.reader.snapshot().peakRows).toBe(1);
        expect(fixture.reader.snapshot().liveRows).toBe(0);
      },
      bytes,
    );
  }, 180000);
});
