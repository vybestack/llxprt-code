/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { getU64, getU64Big, putU64, putU64Big, viewOf } from './bytes.js';
import { JournalFormatError } from './errors.js';

export const TRANSCRIPT_HEAD_KEY = 'transcript:head';
export interface TranscriptHead {
  readonly root: number;
  readonly count: number;
  readonly nextId: bigint;
  readonly openRoot: number;
  readonly reachableBytes: number;
}
export const EMPTY_TRANSCRIPT_HEAD: TranscriptHead = {
  root: 0,
  count: 0,
  nextId: 1n,
  openRoot: 0,
  reachableBytes: 0,
};
export function encodeTranscriptHead(head: TranscriptHead): Uint8Array {
  const bytes = new Uint8Array(40);
  const view = viewOf(bytes);
  putU64(view, 0, 'root', head.root);
  putU64(view, 8, 'count', head.count);
  putU64Big(view, 16, 'nextId', head.nextId);
  putU64(view, 24, 'openRoot', head.openRoot);
  putU64(view, 32, 'reachableBytes', head.reachableBytes);
  return bytes;
}
export function decodeTranscriptHead(
  bytes: Uint8Array | undefined,
): TranscriptHead {
  if (bytes === undefined) return EMPTY_TRANSCRIPT_HEAD;
  if (bytes.length !== 40)
    throw new JournalFormatError('Invalid transcript head');
  const view = viewOf(bytes);
  return {
    root: getU64(view, 0, 'root'),
    count: getU64(view, 8, 'count'),
    nextId: getU64Big(view, 16),
    openRoot: getU64(view, 24, 'openRoot'),
    reachableBytes: getU64(view, 32, 'reachableBytes'),
  };
}
export function transcriptRowKey(ref: number): string {
  return `transcript:row:${ref}`;
}
export function encodeTranscriptId(id: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  putU64Big(viewOf(bytes), 0, 'transcriptId', id);
  return bytes;
}
export function decodeTranscriptId(bytes: Uint8Array | undefined): bigint {
  if (bytes === undefined)
    throw new JournalFormatError('Context row has no transcript identity');
  if (bytes.length !== 8)
    throw new JournalFormatError('Invalid transcript identity');
  return getU64Big(viewOf(bytes), 0);
}
export interface TranscriptMembership {
  readonly count: number;
  readonly label: bigint;
  readonly rowRef: number;
  readonly occurrencesRoot: number;
}
export function encodeMembership(member: TranscriptMembership): Uint8Array {
  const bytes = new Uint8Array(32);
  const view = viewOf(bytes);
  putU64(view, 0, 'count', member.count);
  putU64Big(view, 8, 'label', member.label);
  putU64(view, 16, 'rowRef', member.rowRef);
  putU64(view, 24, 'occurrencesRoot', member.occurrencesRoot);
  return bytes;
}
export function decodeMembership(
  bytes: Uint8Array | undefined,
): TranscriptMembership {
  if (bytes === undefined)
    return { count: 0, label: 0n, rowRef: 0, occurrencesRoot: 0 };
  if (bytes.length !== 32)
    throw new JournalFormatError('Invalid context membership');
  const view = viewOf(bytes);
  return {
    count: getU64(view, 0, 'count'),
    label: getU64Big(view, 8),
    rowRef: getU64(view, 16, 'rowRef'),
    occurrencesRoot: getU64(view, 24, 'occurrencesRoot'),
  };
}
