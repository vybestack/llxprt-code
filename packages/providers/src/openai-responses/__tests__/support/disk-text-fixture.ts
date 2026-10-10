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

/** `large` true is the >10 MiB row; a number is that many 64 KiB chunks. */
export type DiskTextTail = boolean | number;

function tailChunks(large: DiskTextTail): number {
  if (typeof large === 'number') return large;
  return large ? 161 : 0;
}

export function diskTextRow(index: number, large: DiskTextTail): IContent {
  const chunks = tailChunks(large);
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [
      {
        type: 'text',
        text: `${index}: "quoted" \\ 雪\n\ud800 ${'a'.repeat(513)}`,
      },
      {
        type: 'text',
        text:
          chunks > 0 && index === 63
            ? `${'a'.repeat(65536)} `.repeat(chunks)
            : 'tail',
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
