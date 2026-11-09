/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * transformAll reads the history inside the mutation queue. Callers that must
 * decide from the latest history and replace it in one step (such as the
 * rollback of a failed compression in the agents package) rely on this:
 * every write queued before the transform has committed when it runs, and a
 * transform that throws commits nothing.
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

describe('HistoryService.transformAll', () => {
  it('sees entries committed by writes queued before it', async () => {
    const history = new HistoryService();
    history.add(createUserMessage('first'));
    const queued = history.addBatch([createUserMessage('queued batch')]);
    let seen: string[] = [];

    await history.transformAll((current) => {
      seen = texts(current);
      return [...current, createUserMessage('from transform')];
    });
    await queued;

    expect({ seen, final: texts(history.getAll()) }).toStrictEqual({
      seen: ['first', 'queued batch'],
      final: ['first', 'queued batch', 'from transform'],
    });
  });

  it('commits nothing when the transform throws and keeps the queue usable', async () => {
    const history = new HistoryService();
    history.add(createUserMessage('first'));

    const failure = await history
      .transformAll(() => {
        throw new Error('no change wanted');
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    await history.addBatch([createUserMessage('after failure')]);

    expect({
      message: failure instanceof Error ? failure.message : undefined,
      final: texts(history.getAll()),
    }).toStrictEqual({
      message: 'no change wanted',
      final: ['first', 'after failure'],
    });
  });
});
