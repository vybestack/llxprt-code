/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { AnthropicRepairSource } from './anthropic-repair-source.js';
import { repairSettings } from './anthropic-stream-repair.test.js';

// Discovering repair candidates must not decode their text or tool arguments.
describe('native Anthropic call discovery', () => {
  const directory = useTempDir('anthropic-call-discovery-');
  it.each([40, 4000])(
    'discovers %s row call positions without payload reads',
    async (count) => {
      const session = await JournalSession.create(
        `${directory()}/${count}.llxj`,
        {
          journal: testJournalSeams().dependencies,
        },
      );
      try {
        await session.append(
          Array.from({ length: count }, (_, index): IContent => {
            if (index % 4 === 1)
              return {
                speaker: 'ai',
                blocks: [
                  {
                    type: 'tool_call',
                    id: `call_${index}`,
                    name: 'read',
                    parameters: { index },
                  },
                ],
              };
            if (index % 4 === 2)
              return {
                speaker: 'tool',
                blocks: [
                  {
                    type: 'tool_response',
                    callId: `call_${index - 1}`,
                    toolName: 'read',
                    result: 'result',
                  },
                ],
              };
            return {
              speaker: index % 4 === 0 ? 'human' : 'ai',
              blocks: [{ type: 'text', text: `answer ${index}` }],
            };
          }),
        );
        const pin = await session.store.snapshot();
        const query = await IndexedJournalRequestSnapshot.create(pin);
        try {
          const source = new AnthropicRepairSource(query, repairSettings);
          const positions: number[] = [];
          for await (const call of source.calls({
            start: 0,
            end: query.count - 1,
            slot: 'chain',
            role: 'assistant',
          })) {
            expect(call.id).toBe(`toolu_${call.unit}`);
            positions.push(call.unit);
          }
          expect(positions).toStrictEqual(
            Array.from({ length: count / 4 }, (_, index) => index * 4 + 1),
          );
          expect(source.work.unitReads).toBe(0);
        } finally {
          await query.close();
          await pin.close();
        }
      } finally {
        await session.close();
      }
    },
  );
});
