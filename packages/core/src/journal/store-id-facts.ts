/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { PinnedRead } from './pinLease.js';
import type { IdFactDeps } from './idFactQueries.js';
import type { IdNodeCache } from './idTrieCache.js';
import { IdTrieReader } from './idTrieReader.js';
import { PinnedIdFacts } from './pinnedIdFacts.js';

export function openStoreIdFacts(
  read: PinnedRead,
  cache: IdNodeCache,
  deps: IdFactDeps,
): PinnedIdFacts {
  const root = read.version?.roots.idRoot ?? 0;
  const reader =
    read.version === undefined
      ? undefined
      : new IdTrieReader(read.access, cache);
  return new PinnedIdFacts(
    {
      get: async (hash) => {
        read.requireOpen();
        return reader === undefined ? undefined : reader.lookup(root, hash);
      },
    },
    deps,
    read,
  );
}
