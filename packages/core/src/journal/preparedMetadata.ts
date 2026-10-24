/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { bytesEqual } from './bytes.js';
import type { RecordAppender } from './groupAppender.js';
import type { BuildContext, BuiltGroup } from './groupBuild.js';
import { KeyedMapBatch, KeyedMapReader, type MapKind } from './keyedMap.js';
import { BoundedIdNodeCache } from './idTrieCache.js';
import { IdTrieReader } from './idTrieReader.js';
import { mergeIdTrie } from './idTrieMerge.js';
import type { RecordAccess } from './recordAccess.js';
import type { IdEntry } from './idTrieNode.js';

async function* excludingKey(
  trie: IdTrieReader,
  root: number,
  hash: Uint8Array,
): AsyncGenerator<IdEntry> {
  for await (const entry of trie.entries(root))
    if (!bytesEqual(entry.hash, hash)) yield entry;
}

export async function retainMapValue(
  ctx: BuildContext,
  appender: RecordAppender,
  built: BuiltGroup,
  kind: MapKind,
  key: string,
  value: Uint8Array,
  storage?: 'body',
): Promise<BuiltGroup> {
  await appender.drain();
  const rootKey = kind === 'meta' ? 'metaRoot' : 'stateRoot';
  const reader = new KeyedMapReader(
    ctx.readGroup(appender.nextOffset),
    kind === 'meta' ? ctx.metaCache : ctx.stateCache,
    kind,
    ctx.hasher,
  );
  const batch = new KeyedMapBatch(reader, built.state[rootKey]);
  if (storage === 'body') batch.setBody(key, value);
  else batch.set(key, value);
  return {
    ...built,
    state: { ...built.state, [rootKey]: await batch.commit(appender) },
  };
}

export async function copyPreparedMetadata(
  ctx: BuildContext,
  appender: RecordAppender,
  built: BuiltGroup,
  source: RecordAccess,
  root: number,
  keys: readonly string[],
): Promise<BuiltGroup> {
  const sourceReader = new KeyedMapReader(
    source,
    new BoundedIdNodeCache(0),
    'meta',
    ctx.hasher,
  );
  let current = built;
  for (const key of keys) {
    const value = await sourceReader.get(root, key);
    if (value !== undefined) {
      current = await retainMapValue(
        ctx,
        appender,
        current,
        'meta',
        key,
        value,
      );
      continue;
    }
    await appender.drain();
    const access = ctx.readGroup(appender.nextOffset);
    const reader = new KeyedMapReader(
      access,
      ctx.metaCache,
      'meta',
      ctx.hasher,
    );
    if ((await reader.get(current.state.metaRoot, key)) !== undefined) {
      const hash = reader.hashOf(key);
      const trie = new IdTrieReader(access, ctx.metaCache);
      const oldRoot = current.state.metaRoot;
      const metaRoot = await mergeIdTrie(
        appender,
        undefined,
        0,
        excludingKey(trie, oldRoot, hash),
      );
      current = { ...current, state: { ...current.state, metaRoot } };
    }
  }
  return current;
}
