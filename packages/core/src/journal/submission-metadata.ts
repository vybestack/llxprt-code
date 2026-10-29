/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { BoundedIdNodeCache } from './idTrieCache.js';
import { readMapEntries } from './mapEntries.js';
import type { PreparedGroup } from './preparedGroup.js';
import type { RecordAccess } from './recordAccess.js';

/** Only seed/resync walks the receipts; ordinary mirror groups name their changed keys. */
export async function copySubmissionMetadata(
  group: PreparedGroup,
  source: RecordAccess,
  root: number,
): Promise<void> {
  for await (const entry of readMapEntries(
    source,
    new BoundedIdNodeCache(),
    root,
  )) {
    if (entry.key.startsWith('submission:'))
      await group.copyMetadata(source, root, [entry.key]);
  }
}
