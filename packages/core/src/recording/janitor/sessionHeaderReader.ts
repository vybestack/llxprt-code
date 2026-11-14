/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readJournalFileFacts } from '../journalSessionListing.js';
import { SESSION_FILE_EXTENSION } from '../sessionFileExtension.js';
import { isValidSafeSessionId } from './sessionSafety.js';

export interface SessionHeaderInfo {
  readonly sessionId: string;
  readonly startTime: string;
  readonly projectHash?: string;
}

export async function readSessionHeaderInfo(
  filePath: string,
): Promise<SessionHeaderInfo | null> {
  if (!filePath.endsWith(SESSION_FILE_EXTENSION)) return null;
  let found;
  try {
    found = await readJournalFileFacts(filePath);
  } catch {
    return null;
  }
  if (found === undefined) return null;
  const { sessionId, start } = found.facts;
  if (!isValidSafeSessionId(sessionId)) return null;
  return {
    sessionId,
    startTime: start.startTime,
    projectHash: start.projectHash,
  };
}
