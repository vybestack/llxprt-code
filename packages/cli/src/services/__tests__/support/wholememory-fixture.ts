/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { MediaReferenceBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';

export const MEMORY_PROJECT = 'wholememory-project';
export const MEMORY_PAGE = 16;
export type MemoryWorkload =
  | 'plain'
  | 'compressed'
  | 'wide-metadata'
  | 'media'
  | 'media-dense';

export function fixtureText(index: number): string {
  return Array.from({ length: 64 }, (_, part) =>
    createHash('sha256').update(`${index}:${part}`).digest('hex'),
  ).join('');
}

/** Runs only in the parent process, never on the measured heap. */
export async function writeMemoryFixture(
  directory: string,
  count: number,
  workload: MemoryWorkload,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const media = await prepareMediaFixture(directory, workload);
  const handle = await open(join(directory, 'session-wholememory.jsonl'), 'w');
  let seq = 0;
  const append = async (type: string, payload: unknown): Promise<void> => {
    await handle.write(
      `${JSON.stringify({
        v: 1,
        seq: ++seq,
        ts: '2026-09-21T00:00:00Z',
        type,
        payload,
      })}\n`,
    );
  };
  try {
    await append('session_start', {
      sessionId: 'wholememory',
      projectHash: MEMORY_PROJECT,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      kind: 'main',
      startTime: '2026-09-21T00:00:00Z',
    });
    if (workload === 'compressed') {
      await append('content', {
        content: {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'initial' }],
        },
      });
    }
    for (let index = 0; index < count; index += 1) {
      const content = {
        speaker: index % 2 === 1 ? 'ai' : 'human',
        blocks: [
          { type: 'text', text: fixtureText(index) },
          ...(media && (workload === 'media-dense' || index % 64 === 0)
            ? [
                {
                  ...media,
                  semanticMetadata: {
                    description: fixtureText(index + 100000).repeat(
                      workload === 'media-dense' ? 2 : 16,
                    ),
                  },
                },
              ]
            : []),
        ],
      };
      await append(
        workload === 'compressed' ? 'compressed' : 'content',
        workload === 'compressed'
          ? { summary: content, itemsCompressed: 1 }
          : { content },
      );
    }
    if (workload === 'wide-metadata') {
      await append('directories_changed', {
        directories: Array.from(
          { length: 512 },
          (_, index) => `/${fixtureText(index)}`,
        ),
      });
    }
    await append('checkpoint_created', {
      checkpointId: 'memory-checkpoint',
      name: 'memory-checkpoint',
    });
  } finally {
    await handle.close();
  }
}

async function prepareMediaFixture(
  directory: string,
  workload: MemoryWorkload,
): Promise<MediaReferenceBlock | undefined> {
  const mediaStore = new LocalMediaStore({
    rootDirectory: join(directory, 'media'),
    quotaBytes: 1024 * 1024,
  });
  const media =
    workload === 'media' || workload === 'media-dense'
      ? await mediaStore.admit({
          bytes: new Uint8Array(32).fill(42),
          mimeType: 'application/octet-stream',
          semanticMetadata: {},
        })
      : undefined;
  await mediaStore.close();
  return media;
}
