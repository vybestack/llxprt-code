/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
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
  forbidClientArrayRollback,
  recordClientProof,
} from '../../packages/agents/src/core/client-array-test-helpers.js';
import { withRetainedClient } from '../../packages/agents/src/core/retained-array-test-helpers.js';
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
    { turnId: 'client-body', source: 'client-body' },
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
function restoredRow(index: number, reference: MediaReferenceBlock): IContent {
  const row = bodyRow(index, reference);
  return {
    ...row,
    blocks: [...row.blocks, { type: 'text', text: `restored-${index}` }],
  };
}
async function compareBytes(
  size: number,
  rollback: boolean,
  actualRows: IContent[],
  expectedRows: IContent[],
  resolver: RequestMediaResolver,
): Promise<void> {
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
      recordClientProof({
        kind: 'body',
        size,
        rollback,
        provider,
        caching,
        bytes: Buffer.byteLength(actual),
        actualDigest: createHash('sha256').update(actual).digest('hex'),
        expectedDigest: createHash('sha256').update(expected).digest('hex'),
      });
    }
  expect(resolver.accounting().activeRequestCount).toBe(0);
}
async function compareBodies(size: number, rollback: boolean): Promise<number> {
  return withDetachedFixture((fixture) =>
    withRetainedClient(fixture, async ({ client, store }) => {
      const { history, recorder } = fixture;
      const reference = await admittedReference(store);
      for (let index = 0; index < size; index++)
        await recorder.commit('content', {
          content: bodyRow(index, reference),
        });
      const failure = new Error('client BODY rollback');
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
      forbidClientArrayRollback(fixture);
      const error = await rejectedValue(
        client.storeHistoryForLaterUse(
          Array.from({ length: size }, (_, index) =>
            restoredRow(index, reference),
          ),
        ),
      );
      if (rollback) {
        expect(error).toBeInstanceOf(Error);
        if (!(error instanceof Error))
          throw new Error('Missing client BODY failure');
        expect(error.message).toContain(failure.message);
      } else expect(error).toBeUndefined();
      const oracle = Array.from({ length: size }, (_, index) =>
        rollback ? bodyRow(index, reference) : restoredRow(index, reference),
      );
      const pending = providerPendingFixture();
      await compareBytes(
        size,
        rollback,
        await recomposeFixture(history, pending),
        buildProviderContent(
          oracle,
          pending,
          new DebugLogger('test:client-body'),
        ),
        new RequestMediaResolver(store),
      );
      return history.getContextRange().totalEntries;
    }),
  );
}
describe('provider BODY through AgentClient deferred retained array', () => {
  for (const size of [512, 8192])
    for (const rollback of [false, true]) {
      it(`preserves ${size} BODY rows after ${rollback ? 'rollback' : 'restore'} with cache and retry`, async () => {
        expect(await compareBodies(size, rollback)).toBe(size);
      }, 180_000);
    }
});
