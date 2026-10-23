/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdir, mkdtemp } from 'node:fs/promises';
import type { LocalMediaStore } from '../../../../storage/local-media-store.js';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  testJournalSeams,
  type Failures,
  type TestJournalSeams,
} from '../../../../journal/__tests__/support/journalFixtures.js';
import { loadFlushRecords } from '../../../../journal/flushRecords.js';
import { openJournalReadOnly } from '../../../../journal/journalReader.js';
import type { RowEntry } from '../../../../journal/rowEntry.js';
import {
  iterateRowEntries,
  rowTreeRootOf,
} from '../../../../journal/rowTreeReader.js';
import {
  JournalRecordingService,
  type JournalRecordingConfig,
} from '../../../../recording/journalRecordingService.js';
import {
  JournalResumeBoot,
  resumePointOf,
} from '../../../../recording/journalResume.js';
import { RecordingIntegration } from '../../../../recording/RecordingIntegration.js';
import { HistoryService } from '../../HistoryService.js';
import type { IContent } from '../../IContent.js';
import {
  persistedMutationRows,
  type PersistedMutationRow,
} from './service-recorder-mutations.js';

export async function persistedEntries(file: string): Promise<RowEntry[]> {
  const reader = await openJournalReadOnly(file);
  try {
    const root = rowTreeRootOf(reader.trailer);
    const entries: RowEntry[] = [];
    if (root !== undefined)
      for await (const entry of iterateRowEntries(reader, root))
        entries.push(entry);
    return entries;
  } finally {
    await reader.close();
  }
}

export const atomicityRoot = resolve(
  import.meta.dir,
  '../../../../../../../tmp/854-notes/p4/w21/service-atomicity',
);

export function atomicRow(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

export async function atomicDirectory(name: string): Promise<string> {
  await mkdir(join(atomicityRoot, 'fixtures'), { recursive: true });
  return mkdtemp(join(atomicityRoot, 'fixtures', `${name}-`));
}

export interface AtomicRecorder {
  readonly failures: Failures;
  readonly seams: TestJournalSeams;
  readonly config: JournalRecordingConfig;
  readonly recording: JournalRecordingService;
}

export async function atomicRecorder(
  directory: string,
  name: string,
): Promise<AtomicRecorder> {
  const failures: Failures = { recordKinds: true };
  const seams = testJournalSeams(failures);
  const flush = await loadFlushRecords();
  const config: JournalRecordingConfig = {
    sessionId: name,
    projectHash: 'service-atomicity',
    chatsDir: join(directory, name),
    workspaceDirs: ['/work'],
    provider: 'anthropic',
    model: 'model-1',
    journal: {
      journal: {
        ...seams.dependencies,
        flush: (fd) => {
          seams.dependencies.flush(fd);
          flush(fd);
        },
      },
    },
  };
  const recording = JournalRecordingService.create(config);
  return { failures, seams, config, recording };
}

export function writes(recorder: AtomicRecorder): number {
  return recorder.seams.events.filter((event) => event.type === 'write').length;
}

export function fileOf(recording: JournalRecordingService): string {
  const file = recording.getFilePath();
  if (file === null) throw new Error('Missing native file');
  return file;
}

export async function diskVersion(file: string): Promise<number> {
  const reader = await openJournalReadOnly(file);
  try {
    return reader.trailer?.commitSeq ?? 0;
  } finally {
    await reader.close();
  }
}

export async function liveRows(history: HistoryService): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const row of history.streamRawHistory()) rows.push(row);
  return rows;
}

export interface AtomicRig {
  readonly directory: string;
  readonly primary: AtomicRecorder;
  readonly mirror: AtomicRecorder;
  readonly history: HistoryService;
  readonly integration: RecordingIntegration;
  readonly origin: object;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export async function atomicRig(name: string): Promise<AtomicRig> {
  const directory = await atomicDirectory(name);
  const primary = await atomicRecorder(directory, 'primary');
  const mirror = await atomicRecorder(directory, 'mirror');
  const history = new HistoryService({});
  await history.adoptResumeBoot(
    primary.recording,
    new JournalResumeBoot(
      primary.recording,
      await resumePointOf(primary.recording),
    ),
  );
  const integration = new RecordingIntegration(mirror.recording);
  const origin = {};
  await integration.subscribeToJournal(history, origin);
  let closed = false;
  return {
    directory,
    primary,
    mirror,
    history,
    integration,
    origin,
    flush: () => integration.flushAtTurnBoundary(),
    close: async (): Promise<void> => {
      if (closed) return;
      closed = true;
      primary.seams.release();
      mirror.seams.release();
      const failures: unknown[] = [];
      for (const close of [
        () => integration.dispose(),
        () => history.dispose(),
        () => mirror.recording.dispose(),
        () => primary.recording.dispose(),
      ]) {
        try {
          await close();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1)
        throw new AggregateError(failures, 'Atomicity fixture close failed');
    },
  };
}

export async function reopenedRows(
  recorder: AtomicRecorder,
  mediaStore?: LocalMediaStore,
): Promise<PersistedMutationRow[]> {
  const recording = await JournalRecordingService.open(
    { ...recorder.config, journal: undefined, mediaStore },
    fileOf(recorder.recording),
  );
  const history = new HistoryService({});
  try {
    await history.adoptResumeBoot(
      recording,
      new JournalResumeBoot(recording, await resumePointOf(recording)),
    );
    const rows = await liveRows(history);
    const persisted = await persistedMutationRows(recording);
    if (
      !isDeepStrictEqual(
        rows,
        persisted.map(({ content }) => content),
      )
    )
      throw new Error('Reopened service and persisted rows differ');
    return persisted;
  } finally {
    await history.dispose();
    await recording.dispose();
  }
}
