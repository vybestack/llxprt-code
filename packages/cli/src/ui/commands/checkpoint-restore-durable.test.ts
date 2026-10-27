/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  accountingFactory,
  deferred,
} from '@vybestack/llxprt-code-core/services/history/__tests__/support/token-accounting-stream-test-helpers.js';
import {
  withCheckpoint,
  checkpointUiHistory,
  checkpointTool,
  gateJournalRowCommit,
} from '../hooks/agentStream/checkpoint-disk-test-helpers.js';
import { restoreCommand } from './restoreCommand.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';

function gateDurableWrite(
  gate: ReturnType<typeof deferred>,
  entered: ReturnType<typeof deferred>,
): void {
  gateJournalRowCommit('acknowledged checkpoint row', async () => {
    entered.resolve();
    await gate.promise;
  });
}

async function pausedRestore(
  cancel: boolean,
  active = false,
): Promise<boolean> {
  return withCheckpoint(1, active, async (fixture, dir) => {
    const tokenizer = accountingFactory((text) => text.length);
    fixture.history.setTokenizerFactory(tokenizer);
    // A restore into an inactive chat builds a replacement history from the
    // client's bound tokenization, so the client must count the same way.
    fixture.client.bindTokenization?.(tokenizer.getTokenizer, tokenizer);
    fixture.history.setBaseTokenOffset(0);
    await fixture.history.recalculateTokens();
    const previousTokens = 2050;
    expect(fixture.history.getTotalTokens()).toBe(previousTokens);
    const gate = deferred();
    const entered = deferred();
    const abort = new AbortController();
    const row = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'acknowledged checkpoint row' }],
    };
    await writeFile(
      join(dir, 'restore.json'),
      JSON.stringify({
        history: checkpointUiHistory,
        clientHistory: [row],
        toolCall: checkpointTool.request,
      }),
    );
    const context = createMockCommandContext({
      services: { agent: { agentClient: fixture.client } },
    });
    context.signal = abort.signal;
    if (context.services.config === null)
      throw new Error('Missing fixture runtime');
    const runtime = {
      ...context.services.config,
      projectCheckpointsDir: dir,
      getCheckpointingEnabled: () => true,
    };
    context.services.config = runtime;
    let uiPublished = false;
    context.ui.clear = () => {
      uiPublished = true;
    };
    gateDurableWrite(gate, entered);
    let completed = false;
    const restoring = Promise.resolve(
      restoreCommand(runtime)?.action?.(context, 'restore'),
    ).then((result) => {
      completed = true;
      return result;
    });
    try {
      await entered.promise;
      expect(completed).toBe(false);
      expect(uiPublished).toBe(false);
      expect(fixture.history.getTotalTokens()).toBe(previousTokens);
      if (cancel) abort.abort(new Error('cancel checkpoint acknowledgement'));
      gate.resolve();
      const result = await restoring;
      expect(result?.type).toBe(cancel ? 'message' : 'tool');
      if (cancel) expect(fixture.history.getTotalTokens()).toBe(previousTokens);
      else
        // A restore into an inactive chat publishes a replacement journal and
        // disposes the fixture's original one, so read the live history.
        expect(fixture.client.getHistoryService()?.getTotalTokens()).toBe(
          'acknowledged checkpoint row'.length,
        );
      return uiPublished;
    } finally {
      gate.resolve();
      await restoring;
      vi.restoreAllMocks();
    }
  });
}

describe('real CLI checkpoint durable publication', () => {
  it.each([false, true])(
    'does not expose history or UI before durable acknowledgement, cancelled=%s',
    async (cancel) => {
      expect(await pausedRestore(cancel)).toBe(!cancel);
    },
    180000,
  );

  it.each([false, true])(
    'does not expose active history or UI before durable acknowledgement, cancelled=%s',
    async (cancel) => {
      expect(await pausedRestore(cancel, true)).toBe(!cancel);
    },
    180000,
  );
});
