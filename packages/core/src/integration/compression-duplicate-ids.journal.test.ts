/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { rawHistoryAfterCommit } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { collectJournalRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { curatedHistoryAfterCommit } from '@vybestack/llxprt-code-test-utils/core/curated-history-fixture.js';
import { createRecorderForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentConverters } from '../services/history/ContentConverters.js';
import { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';
import { encodeForProvider } from './__tests__/support/compression-wire-fixture.js';
type HistoryBackend = 'old' | 'journal';

function human(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function toolPair(id: string, index: number): IContent[] {
  return [
    {
      speaker: 'ai',
      blocks: [{ type: 'tool_call', id, name: 'glob', parameters: { index } }],
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: id,
          toolName: 'glob',
          result: { files: [`test-${index}.ts`] },
        },
      ],
    },
  ];
}

async function withHistory<T>(
  backend: HistoryBackend,
  action: (history: HistoryService) => Promise<T>,
): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'compression-ids-'));
  const recording = createRecorderForTest({
    chatsDir: root,
    sessionId: 'compression-ids',
  });
  const history = new HistoryService({});
  try {
    await history.attachJournal(recording, true);
    const result = await action(history);
    const raw = await rawHistoryAfterCommit(history);
    await recording.flush();
    await collectJournalRowsForAssertions(history, (saved) => {
      expect(saved).toStrictEqual(raw);
    });
    return result;
  } finally {
    await history.dispose();
    await recording.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

async function rebuild(
  history: HistoryService,
  kept: ReturnType<typeof encodeForProvider>,
  summary: string,
): Promise<void> {
  const converted = kept.map((row) =>
    ContentConverters.toIContent(row, history.getIdGeneratorCallback()),
  );
  await history.clear();
  history.add(human(summary));
  for (const row of converted) history.add(row, 'gemini-2.5-flash');
  const raw = await rawHistoryAfterCommit(history);
  expect(raw.map(({ speaker, blocks }) => ({ speaker, blocks }))).toStrictEqual(
    [human(summary), ...converted].map(({ speaker, blocks }) => ({
      speaker,
      blocks,
    })),
  );
}

function ids(
  rows: readonly IContent[],
  kind: 'tool_call' | 'tool_response',
): string[] {
  return rows.flatMap((row) =>
    row.blocks.flatMap((block) => {
      if (block.type === 'tool_call' && kind === 'tool_call') return [block.id];
      if (block.type === 'tool_response' && kind === 'tool_response')
        return [block.callId];
      return [];
    }),
  );
}

async function compressions(
  backend: HistoryBackend,
  count: number,
): Promise<string[]> {
  return withHistory(backend, async (history) => {
    history.add(human('Find some files'));
    for (const row of toolPair('hist_tool_c3ecb6205', 1)) history.add(row);
    history.add({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Found test-1.ts' }],
    });
    const bytes: string[] = [];
    const first = encodeForProvider(await curatedHistoryAfterCommit(history));
    expect(first.length).toBe(4);
    await rebuild(
      history,
      first.slice(1),
      'Previous context: User asked to find files',
    );
    bytes.push(
      JSON.stringify(
        encodeForProvider(await curatedHistoryAfterCommit(history)),
      ),
    );
    let expected = 'hist_tool_c3ecb6205';
    if (count === 2) {
      expected = 'hist_tool_def456';
      for (const row of toolPair(expected, 2)) history.add(row);
      const next = encodeForProvider(await curatedHistoryAfterCommit(history));
      await rebuild(history, next.slice(-2), 'Double compressed context');
      bytes.push(
        JSON.stringify(
          encodeForProvider(await curatedHistoryAfterCommit(history)),
        ),
      );
    }
    const raw = await rawHistoryAfterCommit(history);
    expect(ids(raw, 'tool_call')).toStrictEqual([expected]);
    expect(ids(raw, 'tool_response')).toStrictEqual([expected]);
    expect(raw.length).toBe(count === 1 ? 4 : 3);
    return bytes;
  });
}

async function repeatedIds(backend: HistoryBackend): Promise<string> {
  return withHistory(backend, async (history) => {
    history.add(human('Find both sets'));
    for (const index of [1, 2]) {
      for (const row of toolPair('hist_tool_repeated', index)) history.add(row);
    }
    const original = encodeForProvider(
      await curatedHistoryAfterCommit(history),
    );
    await rebuild(history, original.slice(1), 'Both calls still matter');
    const raw = await rawHistoryAfterCommit(history);
    expect(raw.length).toBe(5);
    expect(ids(raw, 'tool_call')).toStrictEqual([
      'hist_tool_repeated',
      'hist_tool_repeated',
    ]);
    expect(ids(raw, 'tool_response')).toStrictEqual([
      'hist_tool_repeated',
      'hist_tool_repeated',
    ]);
    return JSON.stringify(
      encodeForProvider(await curatedHistoryAfterCommit(history)),
    );
  });
}

describe('persisted compression tool identities and provider bytes', () => {
  it.each([1, 2])(
    'preserves exact saved rows and old/native provider bytes after %i compression stages',
    async (count) => {
      const old = await compressions('old', count);
      const native = await compressions('journal', count);
      expect(native).toStrictEqual(old);
    },
  );
  it('preserves both occurrences of a repeated id and their distinct payloads', async () => {
    const old = await repeatedIds('old');
    const native = await repeatedIds('journal');
    expect(native).toBe(old);
  });
});
