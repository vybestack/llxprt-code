/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { MIRROR_KEY_PREFIX } from './checkpointDescriptor.js';
import { JournalFormatError } from './errors.js';
import type { VersionEdit } from './groupEdits.js';
import type { Version } from './version.js';

/** The state map key that says which version of the primary a mirror holds (design 5.2). */
export const MIRROR_PRIMARY_KEY = `${MIRROR_KEY_PREFIX}primary`;

/**
 * The identity of a primary version: its `commitSeq` and its random
 * `groupTag`. The sequence alone proves nothing, because a primary that loses
 * its newest group hands the same sequence to the next one (design 5.2).
 */
export interface PrimaryIdentity {
  readonly commitSeq: number;
  readonly groupTag: bigint;
}

/** The identity of the primary before its first group. */
export const GENESIS_IDENTITY: PrimaryIdentity = { commitSeq: 0, groupTag: 0n };

const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder();
const IDENTITY_TEXT = /^(\d+):([0-9a-f]+)$/;

export function identityOf(version: Version | undefined): PrimaryIdentity {
  if (version === undefined) return GENESIS_IDENTITY;
  return { commitSeq: version.commitSeq, groupTag: version.groupTag };
}

export function sameIdentity(
  left: PrimaryIdentity,
  right: PrimaryIdentity,
): boolean {
  return left.commitSeq === right.commitSeq && left.groupTag === right.groupTag;
}

export function encodeIdentity(identity: PrimaryIdentity): Uint8Array {
  return UTF8.encode(`${identity.commitSeq}:${identity.groupTag.toString(16)}`);
}

export function parseIdentity(bytes: Uint8Array): PrimaryIdentity {
  const text = UTF8_DECODER.decode(bytes);
  const match = IDENTITY_TEXT.exec(text);
  if (match === null) {
    throw new JournalFormatError(
      `${MIRROR_PRIMARY_KEY} is ${JSON.stringify(text)}, not a commit sequence and a group tag`,
    );
  }
  return { commitSeq: Number(match[1]), groupTag: BigInt(`0x${match[2]}`) };
}

/** The edit that records, in the mirror's own group, the primary version that group applied. */
export function identityEdit(identity: PrimaryIdentity): VersionEdit {
  return {
    kind: 'setState',
    key: MIRROR_PRIMARY_KEY,
    value: encodeIdentity(identity),
  };
}
