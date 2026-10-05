/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DebugLogger } from '../../packages/core/src/debug/index.js';
import { buildProviderContent } from '../../packages/core/src/services/history/historyProviderPipeline.js';
import {
  providerFarFixtureRow,
  providerPendingFixture,
} from '../../packages/core/src/services/history/provider-curated-test-helpers.js';
import {
  mediaParticipant,
  rejectedValue,
} from '../../packages/core/src/services/history/chronology-rollback-test-helpers.js';
import { recomposeFixture } from '../../packages/agents/src/compression/__tests__/provider-curated-recomposition-helpers.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';
import { withDetachedFixture } from '../../packages/core/src/services/history/detached-rollback-test-helpers.js';
import {
  conversationFor,
  forbidArrayRollback,
} from '../../packages/agents/src/core/conversation-array-test-helpers.js';
import { LocalMediaStore } from '../../packages/core/src/storage/local-media-store.js';
import { MediaAdmissionService } from '../../packages/core/src/storage/media-admission-service.js';
import { RequestMediaResolver } from '../../packages/core/src/storage/request-media-resolver.js';
import type {
  IContent,
  MediaReferenceBlock,
} from '../../packages/core/src/services/history/IContent.js';

async function admittedReference(
  store: LocalMediaStore,
): Promise<MediaReferenceBlock> {
  const rows = await new MediaAdmissionService(store).admitContents(
    [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            encoding: 'base64',
            mimeType: 'image/png',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
          },
        ],
      },
    ],
    { turnId: 'conversation-body', source: 'conversation-body' },
  );
  const block = rows[0].blocks[0];
  if (block.type !== 'media' || block.encoding !== 'reference')
    throw new Error('Expected reference');
  return block;
}
function bodyRow(index: number, reference: MediaReferenceBlock): IContent {
  const original = providerFarFixtureRow(index);
  const row: IContent =
    original.blocks.length === 0
      ? {
          ...original,
          blocks: [{ type: 'text', text: 'valid empty-fixture replacement' }],
        }
      : original;
  return index === 0 ? { ...row, blocks: [...row.blocks, reference] } : row;
}
async function compareBodies(
  size: number,
  rollback: boolean,
  reference: MediaReferenceBlock,
  resolver: RequestMediaResolver,
): Promise<number> {
  return withDetachedFixture(async ({ history, recorder }) => {
    const rowAt = (index: number): IContent => bodyRow(index, reference);
    for (let index = 0; index < size; index++)
      await recorder.commit('content', { content: rowAt(index) });
    const failure = new Error('conversation BODY rollback');
    if (rollback)
      history.registerMediaOwner(
        mediaParticipant(() => ({
          publish: () => undefined,
          rollback: () => undefined,
          finalize: () => {
            throw failure;
          },
        })),
      );
    forbidArrayRollback(history);
    const result = await rejectedValue(
      conversationFor(history).setHistory(
        Array.from({ length: size }, (_, index) => ({
          ...rowAt(index),
          blocks: [
            ...rowAt(index).blocks,
            { type: 'text', text: `restored-${index}` },
          ],
        })),
      ),
    );
    expect(result).toBe(rollback ? failure : undefined);
    const oracle = Array.from({ length: size }, (_, index) =>
      rollback
        ? rowAt(index)
        : ({
            ...rowAt(index),
            blocks: [
              ...rowAt(index).blocks,
              { type: 'text', text: `restored-${index}` },
            ],
          } satisfies IContent),
    );
    const pending = providerPendingFixture();
    const actualRows = await recomposeFixture(history, pending);
    const expectedRows = buildProviderContent(
      oracle,
      pending,
      new DebugLogger('test:conversation-body'),
    );
    for (const provider of ['anthropic', 'openai-responses', 'gemini'])
      for (const caching of [false, true]) {
        const actual = await captureCuratedBody(
          provider,
          actualRows,
          caching,
          true,
          true,
          undefined,
          resolver,
        );
        const expected = await captureCuratedBody(
          provider,
          expectedRows,
          caching,
          false,
          false,
          undefined,
          resolver,
        );
        expect(actual).toBe(expected);
      }
    expect(resolver.accounting().activeRequestCount).toBe(0);
    return history.getContextRange().totalEntries;
  });
}
describe('provider BODY through ConversationManager array restore', () => {
  for (const size of [512, 8192])
    for (const rollback of [false, true]) {
      it(`preserves ${size} rows of BODY bytes after ${rollback ? 'rollback' : 'restore'} with cache and retry`, async () => {
        const root = await mkdtemp(join(tmpdir(), 'conversation-body-'));
        const store = new LocalMediaStore({
          rootDirectory: root,
          quotaBytes: 1024 * 1024,
        });
        try {
          expect(
            await compareBodies(
              size,
              rollback,
              await admittedReference(store),
              new RequestMediaResolver(store),
            ),
          ).toBe(size);
        } finally {
          await store.close();
          await rm(root, { recursive: true, force: true });
        }
      }, 180_000);
    }
});
