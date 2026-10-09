/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { ObservedHistory } from './streamprocessor-source-fixture.js';
import { openRequestContentsSnapshot } from './streamRequestHelpers.js';

function text(speaker: IContent['speaker'], value: string): IContent {
  return { speaker, blocks: [{ type: 'text', text: value }] };
}
describe('bounded request selection preserves semantic pending membership', () => {
  it('uses normalized membership rather than treating the first pending row as an arbitrary suffix', async () => {
    const history = new ObservedHistory();
    history.add(text('human', 'old prompt'));
    history.add(text('ai', 'old reply'));
    await history.waitForTokenUpdates();
    const pending: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_weather',
            name: 'weather',
            parameters: { city: 'Oslo' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_weather',
            toolName: 'weather',
            result: { degrees: 6 },
          },
        ],
      },
      text('human', 'pending question'),
    ];
    const override: AsyncIterable<IContent> = {
      async *[Symbol.asyncIterator]() {
        yield text('human', 'semantic selected history');
        yield text('ai', 'selected reply');
      },
    };
    const snapshot = await openRequestContentsSnapshot(
      pending,
      history,
      {},
      override,
    );
    try {
      const selected: Array<{
        speaker: string;
        pending: boolean;
        text: string[];
      }> = [];
      let index = 0;
      for await (const row of snapshot.openReader())
        selected.push({
          speaker: row.speaker,
          pending: snapshot.isPending(index++),
          text: row.blocks.flatMap((block) =>
            block.type === 'text' ? [block.text] : [],
          ),
        });
      expect(
        selected.filter((row) => !row.pending).flatMap((row) => row.text),
      ).toStrictEqual(['semantic selected history', 'selected reply']);
      expect(
        selected.filter((row) => row.pending).map((row) => row.speaker),
      ).toStrictEqual(['ai', 'tool', 'human']);
      expect(selected.flatMap((row) => row.text)).not.toContain('old prompt');
      expect(snapshot.pending.inputCount).toBe(3);
    } finally {
      snapshot.close();
      history.dispose();
    }
    expect(history.owners.every((owner) => owner.closed)).toBe(true);
  });
});

describe('source selection cancellation', () => {
  it('does not create a standing disk selection after an already-aborted request', async () => {
    const history = new ObservedHistory();
    const controller = new AbortController();
    controller.abort(new Error('selection cancelled'));
    try {
      expect(() =>
        openRequestContentsSnapshot(text('human', 'pending'), history, {
          signal: controller.signal,
        }),
      ).toThrow('selection cancelled');
      expect(history.owners).toHaveLength(0);
    } finally {
      history.dispose();
    }
  });
});
