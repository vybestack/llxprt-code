/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalSession } from '../services/history/journalSession.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import type { ToolRankingPolicy } from './tool-ranking-fill.js';

const policy: ToolRankingPolicy = {
  revision: 'stored-marker:1',
  measure: async () => ({ score: 100, saving: 99 }),
};

describe('tool rewrite stored marker invalidation facts', () => {
  const directory = useTempDir('ranking-stored-marker-');
  it('tracks stored markers without a selectable Responses parent, including empty rows and appends', async () => {
    const session = await JournalSession.create(
      join(directory(), 'history.llxj'),
    );
    try {
      await session.append([
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call',
              toolName: 'read',
              result: 'result',
            },
          ],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'thinking', thought: 'reason' }],
          metadata: { responsesStored: true },
        },
        { speaker: 'human', blocks: [{ type: 'text', text: 'next' }] },
      ]);
      await session.store.commit([{ kind: 'toolRanking', policy }]);
      const before = await session.store.snapshot();
      try {
        expect(
          (await (await before.toolRanking(policy.revision)).header())
            .lastParent,
        ).toBe(1);
        await session.append([
          { speaker: 'ai', blocks: [], metadata: { responsesStored: true } },
        ]);
        const after = await session.store.snapshot();
        try {
          expect(
            (await (await after.toolRanking(policy.revision)).header())
              .lastParent,
          ).toBe(3);
          expect(
            (await (await before.toolRanking(policy.revision)).header())
              .lastParent,
          ).toBe(1);
        } finally {
          await after.close();
        }
      } finally {
        await before.close();
      }
    } finally {
      await session.close();
    }
  });
});
