/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256KeyHash } from '../../../../journal/idKeys.js';
import { openJournalReadOnly } from '../../../../journal/journalReader.js';
import { stateReaderOf } from '../../../../journal/journalReaderState.js';
import { ownerKey } from '../../../../journal/ownerDictionary.js';
import { readStoredRow } from '../../../../journal/rowReads.js';
import {
  iterateRowEntries,
  rowTreeRootOf,
} from '../../../../journal/rowTreeReader.js';
import { JournalRecordingService } from '../../../../recording/journalRecordingService.js';
import { RecordingIntegration } from '../../../../recording/RecordingIntegration.js';
import type { SessionRecordingPort } from '../../../../recording/recordingPort.js';
import { HistoryService } from '../../HistoryService.js';
import type { ContentMetadata, IContent } from '../../IContent.js';
import { decodeStoredRow } from '../../journalRowCodec.js';
import { accountingFactory } from './token-accounting-stream-test-helpers.js';

export const MIB = 1024 * 1024;
export const LARGE_METADATA: ContentMetadata = {
  id: 'large-row',
  model: 'large-row-model',
  chronology: { seq: 1, userTurn: 1, step: 1, recordedAt: 1234 },
};

export interface RowDigest {
  readonly bytes: number;
  readonly hash: string;
  readonly speaker: IContent['speaker'];
  readonly metadata: ContentMetadata | undefined;
  readonly blocks: number;
}

export function largeHistory(): HistoryService {
  const history = new HistoryService({});
  history.setTokenizerFactory(accountingFactory((text) => text.length));
  return history;
}

export async function largeRig(): Promise<{
  history: HistoryService;
  recording: JournalRecordingService;
  integration: RecordingIntegration;
  origin: object;
  directory: string;
  close(): Promise<void>;
}> {
  const root = new URL(
    '../../../../../../../tmp/854-notes/p4/w21/service-large-row/fixtures/',
    import.meta.url,
  ).pathname;
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'case-'));
  const history = largeHistory();
  const recording = JournalRecordingService.create({
    sessionId: 'service-large-row',
    projectHash: 'service-large-row-project',
    chatsDir: directory,
    workspaceDirs: ['/work'],
    provider: 'anthropic',
    model: 'large-row-model',
  });
  const integration = new RecordingIntegration(recording);
  const origin = {};
  await integration.subscribeToJournal(history, origin);
  await history.waitForCommit();
  await integration.flushAtTurnBoundary();
  return {
    history,
    recording,
    integration,
    origin,
    directory,
    close: async () => {
      await integration.dispose();
      await history.dispose();
      await recording.dispose();
    },
  };
}

function piece(index: number): string {
  const unit = `${index.toString(36).padStart(6, '0')}:α\\"\n`;
  return unit.repeat(Math.floor((64 * 1024) / Buffer.byteLength(unit)));
}

export async function admitLargeRow(
  history: HistoryService,
  origin: object,
  bytes: number,
): Promise<{ bytes: number; hash: string }> {
  const pieces: string[] = [];
  const hash = createHash('sha256');
  let remaining = bytes;
  for (let index = 0; remaining > 0; index++) {
    const chunk = piece(index);
    const text =
      remaining >= Buffer.byteLength(chunk) ? chunk : 'z'.repeat(remaining);
    pieces.push(text);
    hash.update(text);
    remaining -= Buffer.byteLength(text);
  }
  await history.addBatch(
    [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: pieces.join('') }],
        metadata: LARGE_METADATA,
      },
    ],
    undefined,
    { origin },
  );
  await history.waitForTokenUpdates();
  await history.waitForCommit();
  return { bytes, hash: hash.digest('hex') };
}

export function rowDigest(content: IContent): RowDigest {
  const block = content.blocks[0];
  if (block.type !== 'text') throw new Error('Expected the complete text row');
  return {
    bytes: Buffer.byteLength(block.text),
    hash: createHash('sha256').update(block.text).digest('hex'),
    speaker: content.speaker,
    metadata: content.metadata,
    blocks: content.blocks.length,
  };
}

export async function publicDigest(
  history: HistoryService,
  retained: IContent[] = [],
  trap = false,
): Promise<RowDigest[]> {
  const summaries: RowDigest[] = [];
  for await (const row of history.streamRawHistory()) {
    summaries.push(rowDigest(row));
    if (trap) retained.push(row);
  }
  return summaries;
}

export async function diskDigest(recording: SessionRecordingPort): Promise<{
  rows: RowDigest[];
  owners: Array<string | undefined>;
  offsets: number[];
  bodyBytes: number[];
  durableEnd: number;
}> {
  const file = recording.getFilePath();
  if (file === null) throw new Error('Expected a native recorder file');
  const reader = await openJournalReadOnly(file);
  try {
    const root = rowTreeRootOf(reader.trailer);
    if (root === undefined) throw new Error('Expected a committed row tree');
    const state = stateReaderOf(reader, sha256KeyHash);
    const rows: RowDigest[] = [];
    const owners: Array<string | undefined> = [];
    const offsets: number[] = [];
    const bodyBytes: number[] = [];
    for await (const entry of iterateRowEntries(reader, root)) {
      const owner =
        entry.owner === 0 ? undefined : await state(ownerKey(entry.owner));
      if (entry.owner !== 0 && owner === undefined)
        throw new Error('Missing row owner');
      owners.push(
        owner === undefined ? undefined : new TextDecoder().decode(owner),
      );
      offsets.push(entry.recordOffset);
      bodyBytes.push(
        (await reader.readRecordHead(entry.recordOffset, 'ROW')).bodyLen,
      );
      rows.push(rowDigest(decodeStoredRow(await readStoredRow(reader, entry))));
    }
    return {
      rows,
      owners,
      offsets,
      bodyBytes,
      durableEnd: reader.trailer?.durableEnd ?? 0,
    };
  } finally {
    await reader.close();
  }
}
