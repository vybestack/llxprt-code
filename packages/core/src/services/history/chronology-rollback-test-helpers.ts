/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdtempSync, rmSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import type {
  SessionEventType,
  SessionRecordLine,
} from '../../recording/types.js';
import type { RuntimeTokenizerFactory } from '../../runtime/contracts/RuntimeTokenizerFactory.js';
import { HistoryService } from './HistoryService.js';
import { JournalResolver } from '../../recording/journalResolver.js';
import type { ContextRange } from './historyEventTypes.js';
import type { IContent } from './IContent.js';
import type { HistoryMediaOwner } from './historyBatchContracts.js';

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
  recorder: SessionRecordingService,
): Promise<IContent[]> {
  const filePath = recorder.getFilePath();
  if (filePath === null) throw new Error('Missing durable journal');
  const resolver = await JournalResolver.open(filePath);
  const rows: IContent[] = [];
  try {
    for await (const entry of resolver.resolve()) rows.push(entry.content);
    return rows;
  } finally {
    await resolver.close();
  }
}

export class AdmissionFailureRecorder extends SessionRecordingService {
  private remaining: number | undefined;
  readonly failure = new Error('injected journal admission failure');

  failAdmissionAfter(successfulAdmissions: number): void {
    this.remaining = successfulAdmissions;
  }

  override enqueue(
    type: SessionEventType,
    payload: unknown,
  ): SessionRecordLine | null {
    if (this.remaining === 0) {
      this.remaining = undefined;
      throw this.failure;
    }
    if (this.remaining !== undefined) this.remaining--;
    return super.enqueue(type, payload);
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

export async function withRollbackFixture<T>(
  action: (
    history: HistoryService,
    recorder: AdmissionFailureRecorder,
    releaseWriter: () => void,
  ) => Promise<T>,
  pending = false,
): Promise<T> {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const releaseWriter = (): void => release?.();
  if (!pending) releaseWriter();
  const root = mkdtempSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../tmp/chronology-rollback-fixture-',
    ),
  );
  const recorder = new AdmissionFailureRecorder({
    sessionId: 'rollback',
    projectHash: 'rollback',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
    io: {
      appendFile: async (filePath, data, encoding): Promise<void> => {
        await gate;
        await appendFile(filePath, data, encoding);
      },
    },
  });
  const history = new HistoryService({ recording: recorder });
  history.setTokenizerFactory(exactTokenizer());
  try {
    return await action(history, recorder, releaseWriter);
  } finally {
    releaseWriter();
    history.dispose();
    await recorder.dispose();
    rmSync(root, { recursive: true, force: true });
  }
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
