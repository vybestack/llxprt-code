/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import { FRAME_FLAG_BODY, frameLength, type FrameHead } from './frame.js';
import type { GroupRecord, RecordAppender } from './groupAppender.js';
import type { OffsetField, PointsAt } from './offsetFields.js';
import type { RecordAccess } from './recordAccess.js';
import { RECORD_KIND } from './recordKinds.js';
import { ROW_START_PREFETCH_BYTES } from './rowReads.js';

/** What a copy wrote, by record kind, and the bytes of those records. */
export interface CopyStats {
  readonly copied: Record<PointsAt, number>;
  /** Records found in the relocation index and not copied again. */
  memoHits: number;
  /** Bytes appended to the new file for versions, relocation entries excluded. */
  bytes: number;
}

export function emptyCopyStats(): CopyStats {
  return {
    copied: {
      TNODE: 0,
      ROW: 0,
      RTNODE: 0,
      ITNODE: 0,
      LENS: 0,
      VALUE: 0,
      TRAILER: 0,
    },
    memoHits: 0,
    bytes: 0,
  };
}

/** The record kinds that are copied whole, byte for byte, and the kind each is checked to be. */
const WHOLE_RECORD_KIND = {
  ROW: RECORD_KIND.ROW,
  LENS: RECORD_KIND.LENS,
  VALUE: RECORD_KIND.VALUE,
} as const;
type WholeRecord = keyof typeof WHOLE_RECORD_KIND;

export function isWholeRecord(points: PointsAt): points is WholeRecord {
  return points in WHOLE_RECORD_KIND;
}

/**
 * Applies the rule of an offset field to the offset found in a source record.
 * `copy` finds the new offset by the means the rule names: a copy of the node
 * or the record, the copy of the last row, or the new trailer of a retained
 * version. An offset of 0
 * is "none" where the table says so and corruption where it does not.
 */
export async function remapOffset(
  spec: OffsetField,
  oldOffset: number,
  copy: (oldOffset: number) => Promise<number>,
): Promise<number> {
  if (oldOffset === 0) {
    if (spec.optional) return 0;
    throw new JournalFormatError(
      `${spec.record}.${spec.field} is 0, and the table says it is never empty`,
    );
  }
  if (spec.rule === 'zero') return 0;
  if (spec.rule === 'ownTrailer' || spec.rule === 'scratch') {
    throw new JournalFormatError(
      `${spec.record}.${spec.field} has rule ${spec.rule}, which no copy reads from a source record`,
    );
  }
  return copy(oldOffset);
}

function prefetchFor(points: WholeRecord): number {
  return points === 'ROW' ? ROW_START_PREFETCH_BYTES : 1024;
}

/**
 * Appends a record of the source to the group byte for byte: the same kind,
 * kind header and body. A body streams from the source to the group a chunk at
 * a time and its CRC is checked as it passes. Returns the new offset and the
 * bytes the record takes.
 */
export async function appendSourceRecord(
  source: RecordAccess,
  appender: RecordAppender,
  head: FrameHead,
  points: WholeRecord,
): Promise<{ offset: number; bytes: number }> {
  if (head.kind !== WHOLE_RECORD_KIND[points]) {
    throw new JournalFormatError(
      `Record at offset ${head.offset} is not a ${points} (kind ${head.kind})`,
    );
  }
  const record: GroupRecord =
    (head.frameFlags & FRAME_FLAG_BODY) === 0
      ? { kind: head.kind, kindHeader: head.kindHeader }
      : {
          kind: head.kind,
          kindHeader: head.kindHeader,
          body: {
            length: head.bodyLen,
            chunks: source.readRecordBody(head, undefined, points),
          },
        };
  const offset = await appender.append(record);
  return { offset, bytes: frameLength(head.headerLen, head.bodyLen) };
}

/** Reads the head of the record a source field points at. */
export function readSourceHead(
  source: RecordAccess,
  offset: number,
  points: WholeRecord,
): Promise<FrameHead> {
  return source.readRecordHead(offset, points, prefetchFor(points));
}
