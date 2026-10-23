/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type {
  IContent,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { encodeContentRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import type { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';

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
async function appendMemoryFixtureRow(
  session: JournalSession,
  content: IContent,
  workload: MemoryWorkload,
): Promise<void> {
  if (workload !== 'compressed') {
    await session.append([content]);
    return;
  }
  const version = session.store.published;
  if (version === undefined) throw new Error('Missing seeded version');
  await session.store.commit([
    {
      kind: 'compress',
      summary: encodeContentRow(
        { ...content, metadata: { isSummary: true } },
        { owner: 0 },
      ),
      retainFromLabel: version.nextLabel,
      expectedReplaced: 1,
    },
  ]);
}

/** Runs only in the parent process, never on the measured heap. */
export async function writeMemoryFixture(
  directory: string,
  count: number,
  workload: MemoryWorkload,
  identity: { sessionId: string; name: string } = {
    sessionId: 'wholememory',
    name: '',
  },
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const media = await prepareMediaFixture(directory, workload);
  const recording = JournalRecordingService.create({
    chatsDir: directory,
    sessionId: identity.sessionId,
    projectHash: MEMORY_PROJECT,
    workspaceDirs: [],
    provider: 'test',
    model: 'test',
  });
  try {
    const session = await recording.session();
    if (identity.name !== '') await recording.setSessionName(identity.name);
    if (workload === 'compressed') {
      await session.append([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'initial' }],
        },
      ]);
    }
    for (let index = 0; index < count; index += 1) {
      const content: IContent = {
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
      await appendMemoryFixtureRow(session, content, workload);
    }
    if (workload === 'wide-metadata') {
      recording.recordDirectoriesChanged(
        Array.from({ length: 512 }, (_, index) => `/${fixtureText(index)}`),
      );
    }
    await recording.createCheckpoint('memory-checkpoint');
    await recording.flush();
  } finally {
    await recording.dispose();
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
