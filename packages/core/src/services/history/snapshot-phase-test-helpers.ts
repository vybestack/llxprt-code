/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { createRowCounters } from '../../recording/journalCounters.js';
import { AdmissionFailureRecorder } from './chronology-rollback-test-helpers.js';
import { HistoryJournalStore } from './historyJournalStore.js';

interface OwnerEvent {
  readonly kind: 'retain' | 'release';
  readonly rowId: number;
  readonly references: number;
  readonly stack: string;
}

export class PhaseOwners extends RowOwnership {
  readonly events: OwnerEvent[] = [];
  references = 0;
  private readonly identities = new WeakMap<object, number>();
  private nextIdentity = 0;

  get lastEvent(): OwnerEvent | undefined {
    return this.events[this.events.length - 1];
  }

  identity(row: object): number {
    let id = this.identities.get(row);
    if (id === undefined) {
      id = ++this.nextIdentity;
      this.identities.set(row, id);
    }
    return id;
  }

  override retain(row: object): void {
    super.retain(row);
    this.references++;
    this.record('retain', row);
  }

  override release(row: object): void {
    super.release(row);
    this.references--;
    this.record('release', row);
  }

  private record(kind: OwnerEvent['kind'], row: object): void {
    this.events.push({
      kind,
      rowId: this.identity(row),
      references: this.references,
      stack: new Error().stack ?? '',
    });
  }
}

export function expectPendingAdmission(
  owners: PhaseOwners,
  transaction: PhaseOwners,
  row: object,
): void {
  const bytes = Buffer.byteLength(JSON.stringify(row), 'utf8');
  expect({ ...owners.snapshot(), references: owners.references }).toMatchObject(
    {
      liveRows: 1,
      liveSerializedBytes: bytes,
      acquisitions: 4,
      references: 1,
    },
  );
  expect({
    ...transaction.snapshot(),
    references: transaction.references,
  }).toMatchObject({
    liveRows: 0,
    liveSerializedBytes: 0,
    acquisitions: 2,
    references: 0,
  });
  expect(owners.events.map((event) => event.rowId)).toStrictEqual(
    Array(7).fill(owners.identity(row)),
  );
  expect(owners.events.map((event) => event.references)).toStrictEqual([
    1, 2, 3, 2, 3, 2, 1,
  ]);
  expect(owners.events[0].stack).toContain('admitHistoryPending');
  expect(owners.events[1].stack).toContain('captureHistoryMutationSnapshot');
  expect(owners.events[2].stack).toContain('captureMutationRow');
  expect(owners.events[3].stack).toContain('captureMutationRow');
  expect(owners.events[4].stack).toContain('readRows');
  expect(owners.events[5].stack).toContain('readRows');
  expect(owners.events[6].stack).toContain('historyMutationSnapshot.ts');
  expect(transaction.events.map((event) => event.references)).toStrictEqual([
    1, 2, 1, 0,
  ]);
}

export function expectPhaseEmpty(owners: PhaseOwners): void {
  expect({ ...owners.snapshot(), references: owners.references }).toMatchObject(
    {
      liveRows: 0,
      liveSerializedBytes: 0,
      references: 0,
    },
  );
  expect(owners.events.filter((event) => event.kind === 'release').length).toBe(
    owners.snapshot().acquisitions,
  );
}

export function recordPhase(
  stage: string,
  owners: PhaseOwners,
  transaction: PhaseOwners,
): void {
  const output = process.env['SNAPSHOT_PHASE_OUTPUT'];
  if (output === undefined) return;
  appendFileSync(
    output,
    JSON.stringify({
      stage,
      total: { ...owners.snapshot(), references: owners.references },
      snapshot: {
        ...transaction.snapshot(),
        references: transaction.references,
      },
      events: owners.events,
      snapshotEvents: transaction.events,
    }) + '\n',
  );
}

interface PhaseFixture {
  readonly store: HistoryJournalStore;
  readonly recorder: AdmissionFailureRecorder;
  readonly owners: PhaseOwners;
  readonly transaction: PhaseOwners;
  readonly releaseWriter: () => void;
  readonly failWriter: (failure: Error) => void;
}

export async function withPhaseFixture(
  action: (fixture: PhaseFixture) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'snapshot-phase-'));
  let releaseWriter = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    releaseWriter = resolve;
  });
  let failure: Error | undefined;
  const recorder = new AdmissionFailureRecorder({
    sessionId: 'phase',
    projectHash: 'phase',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
    io: {
      appendFile: async (path, data, encoding): Promise<void> => {
        await gate;
        if (failure !== undefined) throw failure;
        await appendFile(path, data, encoding);
      },
    },
  });
  const owners = new PhaseOwners();
  const transaction = new PhaseOwners();
  const store = new HistoryJournalStore(
    recorder,
    { ...createRowCounters().counters, ownership: owners },
    transaction,
  );
  try {
    await action({
      store,
      recorder,
      owners,
      transaction,
      releaseWriter,
      failWriter: (error): void => {
        failure = error;
        releaseWriter();
      },
    });
  } finally {
    releaseWriter();
    store.dispose();
    await recorder.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}
