/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
import { buildAgent } from '../api/__tests__/helpers/agentHarness.js';
import { sendHistoryTurn } from './__tests__/support/orchestrator-history-test-helpers.js';

async function requiredRow(
  rows: AsyncGenerator<IContent, void, unknown>,
): Promise<IContent> {
  const row = await rows.next();
  if (row.done === true) throw new Error('Missing restored row');
  return row.value;
}

async function assertRestoredValues(
  rows: AsyncGenerator<IContent, void, unknown>,
  stamped: IContent,
  fresh: IContent,
): Promise<void> {
  try {
    for (let index = 0; index < 2; index++) {
      const row = await requiredRow(rows);
      expect(row).toStrictEqual(stamped);
      expect(row.metadata?.chronology).not.toBe(stamped.metadata?.chronology);
    }
    const row = await requiredRow(rows);
    expect(row.speaker).toBe('ai');
    expect(row.blocks).toStrictEqual(fresh.blocks);
    expect(row.metadata?.model).toBeUndefined();
    expect(row.metadata?.providerBaseURL).toBeUndefined();
    expect(row.metadata?.chronology?.seq).toBe(2);
    expect((await rows.next()).done).toBe(true);
  } finally {
    await rows.return();
  }
}

async function assertRequestValues(
  history: HistoryService,
  stamped: IContent,
  fresh: IContent,
): Promise<void> {
  const pending: IContent = {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'reply plainly' }],
  };
  const expected = [stamped, stamped, fresh, pending];
  const request = await history.prepareCuratedForProviderSnapshot([pending]);
  try {
    expect(request.count).toBe(4);
    let index = 0;
    for await (const row of request.openReader()) {
      expect(row.speaker).toBe(expected[index].speaker);
      expect(row.blocks).toStrictEqual(expected[index].blocks);
      expect(row.metadata?.model).toBe(expected[index].metadata?.model);
      expect(row.metadata?.providerBaseURL).toBe(
        expected[index].metadata?.providerBaseURL,
      );
      index++;
    }
    expect(index).toBe(4);
  } finally {
    await request.close();
  }
}

describe('client source restored values', () => {
  it('preserves repeated frozen provenance and leaves imported AI unstamped through native request selection and send', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    const client = agent.agentClient;
    const stamped: IContent = Object.freeze<IContent>({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'saved reply' }],
      metadata: Object.freeze({
        model: 'saved-model',
        providerBaseURL: 'https://saved-provider.test',
        chronology: Object.freeze({
          seq: 1,
          userTurn: 1,
          step: 0,
          recordedAt: 0,
        }),
      }),
    });
    const fresh: IContent = Object.freeze<IContent>({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'imported reply' }],
    });
    async function* source(): AsyncGenerator<IContent, void, unknown> {
      yield stamped;
      yield stamped;
      yield fresh;
    }
    try {
      await client.startChat([]);
      const history = client.getHistoryService();
      if (history === null) throw new Error('Missing active history');
      const restore = forbidHistoryMaterializationForTest(
        history,
        'eager restored values',
      );
      try {
        await client.setHistoryFromSource(source());
        await client.restoreHistory([]);
        await assertRestoredValues(client.streamHistory(), stamped, fresh);
        await assertRequestValues(history, stamped, fresh);
        expect(await sendHistoryTurn(client)).toContain('a plain text reply');
        expect(stamped.metadata?.chronology?.seq).toBe(1);
        expect(fresh).not.toHaveProperty('metadata');
      } finally {
        restore();
      }
    } finally {
      await cleanup();
    }
  }, 120_000);
});
