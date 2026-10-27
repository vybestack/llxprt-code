/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IdNodeCache } from './idTrieCache.js';

interface LookupCache {
  readonly root: number;
  readonly values: Map<string, Uint8Array | undefined>;
}
const caches = new WeakMap<object, LookupCache>();

/** A small versioned memo of metadata, including absent feature flags. */
export function mapLookups(cache: IdNodeCache, root: number): LookupCache {
  const identity = cache.lookupCacheIdentity ?? cache;
  const current = caches.get(identity);
  if (current?.root === root) return current;
  const created = { root, values: new Map<string, Uint8Array | undefined>() };
  caches.set(identity, created);
  return created;
}

export function rememberMapLookup(
  cache: LookupCache,
  key: string,
  value: Uint8Array | undefined,
): void {
  if (
    (cache.values.has(key) || cache.values.size < 32) &&
    (value === undefined || value.length <= 256)
  )
    cache.values.set(key, value?.slice());
  else cache.values.delete(key);
}

export function advanceMapLookups(
  cache: IdNodeCache,
  previousRoot: number,
  root: number,
  changes: Iterable<{ readonly key: Uint8Array; readonly value: Uint8Array }>,
): void {
  const previous = mapLookups(cache, previousRoot);
  const next = mapLookups(cache, root);
  for (const [key, value] of previous.values)
    rememberMapLookup(next, key, value);
  for (const { key, value } of changes)
    rememberMapLookup(next, new TextDecoder().decode(key), value);
}
