/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { stat } from 'node:fs/promises';
import { z } from 'zod';
import {
  scanResumeMetadata,
  type ReplayResult,
} from '@vybestack/llxprt-code-core';
import { selectBackend } from '@vybestack/llxprt-code-core/services/history/historyBackendSelect.js';
import {
  readJournalFileFacts,
  readJournalCheckpoints,
} from '@vybestack/llxprt-code-core/recording/journalSessionListing.js';
import { openJournalReadOnly } from '@vybestack/llxprt-code-core/journal/journalReader.js';
import { stateReaderOf } from '@vybestack/llxprt-code-core/journal/journalReaderState.js';
import { sha256KeyHash } from '@vybestack/llxprt-code-core/journal/idKeys.js';
import {
  SESSION_KEYS,
  decodeSessionFact,
} from '@vybestack/llxprt-code-core/recording/sessionMetaKeys.js';

export type RecordingMetadata = Pick<
  Extract<ReplayResult, { ok: true }>,
  'metadata' | 'checkpoints' | 'sessionName' | 'ancestry'
>;

const ancestrySchema = z.object({
  parentSessionId: z.string(),
  parentSequence: z.number().int().nonnegative(),
  checkpointId: z.string(),
  checkpointName: z.string(),
});

export async function readRecordingMetadata(
  filePath: string,
  projectHash: string,
): Promise<RecordingMetadata> {
  if (selectBackend() === 'old') {
    const { replay } = await scanResumeMetadata(
      filePath,
      projectHash,
      (await stat(filePath)).size,
    );
    if (!replay.ok) throw new Error(replay.error);
    return replay;
  }
  const found = await readJournalFileFacts(filePath);
  if (found === undefined)
    throw new Error(`Session file ${filePath} holds no committed session`);
  const { facts } = found;
  if (facts.start.projectHash !== projectHash)
    throw new Error('Session project hash mismatch');
  const reader = await openJournalReadOnly(filePath);
  try {
    const fork = await stateReaderOf(reader, sha256KeyHash)(SESSION_KEYS.fork);
    return {
      metadata: {
        ...facts.start,
        sessionId: facts.sessionId,
        provider: facts.provider,
        model: facts.model,
        workspaceDirs: facts.directories,
        ...(facts.title === undefined ? {} : { title: facts.title }),
      },
      sessionName: facts.name,
      ...(fork === undefined
        ? {}
        : { ancestry: ancestrySchema.parse(decodeSessionFact(fork)) }),
      checkpoints: (await readJournalCheckpoints(filePath)).map(
        (checkpoint) => ({
          checkpointId: checkpoint.checkpointId,
          name: checkpoint.name,
          sequence: checkpoint.sequence,
          createdAt: new Date(checkpoint.createdAtMs).toISOString(),
          deleted: false,
        }),
      ),
    };
  } finally {
    await reader.close();
  }
}
