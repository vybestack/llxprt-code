/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { BoundedIdNodeCache } from '@vybestack/llxprt-code-core/journal/idTrieCache.js';
import { IdTrieReader } from '@vybestack/llxprt-code-core/journal/idTrieReader.js';
import { decodeIdFact } from '@vybestack/llxprt-code-core/journal/idFactCodec.js';
import { decodeOccurrenceValue } from '@vybestack/llxprt-code-core/journal/idEntryCodecs.js';
import {
  ID_NS,
  OCCURRENCE_KIND,
  fact0Key,
  occurrenceKey,
  sha256KeyHash,
} from '@vybestack/llxprt-code-core/journal/idKeys.js';
import type { JournalReader } from '@vybestack/llxprt-code-core/journal/journalReader.js';

export class NativeResponseIndex {
  private readonly trie: IdTrieReader;

  constructor(private readonly reader: JournalReader) {
    this.trie = new IdTrieReader(reader, new BoundedIdNodeCache());
  }

  private lookup(
    namespace: number,
    key: Uint8Array,
  ): Promise<Uint8Array | undefined> {
    return this.trie.lookup(
      this.reader.trailer?.idRoot ?? 0,
      sha256KeyHash(namespace, key),
    );
  }

  private async label(id: string, ordinal: number): Promise<bigint> {
    const value = await this.lookup(
      ID_NS.occurrence,
      occurrenceKey(OCCURRENCE_KIND.response, ordinal, id),
    );
    if (value === undefined)
      throw new Error('Missing counted native response occurrence');
    return decodeOccurrenceValue(value).at.label;
  }

  async last(
    id: string,
    from: bigint,
    end: bigint,
  ): Promise<bigint | undefined> {
    const value = await this.lookup(ID_NS.fact, fact0Key(id));
    if (value === undefined) return undefined;
    const count = decodeIdFact(value).respCount;
    let low = 1;
    let high = count + 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((await this.label(id, middle)) < end) low = middle + 1;
      else high = middle;
    }
    if (low === 1) return undefined;
    const label = await this.label(id, low - 1);
    return label < from ? undefined : label;
  }
}
