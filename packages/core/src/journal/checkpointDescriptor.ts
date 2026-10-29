/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';

/** State map keys of checkpoint descriptors are `ckpt:<id>` (design 4.9). */
export const CHECKPOINT_KEY_PREFIX = 'ckpt:';
/** `mirror:primary` and the like: how a mirror file relates to its primary (design 5.2). */
export const MIRROR_KEY_PREFIX = 'mirror:';
/** The deferred blob release queue (design 10.1). */
export const RELEASE_KEY_PREFIX = 'rel:';

/** The value of a `ckpt:<id>` state entry: the version a checkpoint names and what it costs to keep. */
export interface CheckpointDescriptor {
  readonly name: string;
  /** Offset of the trailer that carries the saved version. */
  readonly trailerOffset: number;
  readonly commitSeq: number;
  readonly createdAtMs: number;
  /** Estimated live bytes of the saved version; `ckptBytes` sums them. */
  readonly liveBytes: number;
}

const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

export function checkpointKey(id: string): string {
  return `${CHECKPOINT_KEY_PREFIX}${id}`;
}

export function isCheckpointKey(key: string): boolean {
  return key.startsWith(CHECKPOINT_KEY_PREFIX);
}

export function encodeCheckpointDescriptor(
  descriptor: CheckpointDescriptor,
): Uint8Array {
  return UTF8.encode(
    JSON.stringify({
      name: descriptor.name,
      trailerOffset: descriptor.trailerOffset,
      commitSeq: descriptor.commitSeq,
      createdAtMs: descriptor.createdAtMs,
      liveBytes: descriptor.liveBytes,
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNumber(source: Record<string, unknown>, name: string): number {
  const value = source[name];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new JournalFormatError(
      `Checkpoint descriptor field ${name} is not a non-negative integer`,
    );
  }
  return value;
}

/**
 * What a deleted checkpoint's entry holds until a compaction drops it (design
 * 4.9 and 4.11 step 4): the state map has no removal, so a delete overwrites
 * the descriptor, and every reader treats this value as "no checkpoint".
 */
export const CHECKPOINT_TOMBSTONE: Uint8Array = UTF8.encode(
  JSON.stringify({ deleted: true }),
);

export function isCheckpointTombstone(bytes: Uint8Array): boolean {
  return (
    bytes.length === CHECKPOINT_TOMBSTONE.length &&
    bytes.every((byte, at) => byte === CHECKPOINT_TOMBSTONE[at])
  );
}

/** The descriptor a `ckpt:` entry holds, or undefined for a deleted checkpoint. */
export function parseCheckpointEntry(
  bytes: Uint8Array,
): CheckpointDescriptor | undefined {
  return isCheckpointTombstone(bytes)
    ? undefined
    : parseCheckpointDescriptor(bytes);
}

export function parseCheckpointDescriptor(
  bytes: Uint8Array,
): CheckpointDescriptor {
  const source: unknown = JSON.parse(UTF8_DECODER.decode(bytes));
  if (!isRecord(source)) {
    throw new JournalFormatError('A checkpoint descriptor is a JSON object');
  }
  const name = source['name'];
  if (typeof name !== 'string') {
    throw new JournalFormatError('Checkpoint descriptor field name is missing');
  }
  return {
    name,
    trailerOffset: requireNumber(source, 'trailerOffset'),
    commitSeq: requireNumber(source, 'commitSeq'),
    createdAtMs: requireNumber(source, 'createdAtMs'),
    liveBytes: requireNumber(source, 'liveBytes'),
  };
}
