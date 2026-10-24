/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { bulkBuildIdTrie } from './idTrieMerge.js';
import {
  compareIdHashes,
  decodeIdTrieNode,
  type IdEntry,
} from './idTrieNode.js';
import { sha256KeyHash } from './idKeys.js';
import type { RecordAppender } from './groupAppender.js';

describe('bounded id trie batch CPU work', () => {
  it.each([32, 128])(
    'bounds microtask work for %i already-sorted facts',
    async (size) => {
      const entries: IdEntry[] = Array.from({ length: size }, (_, index) => ({
        hash: sha256KeyHash(0, new TextEncoder().encode(`id-${index}`)),
        value: Uint8Array.of(index),
      })).sort((left, right) => compareIdHashes(left.hash, right.hash));
      const leaves: IdEntry[] = [];
      let nodes = 0;
      const appender: RecordAppender = {
        get nextOffset() {
          return nodes + 1;
        },
        append(record) {
          nodes++;
          const node = decodeIdTrieNode(record.kindHeader);
          if (node.kind === 'leaf') leaves.push(...node.entries);
          return Promise.resolve(nodes);
        },
        drain: () => Promise.resolve(),
      };
      let active = true;
      let microtasks = 0;
      const tick = (): void => {
        microtasks++;
        if (active) queueMicrotask(tick);
      };
      queueMicrotask(tick);
      try {
        await bulkBuildIdTrie(appender, entries);
      } finally {
        active = false;
      }
      expect(leaves).toStrictEqual(entries);
      process.stdout.write(
        `TRIE_BATCH_WORK ${JSON.stringify({ size, nodes, microtasks })}\n`,
      );
      expect(microtasks).toBeLessThanOrEqual(4 * size + 16 * nodes);
    },
  );
});
