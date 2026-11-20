/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { RecordAccess } from './recordAccess.js';
import { RECORD_KIND } from './recordKinds.js';
import {
  decodeTrailerHeader,
  TRAILER_HEADER_BYTES,
  TRAILER_RECORD_BYTES,
} from './trailerRecord.js';
import { versionOf, type Version } from './version.js';

/**
 * The version a trailer at `offset` carries, read with one `pread`. The
 * trailer was reached from a committed one, so a bad frame is corruption and
 * the access says so; a record that is not a trailer at this offset is a
 * broken link and is refused.
 */
export async function readVersionAt(
  access: RecordAccess,
  offset: number,
): Promise<Version> {
  const head = await access.readRecordHead(
    offset,
    'TRAILER',
    TRAILER_RECORD_BYTES,
  );
  if (
    head.kind !== RECORD_KIND.TRAILER ||
    head.headerLen !== TRAILER_HEADER_BYTES ||
    head.bodyLen !== 0
  ) {
    throw new JournalFormatError(
      `Record at offset ${offset} is not a trailer (kind ${head.kind})`,
    );
  }
  const trailer = decodeTrailerHeader(head.kindHeader);
  if (trailer.selfOffset !== offset) {
    throw new JournalFormatError(
      `Trailer at offset ${offset} says it is at ${trailer.selfOffset}`,
    );
  }
  return versionOf(trailer);
}
