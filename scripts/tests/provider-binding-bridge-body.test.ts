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
import { createHistoryProviderFileBindingStore } from '../../packages/core/src/services/history/provider-file-binding.js';
import {
  bindingFile,
  forbidLegacyBindingTransform,
} from '../../packages/core/src/services/history/provider-binding-bridge-test-helpers.js';
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
    { turnId: 'binding-body', source: 'binding-body' },
  );
  const block = rows[0].blocks[0];
  if (block.type !== 'media' || block.encoding !== 'reference')
    throw new Error('Expected admitted reference');
  return block;
}
function bodyFixtureRow(
  index: number,
  reference: MediaReferenceBlock,
): IContent {
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
    const rowAt = (index: number): IContent => bodyFixtureRow(index, reference);
    for (let index = 0; index < size; index++)
      await recorder.commit('content', { content: rowAt(index) });
    const failure = new Error('binding BODY rollback');
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
    forbidLegacyBindingTransform(history);
    const result = await rejectedValue(
      createHistoryProviderFileBindingStore(history).bind(
        reference.contentId,
        bindingFile,
      ),
    );
    expect(result).toBe(rollback ? failure : undefined);
    const oracle = Array.from({ length: size }, (_, index) => {
      const row = rowAt(index);
      return index === 0 && !rollback
        ? {
            ...row,
            blocks: row.blocks.map((block) =>
              block === reference
                ? { ...reference, providerFiles: [bindingFile] }
                : block,
            ),
          }
        : row;
    });
    const pending = providerPendingFixture();
    const actualRows = await recomposeFixture(history, pending);
    const expectedRows = buildProviderContent(
      oracle,
      pending,
      new DebugLogger('test:binding-body'),
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
describe('provider BODY through the production file binding bridge', () => {
  for (const size of [512, 8192])
    for (const rollback of [false, true])
      it(`preserves ${size}-row BODY bytes after ${rollback ? 'rollback' : 'binding'} for cache and transport retry`, async () => {
        const root = await mkdtemp(join(tmpdir(), 'binding-body-'));
        try {
          const store = new LocalMediaStore({
            rootDirectory: root,
            quotaBytes: 1024 * 1024,
          });
          const reference = await admittedReference(store);
          expect(
            await compareBodies(
              size,
              rollback,
              reference,
              new RequestMediaResolver(store),
            ),
          ).toBe(size);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }, 180_000);
});
