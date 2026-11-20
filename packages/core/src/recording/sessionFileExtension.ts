/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/** The extension of a journal session file (design 2.1). */
export const SESSION_FILE_EXTENSION = '.llxj';

/** The extension of the retired JSONL session files. Discovery lists them as unreadable and nothing else reads them. */
export const RETIRED_SESSION_EXTENSION = '.jsonl';

/** Suffix a janitor archive adds to the name of the session file it compresses. */
export const ARCHIVE_COMPRESSION_SUFFIX = '.gz';

/** True for a journal file or its janitor archive, whatever the backend. */
export function isJournalFileName(fileName: string): boolean {
  return (
    fileName.endsWith(SESSION_FILE_EXTENSION) ||
    fileName.endsWith(SESSION_FILE_EXTENSION + ARCHIVE_COMPRESSION_SUFFIX)
  );
}
