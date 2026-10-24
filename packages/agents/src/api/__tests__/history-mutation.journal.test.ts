/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  withNativeRecordingFixture,
  nativeRows,
  rowTexts,
  requireRecordingPath,
} from './helpers/native-session-fixture.js';

function content(text: string, speaker: IContent['speaker']): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

interface MutationCase {
  readonly name: string;
  readonly history: IContent[];
  readonly operation: 'clear' | 'restore';
  readonly turns: number;
  readonly remaining: number;
  readonly removed: number;
  readonly texts: string[];
}

const cases: readonly MutationCase[] = [
  {
    name: 'clear removes non-initial content and survives process restart',
    history: [
      content('A', 'human'),
      content('B', 'ai'),
      content('C', 'human'),
      content('D', 'ai'),
      content('E', 'human'),
      content('F', 'ai'),
    ],
    operation: 'clear',
    turns: 0,
    remaining: 2,
    removed: 4,
    texts: ['A', 'B'],
  },
  {
    name: 'clear preserves exactly the first human-led turn when human entries are consecutive',
    history: [
      content('first question', 'human'),
      content('second question', 'human'),
      content('second answer', 'ai'),
    ],
    operation: 'clear',
    turns: 0,
    remaining: 1,
    removed: 2,
    texts: ['first question'],
  },
  {
    name: 'clear leaves agent-only history unchanged when no human turn exists',
    history: [content('system response', 'ai'), content('tool result', 'tool')],
    operation: 'clear',
    turns: 0,
    remaining: 2,
    removed: 0,
    texts: ['system response', 'tool result'],
  },
  {
    name: 'restore removes last N human turns with tool-heavy content',
    history: [
      content('Q1', 'human'),
      content('A1', 'ai'),
      content('tool-result-1', 'tool'),
      content('Q2', 'human'),
      content('A2', 'ai'),
      content('tool-result-2', 'tool'),
      content('Q3', 'human'),
      content('A3', 'ai'),
    ],
    operation: 'restore',
    turns: 2,
    remaining: 3,
    removed: 5,
    texts: ['Q1', 'A1', 'tool-result-1'],
  },
  {
    name: 'restore 1 turn removes only the last human-led turn',
    history: [
      content('Q1', 'human'),
      content('A1', 'ai'),
      content('Q2', 'human'),
      content('A2', 'ai'),
    ],
    operation: 'restore',
    turns: 1,
    remaining: 2,
    removed: 2,
    texts: ['Q1', 'A1'],
  },
];

describe('durable native history mutations', () => {
  for (const fixture of cases) {
    it(`${fixture.name}`, async () => {
      await withNativeRecordingFixture(async ({ agent }) => {
        await agent.setHistory(fixture.history);
        await agent.session.setRecording({ enabled: true });
        const path = requireRecordingPath(agent.session.getRecording().path);
        const before = await nativeRows(path);
        const expected = before.slice(0, fixture.remaining);
        let removed: number;
        let remaining: IContent[];
        if (fixture.operation === 'clear') {
          await agent.session.clearHistory();
          remaining = await Array.fromAsync(agent.streamHistory());
          removed = before.length - remaining.length;
        } else {
          const result = await agent.session.restoreTurns(fixture.turns);
          removed = result.itemsRemoved;
          remaining = await Array.fromAsync(result.remainingHistory);
        }
        expect(removed).toBe(fixture.removed);
        expect(remaining).toStrictEqual(expected);
        const live = await Array.fromAsync(agent.streamHistory());
        expect(live).toHaveLength(fixture.remaining);
        expect(before.length - live.length).toBe(fixture.removed);
        expect(live).toStrictEqual(expected);
        expect(await nativeRows(path)).toStrictEqual(expected);
        await agent.session.setRecording({ enabled: false });
        await agent.session.resume('latest');
        const replay = await Array.fromAsync(agent.streamHistory());
        expect(replay).toHaveLength(fixture.remaining);
        expect(replay).toStrictEqual(expected);
        expect(rowTexts(replay)).toStrictEqual(fixture.texts);
      });
    });
  }

  it('rejects a checkpoint after a durable restore removes all history', async () => {
    await withNativeRecordingFixture(async ({ agent }) => {
      await agent.setHistory([content('only turn', 'human')]);
      await agent.session.setRecording({ enabled: true });
      const mutation = await agent.session.restoreTurns(1);
      expect(await Array.fromAsync(mutation.remainingHistory)).toStrictEqual(
        [],
      );
      await expect(agent.session.createCheckpoint('empty')).rejects.toThrow(
        'conversation has no content yet',
      );
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1.5, -1])(
    'rejects invalid turn count %s without changing the committed history',
    async (turns) => {
      await withNativeRecordingFixture(async ({ agent }) => {
        await agent.setHistory([content('Q1', 'human'), content('A1', 'ai')]);
        await agent.session.setRecording({ enabled: true });
        const path = requireRecordingPath(agent.session.getRecording().path);
        const before = await nativeRows(path);
        await expect(agent.session.restoreTurns(turns)).rejects.toThrow(
          'Turns to remove must be a non-negative integer',
        );
        expect(await Array.fromAsync(agent.streamHistory())).toStrictEqual(
          before,
        );
        await agent.session.setRecording({ enabled: false });
        await agent.session.resume('latest');
        expect(await Array.fromAsync(agent.streamHistory())).toStrictEqual(
          before,
        );
      });
    },
  );

  it('inactive recording leaves live history unchanged', async () => {
    await withNativeRecordingFixture(async ({ agent }) => {
      await agent.setHistory([
        content('A', 'human'),
        content('B', 'ai'),
        content('C', 'human'),
      ]);
      await agent.session.setRecording({ enabled: true });
      const path = requireRecordingPath(agent.session.getRecording().path);
      const original = await nativeRows(path);
      await agent.session.setRecording({ enabled: false });
      await expect(agent.session.clearHistory()).rejects.toThrow(
        'No active recording',
      );
      expect(await Array.fromAsync(agent.streamHistory())).toStrictEqual(
        original,
      );
    });
  });
});
