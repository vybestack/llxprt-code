/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ProfileDocument,
  StandardProfileDocument,
} from './profileDocument.js';

/**
 * Fingerprint identifying the file a saved profile was loaded from.
 *
 * A stat fingerprint compares mtime and size; a hash fingerprint compares a content
 * digest. The kind is part of the identity so a fingerprint changes kind when the
 * strategy does.
 */
export type SourceFingerprint =
  | { kind: 'stat'; mtimeMs: number; size: number }
  | { kind: 'hash'; hash: string };

/**
 * Identity of the profile being worked on: a saved profile tied to a source file,
 * or an in-memory draft derived from one.
 */
export type WorkingProfileIdentity =
  | { kind: 'saved'; name: string; source: SourceFingerprint }
  | {
      kind: 'draft';
      derivedFrom?: { name: string; source: SourceFingerprint };
    };

/**
 * Snapshot of the standard profile document a load balancer member resolves to.
 */
export interface CapturedStandardSource {
  revision: number;
  provider: string;
  sourceDocument: StandardProfileDocument;
  models: readonly string[];
}

/**
 * State of the active profile workspace.
 */
export type ProfileState =
  | { status: 'unconfigured' }
  | {
      status: 'configured';
      revision: number;
      identity: WorkingProfileIdentity;
      document: ProfileDocument;
      activeMember?: CapturedStandardSource;
    };

/**
 * Equality for source fingerprints: only true when both have the same kind and equal
 * values. Stat fingerprints compare mtimeMs and size, hash fingerprints compare hash.
 */
export function fingerprintsMatch(
  a: SourceFingerprint,
  b: SourceFingerprint,
): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === 'stat') {
    return b.kind === 'stat' && a.mtimeMs === b.mtimeMs && a.size === b.size;
  }
  return b.kind === 'hash' && a.hash === b.hash;
}
