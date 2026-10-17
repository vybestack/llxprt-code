/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { SESSION_FILE_ID_PREFIX_LENGTH } from './SessionRecordingService.js';

/** The extension of a journal session file (design 2.1). S09 replaces the `.jsonl` matchers with it. */
export const SESSION_FILE_EXTENSION = '.llxj';

/** The extension of the retired JSONL session files. Discovery lists them as unreadable and nothing else reads them. */
export const RETIRED_SESSION_EXTENSION = '.jsonl';

/** `session-<timestamp>-<instance>-<id prefix>.llxj`, unique per recorder instance. */
export function journalSessionFileName(
  sessionId: string,
  now: Date = new Date(),
  instanceId: string = crypto.randomUUID(),
): string {
  const timestamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
  const prefix = sessionId.substring(0, SESSION_FILE_ID_PREFIX_LENGTH);
  return `session-${timestamp}-${instanceId}-${prefix}${SESSION_FILE_EXTENSION}`;
}
