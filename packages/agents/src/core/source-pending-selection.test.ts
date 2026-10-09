/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { sourceBeforeModelHook } from './source-before-model-hook.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';

const root = sourceRootSetup();
const pending: IContent = {
  speaker: 'tool',
  blocks: [
    {
      type: 'tool_response',
      callId: 'earlier-call',
      toolName: 'read_file',
      result: { semanticSuffix: 'Preserve the complete pending response.' },
      isComplete: true,
    },
  ],
};

async function selection(signal?: AbortSignal) {
  const history = new HistoryService();
  history.add({
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: 'earlier-call',
        name: 'read_file',
        parameters: {},
      },
    ],
  });
  history.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'History after the earlier tool call.' }],
  });
  await history.waitForTokenUpdates();
  const snapshot = await history.prepareCuratedForProviderSnapshot([pending], {
    root: root(),
    signal,
  });
  const source = await sourceBeforeModelHook({
    config: undefined,
    snapshot,
    pending,
    model: 'gpt-5.6',
    tools: undefined,
    signal,
    log: () => undefined,
  });
  return { history, snapshot, source };
}

function pendingRows(
  source: Awaited<ReturnType<typeof sourceBeforeModelHook>>,
): ProviderRequestRows {
  const pending = source.pendingSelection;
  if (pending === undefined)
    throw new Error('Source dropped its pending selection');
  expect(pending.kind).toBe('provider-output-membership');
  return pending.rows;
}

async function collect(rows: ProviderRequestRows): Promise<IContent[]> {
  const result: IContent[] = [];
  for await (const row of rows.openReader()) result.push(row);
  return result;
}

describe('borrowed source pending selection', () => {
  it('selects normalized pending membership rather than a suffix after reordering', async () => {
    const setup = await selection();
    try {
      expect(setup.snapshot.pending.firstOutputIndex).toBe(1);
      expect(setup.snapshot.isPending(2)).toBe(false);
      const rows = pendingRows(setup.source);
      expect(rows.count).toBe(1);
      const expected: IContent[] = [
        {
          speaker: 'tool',
          blocks: pending.blocks,
          metadata: { synthetic: true, reason: 'reordered_tool_responses' },
        },
      ];
      expect(await collect(rows)).toStrictEqual(expected);
      const reread = await collect(rows);
      expect(reread).toHaveLength(1);
      expect(reread[0].blocks).toStrictEqual(pending.blocks);
      expect(setup.source.count).toBe(3);
    } finally {
      await setup.source.close();
      setup.history.dispose();
    }
  });

  it('leaves the enclosing source usable after a pending reader returns', async () => {
    const setup = await selection();
    try {
      const reader = pendingRows(setup.source).openReader();
      expect((await reader.next()).done).toBe(false);
      await reader.return();
      expect(await collect(setup.source)).toHaveLength(3);
      await setup.source.close();
      await expect(reader.next()).resolves.toMatchObject({ done: true });
      await expect(
        pendingRows(setup.source).openReader().next(),
      ).rejects.toThrow('Provider request snapshot is closed');
    } finally {
      await setup.source.close();
      setup.history.dispose();
    }
  });

  it('cancels pending readers with their enclosing snapshot', async () => {
    const controller = new AbortController();
    const setup = await selection(controller.signal);
    try {
      const reader = pendingRows(setup.source).openReader();
      expect((await reader.next()).done).toBe(false);
      controller.abort(new Error('pending owner aborted'));
      await expect(reader.next()).rejects.toThrow('pending owner aborted');
      await expect(collect(setup.source)).rejects.toThrow(
        'pending owner aborted',
      );
    } finally {
      await setup.source.close();
      setup.history.dispose();
    }
  });
});
