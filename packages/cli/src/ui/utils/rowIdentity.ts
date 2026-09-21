/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260917-ISSUE854.P02b
 * @requirement G5
 *
 * Scrollback row identity (issue-854-design.md §2). A row's identity is the
 * journal envelope byte offset it was projected from plus a projection
 * discriminator (one envelope can project a text row and a tool-group row).
 * Records without a journal offset fall back to (legacy local index,
 * discriminator) so legacy sessions still get stable keys. chronologySeq is
 * ordering/display data, never identity: replay display ids restart at −1 per
 * converter invocation and groups carry seqSpan, not a point seq.
 *
 * Live rows start with a pending identity (prefixed `pending:`) that is stable
 * for the row's whole streaming life and can never collide with a committed
 * slot; at the print/commit boundary it resolves once to the committed
 * identity via {@link resolvePendingRowIdentity}.
 *
 * Identities are memory-only (ruling 2): plain JSON data, never persisted.
 */

export type RowDiscriminator = 'text' | 'toolGroup' | 'summaryRow';

/** Identity for a row projected from a journal envelope at a byte offset. */
export interface JournalRowIdentity {
  readonly kind: 'journal';
  readonly offset: number;
  readonly discriminator: RowDiscriminator;
}

/**
 * Identity for a row projected from a record with no journal offset (legacy
 * sessions, in-memory history). `index` is the record's position in the
 * converted batch, stable for prefix-stable arrays.
 */
export interface LegacyRowIdentity {
  readonly kind: 'legacy';
  readonly index: number;
  readonly discriminator: RowDiscriminator;
}

/**
 * Identity for a live/pending row of the current turn. Stable across
 * streaming updates; never equal to a committed identity.
 */
export interface PendingRowIdentity {
  readonly kind: 'pending';
  readonly pendingKey: string;
}

export type RowIdentity =
  | JournalRowIdentity
  | LegacyRowIdentity
  | PendingRowIdentity;

/** Where a projected row came from: a journal offset or a legacy batch index. */
export type RowSource =
  | { readonly kind: 'journal'; readonly offset: number }
  | { readonly kind: 'legacy'; readonly index: number };

const DISCRIMINATOR_PREFIX: Readonly<Record<RowDiscriminator, string>> = {
  text: 'text',
  toolGroup: 'toolGroup',
  summaryRow: 'summaryRow',
};

export function rowIdentity(
  source: RowSource,
  discriminator: RowDiscriminator,
): RowIdentity {
  if (source.kind === 'journal') {
    return {
      kind: 'journal',
      offset: source.offset,
      discriminator,
    };
  }
  return { kind: 'legacy', index: source.index, discriminator };
}

export function pendingRowIdentity(pendingKey: string): PendingRowIdentity {
  return { kind: 'pending', pendingKey };
}

/**
 * Canonical string form for React keys, Map keys, and equality checks. The
 * kind prefixes and the discriminator set are disjoint, so the encoding is
 * collision-free by construction.
 */
export function rowIdentityKey(identity: RowIdentity): string {
  switch (identity.kind) {
    case 'journal':
      return `journal:${identity.offset}:${DISCRIMINATOR_PREFIX[identity.discriminator]}`;
    case 'legacy':
      return `legacy:${identity.index}:${DISCRIMINATOR_PREFIX[identity.discriminator]}`;
    case 'pending':
      return `pending:${identity.pendingKey}`;
    default:
      throw new Error('Unknown row identity kind');
  }
}

export function sameRowIdentity(a: RowIdentity, b: RowIdentity): boolean {
  return rowIdentityKey(a) === rowIdentityKey(b);
}

export interface RowIdentityResolution {
  /** The pending identity's key, for replacing the pending slot. */
  readonly pendingKey: string;
  /** The committed identity the pending row became. */
  readonly committed: RowIdentity;
}

/**
 * Correlates a pending row with the committed identity it became at the
 * print/commit boundary. Returns undefined unless the first argument is
 * actually a pending identity, so a committed row can never be re-committed
 * under a different slot.
 */
export function resolvePendingRowIdentity(
  pending: RowIdentity,
  committed: RowIdentity,
): RowIdentityResolution | undefined {
  if (pending.kind !== 'pending') {
    return undefined;
  }
  return { pendingKey: pending.pendingKey, committed };
}
