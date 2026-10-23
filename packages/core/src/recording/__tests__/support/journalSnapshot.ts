/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '../../../services/history/IContent.js';
import { JournalSession } from '../../../services/history/journalSession.js';
import { JournalCheckpointService } from '../../journalCheckpointService.js';
import {
  SESSION_KEYS,
  decodeSessionFact,
  readSessionFacts,
} from '../../sessionMetaKeys.js';
import type { CheckpointMetadataView, SessionMetadata } from '../../types.js';

export interface JournalSnapshot {
  readonly history: readonly IContent[];
  readonly metadata: SessionMetadata;
  readonly checkpoints: readonly CheckpointMetadataView[];
  readonly ancestry: unknown;
  readonly sessionName?: string | null;
  readonly commitSeq: number;
}

export async function readJournalSnapshot(
  filePath: string,
  projectHash: string,
): Promise<JournalSnapshot> {
  const session = await JournalSession.open(filePath);
  try {
    const facts = await readSessionFacts((key) => session.store.getState(key));
    if (facts === undefined || facts.start.projectHash !== projectHash)
      throw new Error('Missing fixture session or mismatched project');
    const history: IContent[] = [];
    for await (const row of session.rows()) history.push(row.content);
    const fork = await session.store.getState(SESSION_KEYS.fork);
    return {
      history,
      metadata: {
        sessionId: facts.sessionId,
        projectHash: facts.start.projectHash,
        startTime: facts.start.startTime,
        provider: facts.provider,
        model: facts.model,
        workspaceDirs: facts.directories,
        kind: facts.start.kind,
        ...(facts.title === undefined ? {} : { title: facts.title }),
      },
      checkpoints: await new JournalCheckpointService().listCheckpoints(
        filePath,
      ),
      ancestry: fork === undefined ? undefined : decodeSessionFact(fork),
      ...(facts.name === undefined ? {} : { sessionName: facts.name }),
      commitSeq: session.store.published?.commitSeq ?? 0,
    };
  } finally {
    await session.close();
  }
}
