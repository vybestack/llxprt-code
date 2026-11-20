import { publishReviewedRewrite } from './publish-reviewed-rewrite.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  withNativeDetachedFixture,
  type NativeDetachedFixture,
} from './__tests__/support/detached-contract-fixture.js';
import { journalMediaParticipant } from './chronology-rollback-test-helpers.js';
import type { DetachedHistoryOptions } from './detachedHistoryMutation.js';
import { createUserMessage, type IContent } from './IContent.js';
import { textsOf } from '../../recording/__tests__/refusal-rewrite-test-helpers.js';

function ai(text: string, metadata?: IContent['metadata']): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text }], metadata };
}
async function seeded(
  action: (fixture: NativeDetachedFixture) => Promise<void>,
  rows: readonly IContent[] = [createUserMessage('goal'), ai('answer')],
): Promise<void> {
  await withNativeDetachedFixture(async (fixture) => {
    await fixture.history.addBatch([...rows]);
    await action(fixture);
  });
}
async function rewriteAt(
  fixture: NativeDetachedFixture,
  target: number,
  text: string,
  options: DetachedHistoryOptions = {},
): Promise<void> {
  const replacements = new Map<number, IContent>();
  let ordinal = 0;
  for await (const row of fixture.history.streamRawHistory()) {
    if (ordinal++ === target) {
      replacements.set(target, {
        ...row,
        blocks: row.blocks.map((block) =>
          block.type === 'text' ? { ...block, text } : block,
        ),
      });
      break;
    }
  }
  await publishReviewedRewrite(fixture.history, replacements, options);
}
function requireCurrent(isCurrent: () => boolean): () => void {
  return () => {
    if (!isCurrent()) throw new Error('stale review');
  };
}

