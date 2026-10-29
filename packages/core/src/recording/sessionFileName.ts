/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { SESSION_FILE_EXTENSION } from './sessionFileExtension.js';

export const SESSION_FILE_ID_PREFIX_LENGTH = 12;

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
