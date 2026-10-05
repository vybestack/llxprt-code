/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createRequire } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdmissionFailureRecorder } from './chronology-rollback-test-helpers.js';
import type {
  SessionEventType,
  SessionRecordLine,
} from '../../recording/types.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { createRowCounters } from '../../recording/journalCounters.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import { DetachedHistoryJournal } from './detachedHistoryJournal.js';
import { DetachedHistoryPublication } from './detachedHistoryPublication.js';
import { detachedRow } from './detached-rollback-test-helpers.js';
import { fieldOf, isSpeakerContent } from './historyJournalGuards.js';
import type { IContent } from './IContent.js';

const { gcAndSweep }: { gcAndSweep(): void } = createRequire(import.meta.url)(
  'bun:jsc',
);

export function envelopeGate(): { promise: Promise<void>; resolve(): void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function envelopeGC(): Promise<void> {
  for (let index = 0; index < 4; index++) {
    await setImmediate();
    gcAndSweep();
  }
}

export function envelopeSurvivors(
  refs: ReadonlyArray<WeakRef<object>>,
): number {
  return refs.filter((ref) => ref.deref() !== undefined).length;
}

export class EnvelopeRecorder extends AdmissionFailureRecorder {
  readonly lines: Array<WeakRef<SessionRecordLine>> = [];
  readonly payloads: Array<WeakRef<object>> = [];
  readonly rows: Array<WeakRef<IContent>> = [];

  override enqueue(
    type: SessionEventType,
    payload: unknown,
  ): SessionRecordLine | null {
    const line = super.enqueue(type, payload);
    if (line !== null && type === 'content') {
      const row = fieldOf(payload, 'content');
      if (!isSpeakerContent(row)) throw new Error('Missing envelope content');
      this.lines.push(new WeakRef(line));
      if (typeof payload !== 'object' || payload === null)
        throw new Error('Missing envelope payload');
      this.payloads.push(new WeakRef(payload));
      this.rows.push(new WeakRef(row));
    }
    return line;
  }
}

export interface EnvelopeFixture {
  readonly recorder: EnvelopeRecorder;
  readonly store: HistoryJournalStore;
  readonly owners: RowOwnership;
  readonly writerStarted: ReturnType<typeof envelopeGate>;
  readonly writer: ReturnType<typeof envelopeGate>;
}

export async function withEnvelopeFixture(
  execute: (fixture: EnvelopeFixture) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'publication-envelope-'));
  const writerStarted = envelopeGate();
  const writer = envelopeGate();
  const recorder = new EnvelopeRecorder({
    sessionId: 'envelope',
    projectHash: 'envelope',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
    io: {
      appendFile: async (file, data, encoding): Promise<void> => {
        writerStarted.resolve();
        await writer.promise;
        await appendFile(file, data, encoding);
      },
    },
  });
  const owners = new RowOwnership();
  const store = new HistoryJournalStore(recorder, {
    ...createRowCounters().counters,
    ownership: owners,
  });
  try {
    await execute({ recorder, store, owners, writerStarted, writer });
  } finally {
    writer.resolve();
    store.dispose();
    await recorder.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

export function seedEnvelopeStore(
  store: HistoryJournalStore,
  size: number,
  bytes: number,
): Array<WeakRef<IContent>> {
  const weak: Array<WeakRef<IContent>> = [];
  for (let index = 0; index < size; index++) {
    const content = detachedRow(index, bytes);
    weak.push(new WeakRef(content));
    store.apply({ kind: 'content', content });
  }
  return weak;
}

export function seedEnvelopePublication(
  fixture: EnvelopeFixture,
  size: number,
  bytes: number,
): {
  previous: DetachedHistoryJournal;
  next: DetachedHistoryJournal;
  publication: DetachedHistoryPublication;
  completed: Promise<void>;
  weak: Array<WeakRef<IContent>>;
} {
  const previous = new DetachedHistoryJournal(fixture.owners);
  const next = new DetachedHistoryJournal(fixture.owners);
  const weak: Array<WeakRef<IContent>> = [];
  for (let index = 0; index < size; index++) {
    const row = detachedRow(index, bytes);
    weak.push(new WeakRef(row));
    next.append(row);
  }
  const publication = new DetachedHistoryPublication(
    fixture.store,
    fixture.owners,
  );
  return {
    previous,
    next,
    publication,
    completed: publication.publish(previous, next),
    weak,
  };
}

export function envelopeCensus(fixture: EnvelopeFixture): {
  lines: number;
  payloads: number;
  rows: number;
} {
  return {
    lines: envelopeSurvivors(fixture.recorder.lines),
    payloads: envelopeSurvivors(fixture.recorder.payloads),
    rows: envelopeSurvivors(fixture.recorder.rows),
  };
}
