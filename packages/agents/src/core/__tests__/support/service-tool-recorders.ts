/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { join } from 'node:path';
import { z } from 'zod';
import { loadFlushRecords } from '@vybestack/llxprt-code-core/journal/flushRecords.js';
import {
  testJournalSeams,
  type Failures,
} from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { openJournalReadOnly } from '@vybestack/llxprt-code-core/journal/journalReader.js';
import { stateReaderOf } from '@vybestack/llxprt-code-core/journal/journalReaderState.js';
import { sha256KeyHash } from '@vybestack/llxprt-code-core/journal/idKeys.js';
import { ownerKey } from '@vybestack/llxprt-code-core/journal/ownerDictionary.js';
import { readStoredRow } from '@vybestack/llxprt-code-core/journal/rowReads.js';
import {
  iterateRowEntries,
  rowTreeRootOf,
} from '@vybestack/llxprt-code-core/journal/rowTreeReader.js';
import { decodeStoredRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  JournalRecordingService,
  type JournalRecordingConfig,
} from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { providerName, modelName } from './service-tool-runtime.js';

export const projectHash = 'w21-service-tool-crash';
export const eventSchema = z.object({
  type: z.string(),
  pid: z.number(),
  details: z.record(z.string(), z.unknown()),
});
export type DriverEvent = z.infer<typeof eventSchema>;
export function report(type: string, details: Record<string, unknown>): void {
  if (process.send === undefined) throw new Error('Missing parent IPC');
  process.send({ type, pid: process.pid, details });
}
export function recordingConfig(
  directory: string,
  name: string,
): JournalRecordingConfig {
  return {
    sessionId: name,
    projectHash,
    chatsDir: join(directory, name),
    workspaceDirs: ['/work'],
    provider: providerName,
    model: modelName,
  };
}
export async function observedRecording(directory: string, name: string) {
  const failures: Failures = { recordKinds: true };
  const seams = testJournalSeams(failures);
  const fullFlush = await loadFlushRecords();
  let flushes = 0;
  const recording = await JournalRecordingService.createLocked({
    ...recordingConfig(directory, name),
    journal: {
      journal: {
        ...seams.dependencies,
        flush: (fd) => {
          fullFlush(fd);
          flushes++;
        },
      },
    },
  });
  return { recording, failures, seams, flushes: () => flushes };
}
export function recordingFile(recording: JournalRecordingService): string {
  const file = recording.getFilePath();
  if (file === null) throw new Error('Missing recording');
  return file;
}
export interface DiskToolRow {
  readonly content: IContent;
  readonly owner: string | null;
}
export async function diskToolState(
  file: string,
): Promise<{ seq: number; rows: DiskToolRow[] }> {
  const reader = await openJournalReadOnly(file);
  try {
    const root = rowTreeRootOf(reader.trailer);
    const rows: DiskToolRow[] = [];
    const state = stateReaderOf(reader, sha256KeyHash);
    if (root === undefined)
      return { seq: reader.trailer?.commitSeq ?? 0, rows };
    for await (const entry of iterateRowEntries(reader, root)) {
      const owner =
        entry.owner === 0 ? undefined : await state(ownerKey(entry.owner));
      if (entry.owner !== 0 && owner === undefined)
        throw new Error('Missing persisted row owner');
      rows.push({
        content: decodeStoredRow(await readStoredRow(reader, entry)),
        owner: owner === undefined ? null : new TextDecoder().decode(owner),
      });
    }
    return { seq: reader.trailer?.commitSeq ?? 0, rows };
  } finally {
    await reader.close();
  }
}
