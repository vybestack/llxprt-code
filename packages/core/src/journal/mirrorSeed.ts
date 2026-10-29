/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Aggregate } from './aggregate.js';
import type { SourceRow } from './groupEdits.js';
import { accepts, ownerBloomBit, UNOWNED } from './ownerRules.js';
import type { RecordAccess } from './recordAccess.js';
import { iterateMatchingEntries } from './rowTreeReader.js';
import { rootRef } from './groupSegments.js';
import type { Version } from './version.js';

/**
 * The rows of `version` that the mirror of `owner` holds, in label order
 * (design 5.3). A subtree whose owner bloom has neither the owner nor the
 * unowned bit is skipped without being read. Each row is accepted by the
 * owner in its entry, which is the current one, and not by the owner in its
 * `ROW` header, which is the owner at write time: a row that changed hands
 * after it was written goes to its current owner (defect #4). The scan holds
 * the nodes from the root to one leaf.
 */
export async function* acceptedRows(
  access: RecordAccess,
  version: Version,
  owner: number,
): AsyncGenerator<SourceRow> {
  const root = rootRef(version);
  if (root === undefined) return;
  const wanted = ownerBloomBit(UNOWNED) | ownerBloomBit(owner);
  const mightMatch = (aggregate: Aggregate): boolean =>
    (aggregate.ownerBloom & wanted) !== 0n;
  for await (const entry of iterateMatchingEntries(
    access,
    root,
    version.aggregate,
    mightMatch,
  )) {
    if (accepts(owner, entry.owner)) yield { source: access, entry };
  }
}
