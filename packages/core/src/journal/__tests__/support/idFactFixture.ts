/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { IdFactBatch, bulkBuildFacts } from '../../idFactBatch.js';
import type { IdOccurrence } from '../../idFactUpdate.js';
import { ID_NS, sha256KeyHash, type IdKeyHasher } from '../../idKeys.js';
import { BoundedIdNodeCache, type IdNodeCache } from '../../idTrieCache.js';
import type { IdEntry } from '../../idTrieNode.js';
import {
  IdFactQueries,
  type IdEntryView,
  type IdFactDeps,
} from '../../idFactQueries.js';
import {
  normalizeToAnthropicToolId,
  normalizeToOpenAIToolId,
} from '@vybestack/llxprt-code-tools';
import { IdTrieFixture, type GroupStats } from './idTrieHarness.js';

/** The real normalizers of the tools package, passed in because the journal does not import them. */
export const REAL_NORMALIZERS = {
  openai: normalizeToOpenAIToolId,
  anthropic: normalizeToAnthropicToolId,
};

export function realDeps(hasher: IdKeyHasher = sha256KeyHash): IdFactDeps {
  return { hasher, normalizers: REAL_NORMALIZERS };
}

export function normalizeFor(
  family: typeof ID_NS.openai | typeof ID_NS.anthropic,
  rawId: string,
): string {
  return family === ID_NS.openai
    ? REAL_NORMALIZERS.openai(rawId)
    : REAL_NORMALIZERS.anthropic(rawId);
}

/** A trie of facts in a journal file, advanced one group at a time. */
export class FactFixture {
  exceptionCount = 0;

  private constructor(
    readonly trie: IdTrieFixture,
    readonly deps: IdFactDeps,
    readonly cache: IdNodeCache,
  ) {}

  static async create(
    file: string,
    deps: IdFactDeps = realDeps(),
    cache: IdNodeCache = new BoundedIdNodeCache(),
  ): Promise<FactFixture> {
    return new FactFixture(await IdTrieFixture.create(file), deps, cache);
  }

  get root(): number {
    return this.trie.root;
  }

  /** Applies the occurrences as one commit group. */
  append(
    occurrences: Iterable<IdOccurrence>,
    extra?: (batch: IdFactBatch) => Promise<void>,
  ): Promise<GroupStats> {
    return this.trie.commit(async (appender) => {
      const batch = new IdFactBatch(
        this.trie.root === 0 ? undefined : this.trie.reader(this.cache),
        this.trie.root,
        this.deps,
        this.exceptionCount,
      );
      for (const occ of occurrences) await batch.apply(occ);
      if (extra !== undefined) await extra(batch);
      const result = await batch.commit(appender);
      this.exceptionCount = result.exceptionCount;
      return result.root;
    });
  }

  /** The whole history as one rebuild group from nothing. */
  bulk(occurrences: Iterable<IdOccurrence>): Promise<GroupStats> {
    return this.trie.commit(async (appender) => {
      const result = await bulkBuildFacts(appender, occurrences, this.deps);
      this.exceptionCount = result.exceptionCount;
      return result.root;
    });
  }

  /** Reads of the committed trie. */
  queries(): IdFactQueries {
    const reader = this.trie.reader(this.cache);
    const root = this.trie.root;
    const view: IdEntryView = { get: (hash) => reader.lookup(root, hash) };
    return new IdFactQueries(view, this.deps);
  }

  entries(): AsyncGenerator<IdEntry> {
    return this.trie.reader(this.cache).entries(this.trie.root);
  }

  close(): Promise<void> {
    return this.trie.close();
  }
}
