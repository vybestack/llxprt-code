/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { viewOf } from './bytes.js';
import { JournalFormatError, RetiredJournalError } from './errors.js';
import {
  JOURNAL_FORMAT_VERSION,
  JOURNAL_HEADER_BYTES,
  JOURNAL_MAGIC,
  decodeJournalHeader,
  type JournalHeader,
} from './fileHeader.js';
import type { PositionalReader } from './positionalFile.js';

const VERSION_END = 12;

/** The one message for every file that is not a current journal (design 2.1). */
export function retiredJournalMessage(path: string): string {
  return `Session file ${path} was recorded in the retired JSONL journal format (versions 1 and 2) and cannot be resumed. Start a new session.`;
}

function hasCurrentMagic(head: Uint8Array): boolean {
  return (
    head.length >= JOURNAL_MAGIC.length &&
    JOURNAL_MAGIC.every((byte, index) => head[index] === byte)
  );
}

/**
 * Decides on the first bytes of a file whether it is a journal this code can
 * read. A JSONL file starts with `{`, which is not the magic, so it falls under
 * the same test as any other file with a different magic. The magic and the
 * version are judged before the header CRC, so a retired file is never
 * reported as a damaged current one.
 */
export function parseJournalHeaderOrRefuse(
  path: string,
  head: Uint8Array,
): JournalHeader {
  if (!hasCurrentMagic(head)) {
    throw new RetiredJournalError(path, retiredJournalMessage(path));
  }
  if (head.length < VERSION_END) {
    throw new JournalFormatError(
      `Session file ${path} ends inside its header (${head.length} bytes)`,
    );
  }
  if (
    viewOf(head).getUint32(JOURNAL_MAGIC.length, true) !==
    JOURNAL_FORMAT_VERSION
  ) {
    throw new RetiredJournalError(path, retiredJournalMessage(path));
  }
  return decodeJournalHeader(head);
}

/** Reads the first bytes of the file, and nothing else, before deciding. */
export async function readJournalHeaderOrRefuse(
  path: string,
  reader: PositionalReader,
  fileSize: number,
): Promise<JournalHeader> {
  const head = await reader.readAt(0, Math.min(JOURNAL_HEADER_BYTES, fileSize));
  return parseJournalHeaderOrRefuse(path, head);
}
