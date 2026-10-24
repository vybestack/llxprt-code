/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { retainedShapeEntries } from './__tests__/support/token-usage-source-fixture.js';
import { TokenUsageLogger } from './TokenUsageLogger.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { JournalProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/journal-provider-request.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

function send(logger: TokenUsageLogger, turn: number): void {
  logger.getShapeMemory().recordRequestShape({
    requestContents: [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: `call-${turn}`,
            toolName: 'read_file',
            result: `result ${turn}`,
          },
        ],
        metadata: { id: `row-${turn}` },
      },
    ],
    tools: [],
    instructionsText: undefined,
    countTokens: (text) => text.length,
  });
}

function retainedEntries(logger: TokenUsageLogger): number {
  const memory = logger.getShapeMemory();
  return retainedShapeEntries(memory);
}

describe('token usage session retention', () => {
  it('retains no additional per-row entries between 64 and 4096 turns', () => {
    const logger = new TokenUsageLogger(true, undefined);
    for (let turn = 0; turn < 64; turn++) send(logger, turn);
    const early = retainedEntries(logger);
    for (let turn = 64; turn < 4096; turn++) send(logger, turn);
    expect(retainedEntries(logger)).toBe(early);
  });
});

async function sendJournal(
  logger: TokenUsageLogger,
  session: JournalSession,
  tail: readonly IContent[] = [],
) {
  const rows = await JournalProviderRequestSnapshot.create(
    await session.store.snapshot(),
    tail,
    {},
  );
  try {
    return await logger.getShapeMemory().recordSourceRequestShape({
      requestRows: rows,
      tools: [],
      instructionsText: undefined,
      countTokens: (text) => text.length,
    });
  } finally {
    await rows.close();
  }
}

describe('journal token usage session state', () => {
  it('uses the stored count of a carried row on every send', async () => {
    let measured = 0;
    const session = await JournalSession.createUnlinked({
      eagerTokenUsageFacts: true,
      tokenUsageCountTokens: (text) => {
        measured++;
        return text.length;
      },
    });
    const logger = new TokenUsageLogger(true, undefined);
    try {
      await session.append([
        {
          speaker: 'human',
          metadata: { id: 'carried' },
          blocks: [{ type: 'text', text: 'carried row' }],
        },
      ]);
      const first = await sendJournal(logger, session);
      const second = await sendJournal(logger, session);
      expect(first.historyTokens).toBe(11);
      expect(second.historyTokens).toBe(first.historyTokens);
      expect(measured).toBe(1);
      expect(retainedEntries(logger)).toBe(0);
    } finally {
      await session.close();
    }
  });

  it('carries a pending result after it is appended to the journal', async () => {
    const session = await JournalSession.createUnlinked({
      eagerTokenUsageFacts: true,
      tokenUsageCountTokens: (text) => text.length,
    });
    const logger = new TokenUsageLogger(true, undefined);
    const pending: IContent = {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'pending',
          toolName: 'read_file',
          result: 'pending result',
        },
      ],
    };
    try {
      const first = await sendJournal(logger, session, [pending]);
      await session.append([pending]);
      const second = await sendJournal(logger, session);
      expect(first.newToolResultTokens).toBeGreaterThan(0);
      expect(second.newToolResultTokens).toBe(0);
      expect(second.carriedToolResultTokens).toBe(first.newToolResultTokens);
    } finally {
      await session.close();
    }
  });
});
