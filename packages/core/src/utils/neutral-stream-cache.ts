/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { encodingBpeRanks, type EncodingCache } from './neutral-long-piece.js';
import { neutralCharacterKey } from './neutral-pattern-machine.js';

interface CharacterData {
  readonly bytes: Buffer;
  readonly key: string;
}

/** Bounded reusable facts owned by one text stream and its lexical branches. */
export class NeutralStreamCache {
  readonly prefixes = new Map<string, number>();
  private readonly characters = new Map<string, CharacterData>();
  private vocabulary: ReadonlyMap<string, number> | undefined;
  private maxBytes: number | undefined;

  constructor(private readonly encodings: EncodingCache) {}

  get ranks(): ReadonlyMap<string, number> {
    return (this.vocabulary ??= encodingBpeRanks('o200k_base', this.encodings));
  }

  get width(): number {
    if (this.maxBytes !== undefined) return this.maxBytes;
    let width = 0;
    for (const key of this.ranks.keys()) width = Math.max(width, key.length);
    this.maxBytes = width;
    return width;
  }

  character(value: string): CharacterData {
    const known = this.characters.get(value);
    if (known !== undefined) return known;
    const data = { bytes: Buffer.from(value), key: neutralCharacterKey(value) };
    if (this.characters.size < 256) this.characters.set(value, data);
    return data;
  }
}
