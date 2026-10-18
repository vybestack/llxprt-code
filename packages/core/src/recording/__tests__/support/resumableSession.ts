/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '../../../services/history/IContent.js';
import { selectBackend } from '../../../services/history/historyBackendSelect.js';
import {
  buildContents,
  createRecordedSession,
  PROJECT_HASH,
  type RecordedSession,
} from './p05dTestKit.js';
import { recordJournal } from './recordedJournals.js';

type Env = Readonly<Record<string, string | undefined>>;

/** When the journal fixture's rows were "written"; the JSONL fixture has no stamp. */
export const JOURNAL_FIXTURE_RECORDED_AT = Date.parse('2026-09-20T10:00:00Z');

/**
 * Journal rows carry their chronology from the time the history wrote them
 * (nothing is stamped at resume), so the fixture writes it as the history does.
 */
function stampedLikeHistory(contents: readonly IContent[]): IContent[] {
  let userTurn = 0;
  let step = 0;
  return contents.map((content, index) => {
    if (content.speaker === 'human') {
      userTurn += 1;
      step = 1;
    } else {
      step += 1;
    }
    return {
      ...content,
      metadata: {
        ...content.metadata,
        chronology: {
          seq: index + 1,
          userTurn,
          step,
          recordedAt: JOURNAL_FIXTURE_RECORDED_AT,
        },
      },
    };
  });
}

/**
 * Records a session the way the selected backend's recorder does, for tests of
 * the resume front door that do not look at the file layout. The rows are the
 * alternating `row-<n>` texts of `createRecordedSession`.
 */
export async function createResumableSession(
  chatsDir: string,
  spec: { rows?: number } = {},
  env: Env = process.env,
): Promise<RecordedSession> {
  if (selectBackend(env) === 'old')
    return createRecordedSession(chatsDir, spec);
  const sessionId = crypto.randomUUID();
  const contents = stampedLikeHistory(buildContents(spec.rows ?? 2));
  const recorded = await recordJournal(chatsDir, sessionId, {
    rows: contents,
    projectHash: PROJECT_HASH,
  });
  return { ...recorded, contents, checkpoints: [] };
}
