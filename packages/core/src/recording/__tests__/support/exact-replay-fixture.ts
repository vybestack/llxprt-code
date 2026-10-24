/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { sha256KeyHash } from '../../../journal/idKeys.js';
import { openJournalReadOnly } from '../../../journal/journalReader.js';
import { stateReaderOf } from '../../../journal/journalReaderState.js';
import { ownerKey } from '../../../journal/ownerDictionary.js';
import { readStoredRow } from '../../../journal/rowReads.js';
import {
  iterateRowEntries,
  rowTreeRootOf,
} from '../../../journal/rowTreeReader.js';
import { HistoryService } from '../../../services/history/HistoryService.js';
import type { IContent } from '../../../services/history/IContent.js';
import { decodeStoredRow } from '../../../services/history/journalRowCodec.js';
import type { LocalMediaStore } from '../../../storage/local-media-store.js';
import { JournalRecordingService } from '../../journalRecordingService.js';
import { RecordingIntegration } from '../../RecordingIntegration.js';
import type { SessionRecordingPort } from '../../recordingPort.js';
import { resumeSession } from '../../resumeSession.js';
import type { SessionMetadata } from '../../types.js';

export const PROJECT = 'w21-exact-replay';

export async function fixtureDirectory(label: string): Promise<string> {
  const root = resolve(
    import.meta.dir,
    '../../../../../..',
    'tmp/854-notes/p4/w21/exact-replay/fixtures',
  );
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, `${label}-`));
}

export function exactRow(text: string, seq: number): IContent {
  const chronology = {
    seq,
    userTurn: seq,
    step: 1,
    recordedAt: 1_900_000_000_000 + seq,
  };
  const middle = { turnId: `turn-${seq}`, model: 'fixture-model' };
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata:
      seq % 2 === 0 ? { chronology, ...middle } : { ...middle, chronology },
  };
}

export async function rowsOf(history: HistoryService): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const row of history.streamRawHistory()) rows.push(row);
  return rows;
}

export interface DiskRow {
  readonly content: IContent;
  readonly owner: number;
  readonly origin: string | undefined;
  readonly label: bigint;
  readonly offset: number;
}

export async function diskRows(file: string): Promise<DiskRow[]> {
  const reader = await openJournalReadOnly(file);
  try {
    const readState = stateReaderOf(reader, sha256KeyHash);
    const root = rowTreeRootOf(reader.trailer);
    const rows: DiskRow[] = [];
    if (root === undefined) return rows;
    for await (const entry of iterateRowEntries(reader, root)) {
      const origin =
        entry.owner === 0 ? undefined : await readState(ownerKey(entry.owner));
      if (entry.owner !== 0 && origin === undefined)
        throw new Error('Missing persisted owner');
      rows.push({
        content: decodeStoredRow(await readStoredRow(reader, entry)),
        owner: entry.owner,
        origin:
          origin === undefined ? undefined : new TextDecoder().decode(origin),
        label: entry.label,
        offset: entry.recordOffset,
      });
    }
    return rows;
  } finally {
    await reader.close();
  }
}

export function expectWireRows(
  actual: readonly IContent[],
  expected: readonly IContent[],
): void {
  expect(actual).toStrictEqual([...expected]);
  expect(actual.map((row) => Buffer.from(JSON.stringify(row)))).toStrictEqual(
    expected.map((row) => Buffer.from(JSON.stringify(row))),
  );
}

export async function expectNativeRows(
  fixture: ExactReplayFixture,
  expected: readonly IContent[],
): Promise<void> {
  expectWireRows(
    (await diskRows(fixture.path())).map((row) => row.content),
    expected,
  );
}

export class ExactReplayFixture {
  readonly history: HistoryService;
  readonly recording: JournalRecordingService;
  readonly integration: RecordingIntegration;
  readonly chats: string;
  readonly sessionId: string;

  constructor(readonly directory: string) {
    this.chats = join(directory, 'chats');
    this.sessionId = 'exact-replay';
    const config = {
      sessionId: this.sessionId,
      projectHash: PROJECT,
      chatsDir: this.chats,
      workspaceDirs: ['/work/original'],
      provider: 'test',
      model: 'model-1',
    };
    this.history = new HistoryService({});
    this.recording = JournalRecordingService.create(config);
    this.integration = new RecordingIntegration(this.recording);
  }

  path(): string {
    const file = this.recording.getFilePath();
    if (file === null) throw new Error('Expected recording file');
    return file;
  }

  async close(): Promise<void> {
    await this.integration.dispose();
    await this.history.dispose();
    await this.history.waitForOwnershipSettlement();
    await this.recording.dispose();
  }

  async resume(
    run: (
      history: HistoryService,
      integration: RecordingIntegration,
      recording: SessionRecordingPort,
      metadata: SessionMetadata,
    ) => Promise<void>,
    mediaStore?: LocalMediaStore,
    provider = 'test',
    model = 'model-1',
  ): Promise<void> {
    const resumed = await resumeSession({
      continueRef: this.sessionId,
      projectHash: PROJECT,
      chatsDir: this.chats,
      currentProvider: provider,
      currentModel: model,
      workspaceDirs: ['/resume/default'],
      ...(mediaStore === undefined ? {} : { mediaStore }),
    });
    if (!resumed.ok) throw new Error(resumed.error);
    const history = new HistoryService({});
    const integration = new RecordingIntegration(resumed.recording);
    try {
      await history.adoptResumeBoot(resumed.recording, resumed.boot);
      await integration.subscribeToJournal(history);
      expect(resumed.recording.getFilePath()).toBe(this.path());
      expect(await resumed.lockHandle.ownsLock()).toBe(true);
      await run(history, integration, resumed.recording, resumed.metadata);
    } finally {
      await integration.dispose();
      await history.dispose();
      await history.waitForOwnershipSettlement();
      await resumed.recording.dispose();
    }
  }
}
