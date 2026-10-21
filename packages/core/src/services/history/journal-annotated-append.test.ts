/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as promises from 'node:fs/promises';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { getScratchRoot } from '../../storage/scratch-root.js';
import { mergeRemovedInteriorSpans } from './contextRange.js';
import type { RemovedInteriorSpan } from './historyEventTypes.js';
import { JournalDensitySpans } from './journalDensitySpans.js';

function row(index: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `source ${index}` }],
    metadata: {
      chronology: { seq: index * 4, userTurn: 1, step: index, recordedAt: 0 },
    },
  };
}

async function denyCreates(action: () => Promise<void>): Promise<void> {
  getScratchRoot();
  const attempts: string[] = [];
  const denied = (path: unknown): never => {
    attempts.push(String(path));
    throw new Error('Annotated native append must not create operation files');
  };
  const open = fs.openSync;
  const asyncOpen = promises.open;
  const creates = (flags: string | number | undefined): boolean =>
    typeof flags === 'number'
      ? (flags & fs.constants.O_CREAT) !== 0
      : typeof flags === 'string' && /[wa]/.test(flags);
  const directories = spyOn(fs, 'mkdtempSync').mockImplementation(denied);
  const asyncDirectories = spyOn(promises, 'mkdtemp').mockImplementation(
    async (path) => denied(path),
  );
  const files = spyOn(fs, 'openSync').mockImplementation(
    (path, flags, mode) => {
      if (creates(flags)) return denied(path);
      return open(path, flags, mode);
    },
  );
  const asyncFiles = spyOn(promises, 'open').mockImplementation(
    async (path, flags, mode) => {
      if (creates(flags)) return denied(path);
      return asyncOpen(path, flags, mode);
    },
  );
  let failure: { error: unknown } | undefined;
  try {
    await action();
  } catch (error) {
    failure = { error };
  } finally {
    directories.mockRestore();
    asyncDirectories.mockRestore();
    files.mockRestore();
    asyncFiles.mockRestore();
  }
  expect(attempts).toStrictEqual([]);
  if (failure !== undefined) throw failure.error;
}

async function values(history: HistoryService): Promise<IContent[]> {
  const result: IContent[] = [];
  for await (const content of history.streamRawHistory()) result.push(content);
  return result;
}

describe('native annotated append through the public history host', () => {
  it.each([3, 64, 65, 5000])(
    'appends %i unordered annotations without interval files and preserves the existing prefix',
    async (size) => {
      const history = new HistoryService({ backend: 'journal' });
      try {
        await history.detachedValues.append(
          Array.from({ length: size }, (_, index) => row(index)),
        );
        const before = await values(history);
        const host = history.detachedValues.host();
        await history.detachedValues.withCheckpoint(async () =>
          denyCreates(() =>
            host.journal.publishDetached(
              {
                append: true,
                transform: async (_source, sink) => {
                  for (let index = size - 1; index >= 0; index--) {
                    await sink.appendReplacement(index, row(index));
                    await sink.removeValue(index);
                  }
                },
              },
              host,
              undefined,
              {},
            ),
          ),
        );
        const expected: RemovedInteriorSpan[] = Array.from(
          { length: size },
          (_, index) => ({
            start: index * 4,
            end: index * 4,
            reason: 'density-removed',
          }),
        );
        expect(history.getContextRange().removedInterior).toStrictEqual(
          mergeRemovedInteriorSpans(expected).slice(-1024),
        );
        const after = await values(history);
        expect(after.slice(0, size)).toStrictEqual(before);
        expect(
          after.slice(size).map((content) => content.blocks),
        ).toStrictEqual(
          Array.from(
            { length: size },
            (_, index) => row(size - index - 1).blocks,
          ),
        );
      } finally {
        await history.dispose();
      }
    },
    180_000,
  );

  it.each(['producer', 'projection', 'acknowledged', 'abort'])(
    'restores annotated append metadata and the exact %s cause then continues',
    async (stage) => {
      const history = new HistoryService({ backend: 'journal' });
      const failure = new Error(`failed ${stage}`);
      const controller = new AbortController();
      const projection = spyOn(JournalDensitySpans.prototype, 'project');
      try {
        await history.detachedValues.append([row(0)]);
        const host = history.detachedValues.host();
        const before = { rows: await values(history), state: host.snapshot() };
        if (stage === 'projection') projection.mockRejectedValue(failure);
        await denyCreates(async () => {
          await expect(
            host.journal.publishDetached(
              {
                append: true,
                transform: async (_source, sink) => {
                  for (let index = 0; index < 65; index++) {
                    await sink.removeValue(0);
                    await sink.appendDerived(0, row(index + 1));
                  }
                  if (stage === 'producer') throw failure;
                  if (stage === 'abort') controller.abort(failure);
                },
              },
              host,
              undefined,
              {
                signal: controller.signal,
                onAcknowledged: () => {
                  if (stage === 'acknowledged') throw failure;
                },
              },
            ),
          ).rejects.toBe(failure);
        });
        expect(await values(history)).toStrictEqual(before.rows);
        expect(host.snapshot()).toStrictEqual(before.state);
        projection.mockRestore();
        await host.journal.publishDetached(
          {
            append: true,
            transform: async (_source, sink) => {
              await sink.removeValue(0);
              await sink.appendDerived(0, row(99));
            },
          },
          host,
          undefined,
          {},
        );
        expect((await values(history)).length).toBe(2);
      } finally {
        projection.mockRestore();
        await history.dispose();
      }
    },
    180_000,
  );
});