describe('guarded native history transformations', () => {
  it('commits the rewrite when the reviewed journal version is current', async () => {
    await seeded(async (fixture) => {
      await rewriteAt(fixture, 1, 'answer rewritten', {
        assertCurrent: requireCurrent(fixture.history.historyMutationGuard()),
      });
      expect(await textsOf(fixture.history.streamRawHistory())).toStrictEqual([
        'goal',
        'answer rewritten',
      ]);
    });
  });
  it('re-estimates tokens for rewritten history', async () => {
    await seeded(async (fixture) => {
      fixture.history.setTokenizerFactory({
        getTokenizer: () => ({
          countTokens: async (value: unknown) => JSON.stringify(value).length,
        }),
      });
      await fixture.history.recalculateTokens();
      const before = fixture.history.getTotalTokens();
      await rewriteAt(fixture, 1, `long ${'answer '.repeat(400)}`);
      expect(fixture.history.getTotalTokens()).toBeGreaterThan(before);
    });
  });
  it('leaves history untouched when a row was appended after review', async () => {
    await seeded(async (fixture) => {
      const current = fixture.history.historyMutationGuard();
      await fixture.history.addBatch([createUserMessage('appended meanwhile')]);
      await expect(
        rewriteAt(fixture, 1, 'answer rewritten', {
          assertCurrent: requireCurrent(current),
        }),
      ).rejects.toThrow('stale review');
      expect(await textsOf(fixture.history.streamRawHistory())).toStrictEqual([
        'goal',
        'answer',
        'appended meanwhile',
      ]);
    });
  });
  it('publishes and finalizes native media effects with the committed rows', async () => {
    await seeded(async (fixture) => {
      const steps: string[] = [];
      await fixture.history.registerMediaOwner(
        journalMediaParticipant(() => {
          steps.push('prepare');
          return {
            publish: () => {
              steps.push('publish');
            },
            rollback: () => {
              steps.push('rollback');
            },
            finalize: () => {
              steps.push('finalize');
            },
          };
        }),
      );
      await rewriteAt(fixture, 1, 'answer rewritten');
      expect(steps).toStrictEqual(['prepare', 'publish', 'finalize']);
      expect(await textsOf(fixture.persistedRows())).toStrictEqual([
        'goal',
        'answer rewritten',
      ]);
    });
  });
  it('restores previous rows when a native effect cannot publish', async () => {
    await seeded(async (fixture) => {
      const steps: string[] = [];
      await fixture.history.registerMediaOwner(
        journalMediaParticipant(() => ({
          publish: () => {
            throw new Error('journal is unwritable');
          },
          rollback: () => {
            steps.push('rollback');
          },
        })),
      );
      await expect(rewriteAt(fixture, 1, 'answer rewritten')).rejects.toThrow(
        'journal is unwritable',
      );
      expect({
        final: await textsOf(fixture.history.streamRawHistory()),
        steps,
      }).toStrictEqual({ final: ['goal', 'answer'], steps: ['rollback'] });
      await fixture.durable();
    });
  });
  it('restores rows and tokens when finalization fails', async () => {
    await seeded(async (fixture) => {
      const before = fixture.history.getTotalTokens();
      await fixture.history.registerMediaOwner(
        journalMediaParticipant(() => ({
          publish: () => {},
          rollback: () => {},
          finalize: () => {
            throw new Error('flush failed');
          },
        })),
      );
      await expect(
        rewriteAt(fixture, 1, `long ${'answer '.repeat(400)}`),
      ).rejects.toThrow('flush failed');
      expect({
        final: await textsOf(fixture.history.streamRawHistory()),
        tokens: fixture.history.getTotalTokens(),
      }).toStrictEqual({ final: ['goal', 'answer'], tokens: before });
      await fixture.durable();
    });
  });
  it('drops Responses parent markers when retained context is rewritten', async () => {
    await seeded(
      async (fixture) => {
        await rewriteAt(fixture, 0, 'goal rewritten');
        const markers: Array<boolean | undefined> = [];
        for await (const row of fixture.history.streamRawHistory())
          markers.push(row.metadata?.responsesStored);
        expect(markers).toStrictEqual([undefined, undefined, undefined]);
      },
      [
        createUserMessage('goal'),
        ai('stored answer', { responsesStored: true, id: 'resp_1' }),
        createUserMessage('follow-up'),
      ],
    );
  });
  for (const target of [0, 2]) {
    it(`updates the cache anchor according to whether row ${target} changes the preserved head`, async () => {
      await seeded(
        async (fixture) => {
          const rows = await Array.fromAsync(
            fixture.history.streamRawHistory(),
          );
          const anchor = rows[1].metadata?.chronology?.seq ?? 0;
          fixture.history.setCacheAnchorSeq(anchor);
          await rewriteAt(
            fixture,
            target,
            target === 0 ? 'head rewritten' : 'tail rewritten',
          );
          expect(fixture.history.getCacheAnchorSeq()).toBe(
            target === 0 ? 0 : anchor,
          );
        },
        [createUserMessage('head'), ai('anchored'), createUserMessage('tail')],
      );
    });
  }
  it('writes no new group for an unchanged transform without an audit', async () => {
    await seeded(async (fixture) => {
      const before = fixture.session.store.published?.commitSeq;
      await rewriteAt(fixture, -1, 'unused');
      expect(fixture.session.store.published?.commitSeq).toBe(before);
    });
  });
  it('commits an audit for unchanged rows when requested', async () => {
    await seeded(async (fixture) => {
      const before = await Array.fromAsync(fixture.history.streamRawHistory());
      await rewriteAt(fixture, -1, 'unused', {
        audit: { key: 'refusal_rewrite:pending', value: new Uint8Array([1]) },
      });
      expect(
        await fixture.session.store.getMeta('refusal_rewrite:pending'),
      ).toStrictEqual(new Uint8Array([1]));
      expect(
        await Array.fromAsync(fixture.history.streamRawHistory()),
      ).toStrictEqual(before);
    });
  });
  it('refuses an unchanged audit when the reviewed version moved on', async () => {
    await seeded(async (fixture) => {
      const current = fixture.history.historyMutationGuard();
      await fixture.history.addBatch([createUserMessage('appended meanwhile')]);
      await expect(
        rewriteAt(fixture, -1, 'unused', {
          assertCurrent: requireCurrent(current),
          audit: { key: 'refusal_rewrite:pending', value: new Uint8Array([1]) },
        }),
      ).rejects.toThrow('stale review');
      expect(
        await fixture.session.store.getMeta('refusal_rewrite:pending'),
      ).toBeUndefined();
    });
  });
  it('prepares no effects when cancelled while computing a rewrite', async () => {
    await seeded(async (fixture) => {
      const controller = new AbortController();
      const before = await Array.fromAsync(fixture.history.streamRawHistory());
      const steps: string[] = [];
      await fixture.history.registerMediaOwner(
        journalMediaParticipant(() => {
          steps.push('prepare');
          return { publish: () => {}, rollback: () => {} };
        }),
      );
      const failure = await fixture.history.detachedValues
        .transform(
          async () => {
            controller.abort();
            controller.signal.throwIfAborted();
          },
          undefined,
          { signal: controller.signal },
        )
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      expect(failure).toBe(controller.signal.reason);
      expect(steps).toStrictEqual([]);
      expect(
        await Array.fromAsync(fixture.history.streamRawHistory()),
      ).toStrictEqual(before);
    });
  });
  it('rolls back the prepared effect when cancelled during publication', async () => {
    await seeded(async (fixture) => {
      const controller = new AbortController();
      const steps: string[] = [];
      await fixture.history.registerMediaOwner(
        journalMediaParticipant(() => ({
          publish: async () => {
            steps.push('publish');
            controller.abort();
            await Promise.resolve();
          },
          rollback: () => {
            steps.push('rollback');
          },
          finalize: () => {
            steps.push('finalize');
          },
        })),
      );
      const failure = await rewriteAt(fixture, 1, 'answer rewritten', {
        signal: controller.signal,
      }).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toBe(controller.signal.reason);
      expect({
        steps,
        final: await textsOf(fixture.history.streamRawHistory()),
      }).toStrictEqual({
        steps: ['publish', 'rollback'],
        final: ['goal', 'answer'],
      });
    });
  });
});
