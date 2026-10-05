/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdtempSync, rmSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { HistoryService } from './HistoryService.js';
import { JournalResolver } from '../../recording/journalResolver.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import {
  AdmissionFailureRecorder,
  exactTokenizer,
  rollbackRow,
} from './chronology-rollback-test-helpers.js';
import type { IContent } from './IContent.js';

export function detachedRow(index: number, bytes = 2048): IContent {
  return {
    ...rollbackRow(index, bytes),
    metadata: {
      id: 'duplicate',
      chronology: {
        seq: index + 1,
        userTurn: index + 1,
        step: 0,
        recordedAt: 0,
      },
    },
  };
}

export async function* detachedRows(
  size: number,
  bytes = 2048,
): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < size; index++) yield detachedRow(index, bytes);
}

export interface DetachedFixture {
  readonly history: HistoryService;
  readonly recorder: AdmissionFailureRecorder;
  readonly owners: RowOwnership;
  readonly releaseWriter: () => void;
}

export async function withDetachedFixture<T>(
  action: (fixture: DetachedFixture) => Promise<T>,
  pending = false,
): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'detached-fixture-'));
  let releaseWriter = (): void => {};
  const gate = new Promise<void>((resolve) => {
    releaseWriter = resolve;
  });
  if (!pending) releaseWriter();
  const recorder = new AdmissionFailureRecorder({
    sessionId: 'detached',
    projectHash: 'detached',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
    io: {
      appendFile: async (file, data, encoding): Promise<void> => {
        await gate;
        await appendFile(file, data, encoding);
      },
    },
  });
  const owners = new RowOwnership();
  const history = new HistoryService({
    recording: recorder,
    mutationOwnership: owners,
  });
  history.setTokenizerFactory(exactTokenizer());
  try {
    return await action({ history, recorder, owners, releaseWriter });
  } finally {
    releaseWriter();
    history.dispose();
    await recorder.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

export async function detachedDigest(
  rows: AsyncIterable<IContent>,
): Promise<{ count: number; bytes: number; sha256: string }> {
  const hash = createHash('sha256');
  let count = 0;
  let bytes = 0;
  for await (const row of rows) {
    const value = JSON.stringify(row);
    hash.update(value + '\n');
    bytes += Buffer.byteLength(value);
    count++;
  }
  return { count, bytes, sha256: hash.digest('hex') };
}

export async function detachedDurableDigest(
  recorder: AdmissionFailureRecorder,
): Promise<Awaited<ReturnType<typeof detachedDigest>>> {
  const path = recorder.getFilePath();
  if (path === null) throw new Error('Missing journal');
  const resolver = await JournalResolver.open(path);
  try {
    const rows = async function* (): AsyncGenerator<IContent, void, unknown> {
      for await (const entry of resolver.resolve()) yield entry.content;
    };
    return await detachedDigest(rows());
  } finally {
    await resolver.close();
  }
}
