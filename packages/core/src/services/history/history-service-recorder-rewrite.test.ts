/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { historyOriginId } from './historyOriginId.js';
import type { HistoryService } from './HistoryService.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { primaryRows } from '../../recording/__tests__/support/forkProof.js';
import { openJournalReadOnly } from '../../journal/journalReader.js';
import {
  mutationText,
  persistedMutationRows,
  useServiceRecorderMutations,
  type ObservedRecorder,
  type PersistedMutationRow,
} from './__tests__/support/service-recorder-mutations.js';

function primaryVersion(history: HistoryService): number {
  const store = history.detachedValues.host().journal;
  if (!(store instanceof JournalHistoryStore))
    throw new Error('Expected native history for commit observation');
  return store.lastAck?.commitSeq ?? 0;
}

async function version(recorder: ObservedRecorder): Promise<number> {
  const path = recorder.recording.getFilePath();
  if (path === null) throw new Error('Missing recorder path');
  const reader = await openJournalReadOnly(path);
  try {
    return reader.trailer?.commitSeq ?? 0;
  } finally {
    await reader.close();
  }
}

async function assertAccepted(
  recorder: ObservedRecorder,
  rows: readonly PersistedMutationRow[],
): Promise<void> {
  const origin = historyOriginId(recorder.origin);
  expect(await persistedMutationRows(recorder.recording)).toStrictEqual(
    rows.filter((row) => row.origin === undefined || row.origin === origin),
  );
}

describe('HistoryService native two-recorder full rewrites', () => {
  const fixture = useServiceRecorderMutations();

  it.each([3, 64, 65, 5000])(
    'preserves current owners through density and detached replacement of %i mixed rows then clears both durable mirrors',
    async (count) => {
      const history = fixture.history();
      const a = await fixture.recorder(`rewrite-${count}-a`);
      const b = await fixture.recorder(`rewrite-${count}-b`);
      await a.integration.subscribeToJournal(history, a.origin);
      await b.integration.subscribeToJournal(history, b.origin);
      const origins = [a.origin, b.origin, undefined];
      for (const [owner, origin] of origins.entries()) {
        await history.addBatch(
          Array.from({ length: count }, (_, index) => index)
            .filter((index) => index % 3 === owner)
            .map((index) => mutationText(`original ${index}`)),
          undefined,
          { origin },
        );
      }
      await a.integration.flushAtTurnBoundary();
      await b.integration.flushAtTurnBoundary();
      const initial = await primaryRows(history);
      expect(initial.length).toBe(count);
      expect(new Set(initial.map(({ origin }) => origin)).size).toBe(3);
      expect(
        initial.map(({ content, origin }) => ({
          blocks: content.blocks,
          origin,
        })),
      ).toStrictEqual(
        origins.flatMap((origin, owner) =>
          Array.from({ length: count }, (_, index) => index)
            .filter((index) => index % 3 === owner)
            .map((index) => ({
              blocks: mutationText(`original ${index}`).blocks,
              origin:
                origin === undefined ? undefined : historyOriginId(origin),
            })),
        ),
      );
      await assertAccepted(a, initial);
      await assertAccepted(b, initial);

      const densityRows = initial.map(({ content, origin }, index) => ({
        content: {
          ...content,
          blocks: mutationText(`density ${index}`).blocks,
        },
        origin,
      }));
      const beforeDensity = [
        primaryVersion(history),
        await version(a),
        await version(b),
      ];
      const densityFlushes = [a.flushes(), b.flushes()];
      await history.applyDensityResult({
        removals: [],
        replacements: new Map(
          densityRows.map(({ content }, index) => [index, content]),
        ),
        metadata: {
          readWritePairsPruned: 0,
          fileDeduplicationsPruned: 0,
          recencyPruned: 0,
        },
      });
      await a.integration.flushAtTurnBoundary();
      await b.integration.flushAtTurnBoundary();
      expect(await primaryRows(history)).toStrictEqual(densityRows);
      await assertAccepted(a, densityRows);
      await assertAccepted(b, densityRows);
      expect([
        primaryVersion(history),
        await version(a),
        await version(b),
      ]).toStrictEqual(beforeDensity.map((seq) => seq + 1));
      expect([a.flushes(), b.flushes()]).toStrictEqual(
        densityFlushes.map((flushes) => flushes + 1),
      );

      const replacementRows = densityRows.map(({ content, origin }, index) => ({
        content: {
          ...content,
          blocks: mutationText(`detached ${index}`).blocks,
        },
        origin,
      }));
      const beforeReplace = [
        primaryVersion(history),
        await version(a),
        await version(b),
      ];
      const replacementFlushes = [a.flushes(), b.flushes()];
      await history.detachedValues.transform(async (source, sink) => {
        let ordinal = 0;
        for await (const row of source.streamRows()) {
          await sink.appendDerived(ordinal, {
            ...row,
            blocks: mutationText(`detached ${ordinal}`).blocks,
          });
          ordinal++;
        }
      });
      await a.integration.flushAtTurnBoundary();
      await b.integration.flushAtTurnBoundary();
      expect(await primaryRows(history)).toStrictEqual(replacementRows);
      await assertAccepted(a, replacementRows);
      await assertAccepted(b, replacementRows);
      expect([
        primaryVersion(history),
        await version(a),
        await version(b),
      ]).toStrictEqual(beforeReplace.map((seq) => seq + 1));
      expect([a.flushes(), b.flushes()]).toStrictEqual(
        replacementFlushes.map((flushes) => flushes + 1),
      );

      const beforeClear = [
        primaryVersion(history),
        await version(a),
        await version(b),
      ];
      const clearFlushes = [a.flushes(), b.flushes()];
      await history.clear();
      await a.integration.flushAtTurnBoundary();
      await b.integration.flushAtTurnBoundary();
      expect(history.length()).toBe(0);
      expect(await persistedMutationRows(a.recording)).toStrictEqual([]);
      expect(await persistedMutationRows(b.recording)).toStrictEqual([]);
      expect([
        primaryVersion(history),
        await version(a),
        await version(b),
      ]).toStrictEqual(beforeClear.map((seq) => seq + 1));
      expect([a.flushes(), b.flushes()]).toStrictEqual(
        clearFlushes.map((flushes) => flushes + 1),
      );
    },
    180_000,
  );
});
