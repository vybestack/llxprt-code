/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { appendFileSync } from 'node:fs';
import { expect } from 'bun:test';
import type { HistoryJournalStore } from './historyJournalStore.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';

export function scalarFailureMessage(execute: () => void): string | undefined {
  try {
    execute();
    return undefined;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return error.message;
  }
}

export function expectNoScalarOwners(owners: RowOwnership): void {
  expect(owners.snapshot().liveRows).toBe(0);
  expect(owners.snapshot().liveSerializedBytes).toBe(0);
}

export function expectEmptyScalarJournal(journal: HistoryJournalStore): void {
  expect(journal.getLength()).toBe(0);
  expect(journal.withReadRows((cursor) => cursor.rows().next().done)).toBe(
    true,
  );
}

export function recordScalarOwners(
  phase: string,
  size: number,
  owners: RowOwnership,
): void {
  const path = process.env.SCALAR_OWNER_OUTPUT;
  if (path !== undefined)
    appendFileSync(
      path,
      `${JSON.stringify({ phase, size, ...owners.snapshot() })}\n`,
    );
}
