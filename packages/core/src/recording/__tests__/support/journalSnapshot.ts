/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '../../../services/history/IContent.js';
import { openJournalReadOnly } from '../../../journal/journalReader.js';
import { stateReaderOf } from '../../../journal/journalReaderState.js';
import { sha256KeyHash } from '../../../journal/idKeys.js';
import {
  iterateRowEntries,
  rowTreeRootOf,
} from '../../../journal/rowTreeReader.js';
import { readStoredRow } from '../../../journal/rowReads.js';
import { decodeStoredRow } from '../../../services/history/journalRowCodec.js';
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
  const reader = await openJournalReadOnly(filePath);
  const readState = stateReaderOf(reader, sha256KeyHash);
  try {
    const facts = await readSessionFacts(readState);
    if (facts === undefined || facts.start.projectHash !== projectHash)
      throw new Error('Missing fixture session or mismatched project');
    const history: IContent[] = [];
    const root = rowTreeRootOf(reader.trailer);
    if (root !== undefined)
      for await (const entry of iterateRowEntries(reader, root))
        history.push(decodeStoredRow(await readStoredRow(reader, entry)));
    const fork = await readState(SESSION_KEYS.fork);
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
      commitSeq: reader.trailer?.commitSeq ?? 0,
    };
  } finally {
    await reader.close();
  }
}
