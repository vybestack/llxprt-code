/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serialize, deserialize } from 'node:v8';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProjectionDiskFixture } from './projection-ownership-fixture.js';
import {
  projectionInstructions,
  projectionModel,
} from './projection-ownership-fixture.js';

/**
 * `large` true is the >10 MiB row of mixed prose and code-like lines; a number
 * is that many 64 KiB single-character runs, which exercise the large-piece
 * estimator path.
 */
export type DiskTextTail = boolean | number;

const chunkBytes = 65536;
const largeChunkCount = 161;
const vocabulary = [
  'the',
  'estimate',
  'prompt',
  'stream',
  'token',
  'row',
  'disk',
  'segment',
  'function',
  'return',
  'const',
  'await',
  '{',
  '}',
  '(',
  ')',
  '=>',
  'a',
  'of',
  'and',
  'to',
  'in',
  'is',
  'it',
  'that',
  '雪',
  'naïve',
  '12345',
  'Request',
  'ünï',
  '"quoted"',
  'path/to/file.ts',
  'x_y',
  '\\',
  '\n',
];
const mixedChunks = new Map<number, string>();

/** Deterministic words and lines, so the independent WASM oracle is linear. */
function mixedChunk(variant: number): string {
  const cached = mixedChunks.get(variant);
  if (cached !== undefined) return cached;
  let seed = 0x9e3779b1 ^ (variant * 0x85ebca6b);
  const parts: string[] = [];
  let length = 0;
  while (length < chunkBytes) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const word = vocabulary[seed % vocabulary.length];
    const separator = seed % 11 === 0 ? '\n' : ' ';
    parts.push(word, separator);
    length += word.length + 1;
  }
  const chunk = parts.join('').slice(0, chunkBytes);
  mixedChunks.set(variant, chunk);
  return chunk;
}

function tailText(large: DiskTextTail): string {
  if (typeof large === 'number')
    return `${'a'.repeat(chunkBytes)} `.repeat(large);
  if (!large) return 'tail';
  const chunks: string[] = [];
  for (let index = 0; index < largeChunkCount; index++)
    chunks.push(mixedChunk(index % 8));
  return `${chunks.join(' ')} `;
}

export function diskTextRow(index: number, large: DiskTextTail): IContent {
  const hasTail = large !== false && large !== 0;
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [
      {
        type: 'text',
        text: `${index}: "quoted" \\ 雪\n\ud800 ${'a'.repeat(513)}`,
      },
      {
        type: 'text',
        text: hasTail && index === 63 ? tailText(large) : 'tail',
      },
    ],
  };
}

export function diskTextFixture(
  large: boolean,
  retain: boolean,
): ProjectionDiskFixture {
  const root = mkdtempSync(join(tmpdir(), 'disk-text-route-'));
  const state = { opened: 0, pulled: 0, active: 0, closed: false };
  const references: Array<WeakRef<IContent>> = [];
  const retained: IContent[] = [];
  for (let index = 0; index < 64; index++)
    writeFileSync(
      join(root, `${index}.row`),
      serialize(diskTextRow(index, large)),
    );
  return {
    root,
    state,
    references,
    retained,
    rows: {
      count: 64,
      async *openReader(signal?: AbortSignal): AsyncGenerator<IContent, void> {
        state.opened++;
        state.active++;
        try {
          for (let index = 0; index < 64; index++) {
            signal?.throwIfAborted();
            if (state.closed) throw new Error('Disk source is closed');
            const row: IContent = deserialize(
              readFileSync(join(root, `${index}.row`)),
            );
            references.push(new WeakRef(row));
            if (retain) retained.push(row);
            state.pulled++;
            yield row;
          }
        } finally {
          state.active--;
        }
      },
    },
    close: () => {
      state.closed = true;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function diskTextWireOracle(large: boolean): {
  bytes: number;
  sha256: string;
} {
  const hash = createHash('sha256');
  let bytes = 0;
  const append = (text: string): void => {
    bytes += Buffer.byteLength(text);
    hash.update(text);
  };
  append(`{"model":"${projectionModel}","input":[`);
  for (let index = 0; index < 64; index++) {
    if (index !== 0) append(',');
    const row = diskTextRow(index, large);
    append(
      JSON.stringify({
        role: row.speaker === 'human' ? 'user' : 'assistant',
        content: row.blocks
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join(row.speaker === 'human' ? '\n' : ''),
      }),
    );
  }
  append(
    `],"stream":true,"instructions":${JSON.stringify(projectionInstructions)}}`,
  );
  return { bytes, sha256: hash.digest('hex') };
}
