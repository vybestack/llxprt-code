/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { IdKeyHasher } from './idKeys.js';
import { BoundedIdNodeCache } from './idTrieCache.js';
import { KeyedMapReader } from './keyedMap.js';
import type { PinnedRead } from './pinLease.js';
import { readRowTreeNode } from './rowTreeReader.js';

export const KIMI_ELIGIBLE_KEY = 'kimi:eligible';

export function kimiEnabled(value: Uint8Array | undefined): boolean {
  if (value === undefined) return false;
  if (value.length !== 1 || value[0] !== 1)
    throw new JournalFormatError('Invalid Kimi emitted eligible marker');
  return true;
}

export class KimiOrdinalQueries {
  private readonly meta: KeyedMapReader;

  constructor(
    private readonly read: PinnedRead,
    hasher: IdKeyHasher,
  ) {
    this.meta = new KeyedMapReader(
      read.version === undefined ? undefined : read.access,
      new BoundedIdNodeCache(),
      'meta',
      hasher,
    );
  }

  async count(): Promise<number> {
    this.read.requireOpen();
    const version = this.read.version;
    if (
      version === undefined ||
      !kimiEnabled(
        await this.meta.get(version.roots.metaRoot, KIMI_ELIGIBLE_KEY),
      )
    )
      throw new JournalFormatError('Kimi emitted eligible facts need a fill');
    return version.aggregate.callBlocks;
  }

  async ordinal(label: bigint, withinRow: number): Promise<number> {
    await this.count();
    const version = this.read.version;
    if (version === undefined || version.roots.rowRoot === 0)
      throw new RangeError('Kimi ordinal needs a live row');
    let node = await readRowTreeNode(this.read.access, version.roots.rowRoot);
    let below = 0;
    while (node.kind === 'internal') {
      let next: number | undefined;
      for (const slot of node.slots) {
        if (slot.maxLabel < label) below += slot.aggregate.callBlocks;
        else {
          next = slot.childOffset;
          break;
        }
      }
      if (next === undefined)
        throw new RangeError('Kimi ordinal needs a live row');
      node = await readRowTreeNode(this.read.access, next);
    }
    for (const entry of node.entries) {
      if (entry.label < label) below += entry.callBlocks;
      else if (
        entry.label === label &&
        Number.isInteger(withinRow) &&
        withinRow >= 0 &&
        withinRow < entry.callBlocks
      )
        return below + withinRow;
      else break;
    }
    throw new RangeError('Kimi ordinal is outside the row eligible calls');
  }
}
