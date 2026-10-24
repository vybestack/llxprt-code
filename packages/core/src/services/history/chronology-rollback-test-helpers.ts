/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { openJournalReadOnly } from '../../journal/journalReader.js';
import { readStoredRow } from '../../journal/rowReads.js';
import {
  iterateRowEntries,
  rowTreeRootOf,
} from '../../journal/rowTreeReader.js';
import { decodeStoredRow } from './journalRowCodec.js';
import type { SessionRecordingPort } from '../../recording/recordingPort.js';
import type { RuntimeTokenizerFactory } from '../../runtime/contracts/RuntimeTokenizerFactory.js';
import type { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import type { DetachedIOFaults } from './__tests__/support/detached-io-faults.js';
import type { HistoryMediaOwner } from './historyBatchContracts.js';
import type { ContextRange } from './historyEventTypes.js';

export function expectedRange(size: number): ContextRange {
  return {
    firstSeq: 1,
    lastSeq: size,
    totalEntries: size,
    removedInterior: [],
    approximate: false,
  };
}

export async function durableRowsOf(
  recorder: SessionRecordingPort,
): Promise<IContent[]> {
  await recorder.flush();
  const filePath = recorder.getFilePath();
  if (filePath === null) throw new Error('Missing durable journal');
  const reader = await openJournalReadOnly(filePath);
  try {
    const result: IContent[] = [];
    const root = rowTreeRootOf(reader.trailer);
    if (root !== undefined) {
      for await (const entry of iterateRowEntries(reader, root)) {
        result.push(decodeStoredRow(await readStoredRow(reader, entry)));
      }
    }
    return result;
  } finally {
    await reader.close();
  }
}

export function rollbackRow(index: number, bytes = 0): IContent {
  const speakers: ReadonlyArray<IContent['speaker']> = ['human', 'ai', 'tool'];
  return {
    speaker: speakers[index % 3],
    blocks: [
      { type: 'text', text: `${index}:${'x'.repeat(bytes)}` },
      {
        type: 'tool_call',
        id: `call-${index}`,
        name: 'inspect',
        parameters: { index },
      },
      {
        type: 'tool_response',
        callId: `call-${index}`,
        toolName: 'inspect',
        result: { index },
      },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'audio/wav',
        data: 'aGVsbG8=',
        caption: `media-${index}`,
      },
    ],
  };
}

export function exactTokenizer(fail?: () => void): RuntimeTokenizerFactory {
  return {
    getTokenizer: () => ({
      fallbackPolicy: 'deny',
      countTokens: async (): Promise<number> => {
        fail?.();
        return 1;
      },
    }),
    estimatePrompt: async (request) => ({
      count: await request.legacyEstimate(),
      method: 'exact',
      family: 'rollback-test',
      estimatorVersion: '1',
      assetRevision: '1',
      projectionRevision: request.projectionRevision,
    }),
  };
}

export function mediaParticipant(
  prepare: HistoryMediaOwner['prepareReplacement'],
): HistoryMediaOwner {
  return {
    prepareReplacement: prepare,
    adopt: () => undefined,
    reconcile: async () => undefined,
    releaseAll: async () => undefined,
  };
}

export function journalMediaParticipant(
  prepare: () => ReturnType<HistoryMediaOwner['prepareReplacement']>,
): HistoryMediaOwner {
  const prepareReferences: NonNullable<
    HistoryMediaOwner['prepareReferenceReplacement']
  > = async (references) => {
    for await (const reference of references) void reference;
    return prepare();
  };
  return {
    prepareReferenceAddition: prepareReferences,
    prepareReferenceReplacement: prepareReferences,
    prepareReplacement: prepare,
    adopt: () => undefined,
    reconcile: async () => undefined,
    releaseAll: async () => undefined,
  };
}

export async function withRollbackFixture<T>(
  action: (
    history: HistoryService,
    recorder: SessionRecordingPort,
    releaseWriter: () => void,
    io: DetachedIOFaults,
  ) => Promise<T>,
  pending = false,
): Promise<T> {
  return withNativeDetachedFixture(async (fixture) => {
    if (pending) fixture.pauseWriter();
    return action(
      fixture.history,
      fixture.recording,
      fixture.releaseWriter,
      fixture.io,
    );
  });
}

/** Journal rows carry stamped chronology; bodies compare speaker and blocks only. */
export function rowBodies(rows: readonly IContent[]): unknown[] {
  return rows.map((row) => [row.speaker, row.blocks]);
}

export async function rowsOf(history: HistoryService): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const row of history.getRecent(0)) rows.push(row);
  return rows;
}

export async function rejectedValue(
  operation: Promise<void>,
): Promise<unknown> {
  try {
    await operation;
    return undefined;
  } catch (error: unknown) {
    return error;
  }
}
