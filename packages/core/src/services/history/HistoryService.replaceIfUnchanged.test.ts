/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * replaceIfUnchanged is the transactional rewrite used by refusal recovery
 * (issue #4036): the reviewed snapshot must still be the live history when the
 * rewrite commits, a prepared effect (the journal write) is part of the same
 * commit, and a failure anywhere leaves the previous history in place.
 */

import { describe, expect, it } from 'bun:test';
import { createUserMessage } from './IContent.js';
import type { IContent } from './IContent.js';
import { HistoryService } from './HistoryService.js';

function texts(contents: readonly IContent[]): string[] {
  return contents.flatMap((content) =>
    content.blocks.flatMap((block) =>
      block.type === 'text' ? [block.text] : [],
    ),
  );
}

function ai(text: string, metadata?: IContent['metadata']): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function replaceText(
  contents: readonly IContent[],
  index: number,
  text: string,
): IContent[] {
  return contents.map((content, position) =>
    position === index
      ? { ...content, blocks: [{ type: 'text' as const, text }] }
      : content,
  );
}

async function seeded(entries: readonly IContent[]): Promise<HistoryService> {
  const history = new HistoryService();
  await history.addBatch([...entries]);
  return history;
}

describe('HistoryService.replaceIfUnchanged', () => {
  it('commits the rewrite when the snapshot is still the live history', async () => {
    const history = await seeded([createUserMessage('goal'), ai('answer one')]);

    const outcome = await history.replaceIfUnchanged({
      expected: history.getAll(),
      rewrite: (current) => replaceText(current, 1, 'answer rewritten'),
    });

    expect({ outcome, final: texts(history.getAll()) }).toStrictEqual({
      outcome: 'applied',
      final: ['goal', 'answer rewritten'],
    });
  });

  it('re-estimates tokens for the rewritten history', async () => {
    const history = await seeded([createUserMessage('goal'), ai('short')]);
    const before = history.getTotalTokens();

    await history.replaceIfUnchanged({
      expected: history.getAll(),
      rewrite: (current) =>
        replaceText(current, 1, `long ${'answer '.repeat(400)}`),
    });

    expect(history.getTotalTokens()).toBeGreaterThan(before);
  });

  it('leaves history untouched when an entry was appended after the snapshot', async () => {
    const history = await seeded([createUserMessage('goal'), ai('answer')]);
    const snapshot = history.getAll();
    await history.addBatch([createUserMessage('appended meanwhile')]);

    const outcome = await history.replaceIfUnchanged({
      expected: snapshot,
      rewrite: (current) => replaceText(current, 1, 'answer rewritten'),
    });

    expect({ outcome, final: texts(history.getAll()) }).toStrictEqual({
      outcome: 'stale',
      final: ['goal', 'answer', 'appended meanwhile'],
    });
  });

  it('runs the prepared effect with the committed history and finalizes it', async () => {
    const history = await seeded([createUserMessage('goal'), ai('answer')]);
    const steps: string[] = [];

    await history.replaceIfUnchanged({
      expected: history.getAll(),
      rewrite: (current) => replaceText(current, 1, 'answer rewritten'),
      prepareEffect: (next) => {
        steps.push(`prepare:${texts(next).join('|')}`);
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
      },
    });

    expect(steps).toStrictEqual([
      'prepare:goal|answer rewritten',
      'publish',
      'finalize',
    ]);
  });

  it('keeps the previous history when the prepared effect cannot publish', async () => {
    const history = await seeded([createUserMessage('goal'), ai('answer')]);
    const rolledBack: string[] = [];

    const failure = await history
      .replaceIfUnchanged({
        expected: history.getAll(),
        rewrite: (current) => replaceText(current, 1, 'answer rewritten'),
        prepareEffect: () => ({
          publish: () => {
            throw new Error('journal is unwritable');
          },
          rollback: () => {
            rolledBack.push('rollback');
          },
        }),
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect({
      message: failure instanceof Error ? failure.message : undefined,
      final: texts(history.getAll()),
      rolledBack,
    }).toStrictEqual({
      message: 'journal is unwritable',
      final: ['goal', 'answer'],
      rolledBack: ['rollback'],
    });
  });

  it('keeps the previous history when finalizing the effect fails', async () => {
    const history = await seeded([createUserMessage('goal'), ai('answer')]);
    const before = history.getTotalTokens();

    const failure = await history
      .replaceIfUnchanged({
        expected: history.getAll(),
        rewrite: (current) =>
          replaceText(current, 1, `long ${'answer '.repeat(400)}`),
        prepareEffect: () => ({
          publish: () => undefined,
          rollback: () => undefined,
          finalize: () => {
            throw new Error('flush failed');
          },
        }),
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect({
      failed: failure instanceof Error,
      final: texts(history.getAll()),
      tokens: history.getTotalTokens(),
    }).toStrictEqual({
      failed: true,
      final: ['goal', 'answer'],
      tokens: before,
    });
  });

  it('drops stored Responses parent markers when a retained entry is rewritten', async () => {
    const history = await seeded([
      createUserMessage('goal'),
      ai('stored answer', { responsesStored: true, id: 'resp_1' }),
      createUserMessage('follow-up'),
    ]);

    await history.replaceIfUnchanged({
      expected: history.getAll(),
      rewrite: (current) => replaceText(current, 0, 'goal rewritten'),
    });

    expect(
      history.getAll().map((c) => c.metadata?.responsesStored),
    ).toStrictEqual([undefined, undefined, undefined]);
  });

  it('resets the cache anchor when the rewrite touches the preserved head', async () => {
    const history = await seeded([
      createUserMessage('head'),
      ai('anchored'),
      createUserMessage('tail'),
    ]);
    const anchorSeq = history.getAll()[1].metadata?.chronology?.seq ?? 0;
    history.setCacheAnchorSeq(anchorSeq);

    await history.replaceIfUnchanged({
      expected: history.getAll(),
      rewrite: (current) => replaceText(current, 0, 'head rewritten'),
    });

    expect(history.getCacheAnchorSeq()).toBe(0);
  });

  it('keeps the cache anchor when the rewrite is after the preserved head', async () => {
    const history = await seeded([
      createUserMessage('head'),
      ai('anchored'),
      createUserMessage('tail'),
    ]);
    const anchorSeq = history.getAll()[1].metadata?.chronology?.seq ?? 0;
    history.setCacheAnchorSeq(anchorSeq);

    await history.replaceIfUnchanged({
      expected: history.getAll(),
      rewrite: (current) => replaceText(current, 2, 'tail rewritten'),
    });

    expect(history.getCacheAnchorSeq()).toBe(anchorSeq);
  });

  it('commits nothing and reports unchanged when the rewrite changes no entry', async () => {
    const history = await seeded([createUserMessage('goal'), ai('answer')]);
    const steps: string[] = [];

    const outcome = await history.replaceIfUnchanged({
      expected: history.getAll(),
      rewrite: (current) => current,
      prepareEffect: () => {
        steps.push('prepare');
        return undefined;
      },
    });

    expect({ outcome, steps }).toStrictEqual({
      outcome: 'unchanged',
      steps: [],
    });
  });

  it('commits the prepared effect for a rewrite that changes no entry when asked to', async () => {
    const history = await seeded([createUserMessage('goal'), ai('answer')]);
    const before = history.getAll();
    const steps: string[] = [];

    const outcome = await history.replaceIfUnchanged({
      expected: before,
      commitUnchanged: true,
      rewrite: (current) => current,
      prepareEffect: (next) => {
        steps.push(`prepare:${texts(next).join('|')}`);
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
      },
    });

    expect({
      outcome,
      steps,
      same: history.getAll().every((entry, index) => entry === before[index]),
    }).toStrictEqual({
      outcome: 'applied',
      steps: ['prepare:goal|answer', 'publish', 'finalize'],
      same: true,
    });
  });

  it('still refuses a rewrite that changes no entry when the history moved on', async () => {
    const history = await seeded([createUserMessage('goal'), ai('answer')]);
    const expected = history.getAll();
    await history.addBatch([createUserMessage('appended meanwhile')]);

    const outcome = await history.replaceIfUnchanged({
      expected,
      commitUnchanged: true,
      rewrite: (current) => current,
    });

    expect(outcome).toBe('stale');
  });

  it('rejects with the abort and prepares nothing when cancelled after the rewrite was computed', async () => {
    const history = await seeded([createUserMessage('goal'), ai('answer')]);
    const before = history.getAll();
    const controller = new AbortController();
    const steps: string[] = [];

    const failure = await history
      .replaceIfUnchanged({
        expected: before,
        signal: controller.signal,
        rewrite: (current) => {
          const rewritten = replaceText(current, 1, 'answer rewritten');
          controller.abort();
          return rewritten;
        },
        prepareEffect: () => {
          steps.push('prepare');
          return undefined;
        },
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect({
      aborted: failure === controller.signal.reason,
      steps,
      same: history.getAll().every((entry, index) => entry === before[index]),
    }).toStrictEqual({ aborted: true, steps: [], same: true });
  });

  it('rolls back the prepared effect and keeps the history when cancelled while the effect publishes', async () => {
    const history = await seeded([createUserMessage('goal'), ai('answer')]);
    const before = history.getAll();
    const controller = new AbortController();
    const steps: string[] = [];

    const failure = await history
      .replaceIfUnchanged({
        expected: before,
        signal: controller.signal,
        rewrite: (current) => replaceText(current, 1, 'answer rewritten'),
        prepareEffect: () => ({
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
        }),
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect({
      aborted: failure === controller.signal.reason,
      steps,
      final: texts(history.getAll()),
    }).toStrictEqual({
      aborted: true,
      steps: ['publish', 'rollback'],
      final: ['goal', 'answer'],
    });
  });
});
