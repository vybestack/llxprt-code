/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { anthropicRepairFactIndex } from './anthropic-repair-fact-writer.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { encodeContentRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { withAnthropicStreamRepair } from './anthropic-stream-repair.js';
import { emittedCandidate } from './message-table/__tests__/support/wireBuilderHarness.js';

export const repairSettings: RowFormatSettings = {
  formatId: 'anthropic',
  formatRev: 1,
  model: 'claude-sonnet-4',
  endpoint: 'https://api.anthropic.com',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: true,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: true,
  unsupportedMedia: 'notice',
  outputLimits: null,
  anthropic: { cache: 'off', imageBudget: null },
};

describe('native Anthropic stream repairs', () => {
  const directory = useTempDir('anthropic-stream-repair-');
  it('drops the orphan result of a non-AI call before finishing actual wire messages', async () => {
    const rows: readonly IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'question' },
          { type: 'tool_call', id: 'human-call', name: 'tool', parameters: {} },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'human-call',
            toolName: 'tool',
            result: 'orphan',
          },
        ],
      },
    ];
    const session = await JournalSession.create(`${directory()}/repair.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await session.store.commit([
        {
          kind: 'replace',
          rows: rows.map((row) => encodeContentRow(row, { owner: 0 })),
        },
        {
          kind: 'factIndex',
          registration: anthropicRepairFactIndex(repairSettings),
        },
      ]);
      const pin = await session.store.snapshot();
      const query = await IndexedJournalRequestSnapshot.create(pin);
      try {
        const normalized: IContent[] = [];
        for await (const row of query.openReader()) normalized.push(row);
        const expected = await emittedCandidate(
          normalized,
          {
            reasoningEnabled: true,
            currentModel: repairSettings.model,
            currentBaseURL: repairSettings.endpoint,
          },
          {},
        );
        await withAnthropicStreamRepair(
          query,
          repairSettings,
          {},
          async (engine) => {
            let actual = '';
            for await (const chunk of engine.serialize()) actual += chunk;
            expect(actual).toBe(expected);
            expect((await engine.measure()).bytes).toBe(
              Buffer.byteLength(expected),
            );
          },
        );
      } finally {
        await query.close();
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });
});
