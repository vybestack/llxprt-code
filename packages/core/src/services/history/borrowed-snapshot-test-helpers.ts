/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { mkdtempSync, rmSync, fstatSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { createRowCounters } from '../../recording/journalCounters.js';
import type { PendingFoldSnapshot } from '../../recording/pendingFoldSnapshot.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import { rollbackRow } from './chronology-rollback-test-helpers.js';
import type { IContent } from './IContent.js';

export class BorrowedOwners extends RowOwnership {
  references = 0;
  releases = 0;

  override retain(row: object): void {
    super.retain(row);
    this.references++;
  }

  override release(row: object): void {
    super.release(row);
    this.references--;
    this.releases++;
  }
}

class ObservedStore extends HistoryJournalStore {
  readonly descriptors: number[] = [];

  override capturePendingFold(): PendingFoldSnapshot {
    const snapshot = super.capturePendingFold();
    for (const pinned of [snapshot.pinnedJournal, snapshot.pinnedProjection])
      if (pinned !== null) this.descriptors.push(pinned.fd);
    return snapshot;
  }
}

export function borrowedRow(index: number, bytes = 2048): IContent {
  const row = rollbackRow(index, bytes);
  return {
    ...row,
    blocks: row.blocks.map((block) =>
      block.type === 'media'
        ? { ...block, filename: `audio-${index}.wav` }
        : block,
    ),
    metadata: {
      id: `row-${index}`,
      model: 'snapshot-model',
      providerBaseURL: 'https://provider.example/v1',
      chronology: {
        seq: index + 1,
        userTurn: 1,
        step: index + 1,
        recordedAt: 1,
      },
    },
  };
}

export function rowDigest(row: IContent): string {
  return createHash('sha256').update(JSON.stringify(row)).digest('hex');
}

export interface BorrowedFixture {
  readonly store: ObservedStore;
  readonly owners: BorrowedOwners;
  readonly transaction: BorrowedOwners;
  readonly decoded: () => number;
  readonly released: () => number;
  readonly releaseWriter: () => void;
}

export async function withBorrowedFixture(
  action: (fixture: BorrowedFixture) => Promise<void>,
  pending = false,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'borrowed-snapshot-'));
  let releaseWriter = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    releaseWriter = resolve;
  });
  if (!pending) releaseWriter();
  const recorder = new SessionRecordingService({
    sessionId: 'borrowed',
    projectHash: 'borrowed',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
    io: {
      appendFile: async (path, data, encoding): Promise<void> => {
        await gate;
        await appendFile(path, data, encoding);
      },
    },
  });
  const owners = new BorrowedOwners();
  const transaction = new BorrowedOwners();
  const counters = createRowCounters();
  let decoded = 0;
  let released = 0;
  const store = new ObservedStore(
    recorder,
    {
      ...counters.counters,
      ownership: owners,
      rowDecoded: (): void => {
        decoded++;
        counters.counters.rowDecoded();
      },
      rowReleased: (): void => {
        released++;
        counters.counters.rowReleased();
      },
    },
    transaction,
  );
  try {
    await action({
      store,
      owners,
      transaction,
      decoded: () => decoded,
      released: () => released,
      releaseWriter,
    });
  } finally {
    releaseWriter();
    store.dispose();
    await recorder.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

export async function seedBorrowed(
  fixture: BorrowedFixture,
  size: number,
  bytes = 2048,
): Promise<void> {
  for (let index = 0; index < size; index++)
    fixture.store.apply({
      kind: 'content',
      content: borrowedRow(index, bytes),
    });
  await fixture.store.waitForDurable();
  expect(fixture.owners.snapshot().liveRows).toBe(0);
}

export function expectBorrowedBoundary(
  fixture: BorrowedFixture,
  references: number,
): void {
  expect(fixture.owners.snapshot().liveRows).toBe(references);
  expect(fixture.owners.references).toBe(references);
  expect(fixture.transaction.snapshot().liveRows).toBe(references);
  expect(fixture.transaction.references).toBe(references);
  expect(fixture.decoded()).toBe(fixture.released());
}

export function expectBorrowedClosed(fixture: BorrowedFixture): void {
  expectBorrowedBoundary(fixture, 0);
  expect(fixture.decoded()).toBeGreaterThan(0);
  expect(fixture.owners.snapshot().acquisitions).toBe(fixture.owners.releases);
  expect(fixture.transaction.snapshot().acquisitions).toBe(
    fixture.transaction.releases,
  );
  expect(fixture.store.descriptors.length).toBeGreaterThan(0);
  for (const fd of fixture.store.descriptors)
    expect(() => fstatSync(fd)).toThrow('EBADF');
}
