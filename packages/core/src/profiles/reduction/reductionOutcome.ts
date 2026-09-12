/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProfileDocument } from '../contracts/profileDocument.js';
import type { PendingConfirmation } from '../contracts/profileCommands.js';
import type {
  CapturedStandardSource,
  WorkingProfileIdentity,
} from '../contracts/profileState.js';

/**
 * Result of a pure literal reduction step.
 *
 * A `candidate` carries the proposed document plus the identity, active member, and
 * revision range the candidate would commit at. `no-op` and `invalid` carry the
 * current revision so callers can map fully to ProfileCommandResult without extra
 * state. `confirmation-required` pauses a destructive command behind a typed
 * confirmation token. `stale` reports an expected/current revision mismatch.
 * `discard-authorized` signals that a previously-confirmed unsaved draft may be
 * overwritten.
 */
export type ProfileReductionOutcome =
  | {
      kind: 'candidate';
      document: ProfileDocument;
      identity: WorkingProfileIdentity;
      activeMember?: CapturedStandardSource;
      baseRevision: number;
      nextRevision: number;
    }
  | {
      kind: 'save';
      name: string;
      document: ProfileDocument;
      revision: number;
    }
  | { kind: 'no-op'; reason: string; revision: number }
  | { kind: 'invalid'; errors: string[]; revision: number }
  | { kind: 'unverified'; constraints: string[]; revision: number }
  | {
      kind: 'confirmation-required';
      pending: PendingConfirmation;
      revision: number;
    }
  | { kind: 'stale'; expectedRevision: number; currentRevision: number }
  | { kind: 'discard-authorized'; revision: number };

/**
 * Convert a saved identity to a draft derived from it.
 *
 * A saved `{ name, source }` identity becomes `{ kind: 'draft', derivedFrom: { name,
 * source } }`, recording that the workspace was detached from its source file. An
 * already-draft identity is returned unchanged with the same derivedFrom, so the
 * conversion is idempotent and never overwrites an existing derivation chain.
 */
export function toDraftIdentity(
  identity: WorkingProfileIdentity,
): WorkingProfileIdentity {
  if (identity.kind === 'draft') {
    return identity;
  }
  return {
    kind: 'draft',
    derivedFrom: { name: identity.name, source: identity.source },
  };
}
