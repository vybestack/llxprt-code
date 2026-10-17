/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HistoryService } from '../../HistoryService.js';
import type { IContent } from '../../IContent.js';
import type { JournalHistoryStore } from '../../journalHistoryStore.js';
import {
  applyStep,
  currentRows,
  tagOf,
  type MutationSequenceFixture,
} from './mutationSequence.js';

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'mutation-sequence',
);

export function loadMutationFixtures(): MutationSequenceFixture[] {
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map(
      (file) =>
        JSON.parse(
          fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'),
        ) as MutationSequenceFixture,
    );
}

function extendsPrevious(
  previous: readonly IContent[],
  rows: readonly IContent[],
): boolean {
  return (
    rows.length >= previous.length &&
    previous.every((row, index) => tagOf(row) === tagOf(rows[index]))
  );
}

/** Writes `rows` to the store as the group the step would have been: an append or a replacement. */
async function syncStore(
  store: JournalHistoryStore,
  previous: readonly IContent[],
  rows: readonly IContent[],
): Promise<void> {
  if (extendsPrevious(previous, rows)) {
    for (const row of rows.slice(previous.length))
      store.apply({ kind: 'content', content: row });
  } else {
    await store.replaceFrom(rows, rows.length);
  }
  await store.waitForDurable();
}

export interface ReplayedStep<T> {
  readonly rows: readonly IContent[];
  readonly observed: T;
}

/**
 * Runs the steps of a fixture on the old store and mirrors the rows it holds
 * after each one into `store`, then calls `observe` with the store durable.
 */
export async function replayOntoJournal<T>(
  fixture: MutationSequenceFixture,
  store: JournalHistoryStore,
  observe: () => T | Promise<T>,
): Promise<Array<ReplayedStep<T>>> {
  const history = new HistoryService();
  const results: Array<ReplayedStep<T>> = [];
  let previous: IContent[] = [];
  try {
    for (const entry of fixture.steps) {
      await applyStep(history, entry.step);
      const rows = await currentRows(history);
      await syncStore(store, previous, rows);
      previous = rows;
      results.push({ rows, observed: await observe() });
    }
    return results;
  } finally {
    await history.dispose();
  }
}
