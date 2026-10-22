/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { appendFileSync } from 'node:fs';
import { JournalSession } from '../../../../core/src/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '../../../../core/src/services/history/indexed-journal-request-snapshot.js';
import { testJournalSeams } from '../../../../core/src/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import { RECORD_KIND } from '../../../../core/src/journal/recordKinds.js';
import { oldTailUnits } from '../../../../core/src/services/history/__tests__/support/tail-query-oracle.js';
import { buildMessagesWithReasoning } from '../OpenAIRequestBuilder.js';
import { operationFileCreates } from '../../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import {
  multiIdCase,
  multiIdSettings as settings,
} from './support/mistral-multi-id-cases.js';
import {
  plainChatLengthRegistration,
  planRequestChatMessages,
} from '../journal-chat-length.js';
import {
  legacyUnitTokens,
  oldMistralUnitTokens,
} from './support/mistral-unit-token-oracle.js';

describe('Mistral multi-ID warm physical reads', () => {
  const directory = useTempDir('mistral-multi-cost-');
  it.each(
    [40, 4000].flatMap((size) =>
      [false, true].map((dense) => ({ size, dense })),
    ),
  )(
    'charges actual reads and conversions over $size rows/dense=$dense',
    async ({ size, dense }) => {
      const seams = testJournalSeams({}, 1, false);
      let enabled = false;
      let preads = 0;
      let bytes = 0;
      let rowlens = 0;
      let holders = 0;
      let unaffected = 0;
      const session = await JournalSession.create(`${directory()}/cost.llxj`, {
        journal: {
          ...seams.dependencies,
          open: async (path, flags) => {
            const file = await seams.dependencies.open(path, flags);
            return {
              ...file,
              read: async (buffer, offset, length, position) => {
                const result = await file.read(
                  buffer,
                  offset,
                  length,
                  position,
                );
                if (enabled) {
                  preads++;
                  bytes += result.bytesRead;
                  if (
                    result.bytesRead >= 20 &&
                    buffer[offset] === RECORD_KIND.LENS &&
                    buffer[offset + 2] === 0 &&
                    buffer[offset + 3] === 0
                  )
                    rowlens++;
                }
                return result;
              },
            };
          },
        },
      });
      async function measure(messages: readonly unknown[]): Promise<number> {
        const text = JSON.stringify(messages);
        if (text.includes('reason-')) holders++;
        if (text.includes('unaffected-')) unaffected++;
        return legacyUnitTokens(messages);
      }
      const input = multiIdCase(size, dense);
      const units = await oldTailUnits(input.rows, input.tail);
      const expectedBytes = Buffer.byteLength(
        JSON.stringify([
          { role: 'system', content: '' },
          ...buildMessagesWithReasoning(
            [...units],
            {
              invocation: {
                ephemerals: { 'reasoning.includeInContext': true },
              },
            },
            'mistral',
            undefined,
          ),
        ]),
      );
      const expectedTokens = await oldMistralUnitTokens(units, 'none');
      try {
        await session.append(input.rows);
        await session.registerRowFormat(
          plainChatLengthRegistration(settings, measure),
        );
        const pin = await session.store.snapshot();
        try {
          const before = pin.facts.lookups;
          holders = 0;
          unaffected = 0;
          enabled = true;
          const created = await operationFileCreates(async () => {
            const request = await IndexedJournalRequestSnapshot.create(
              pin,
              input.tail,
            );
            try {
              const plan = await planRequestChatMessages(
                pin,
                request,
                settings,
                0,
                '',
                measure,
              );
              expect(plan.bytes).toBe(expectedBytes);
              expect(plan.tokens).toBe(expectedTokens);
            } finally {
              await request.close();
            }
          }, true);
          enabled = false;
          const affected = dense ? size : 4;
          const receipt = {
            size,
            dense,
            affected,
            preads,
            bytes,
            rowlens,
            holders,
            unaffected,
            queries: pin.facts.lookups - before,
            window: pin.rowWindowStats,
            pid: process.pid,
          };
          if (process.env.MISTRAL_MULTI_COST_RECEIPT !== undefined)
            appendFileSync(
              process.env.MISTRAL_MULTI_COST_RECEIPT,
              JSON.stringify(receipt) + '\n',
            );
          expect(created).toStrictEqual({ files: [], directories: [] });
          expect(holders).toBe(affected);
          expect(unaffected).toBe(0);
          expect(preads).toBeLessThanOrEqual(affected * 15 + 600);
          expect(bytes).toBeLessThanOrEqual(affected * 8192 + 2 * 1024 * 1024);
          expect(rowlens).toBeLessThanOrEqual(20);
          expect(pin.rowWindowStats?.peakRetainedBytes).toBeLessThanOrEqual(
            32768,
          );
          expect(pin.rowWindowStats?.peakTransientBytes).toBeLessThanOrEqual(
            49152,
          );
        } finally {
          await pin.close();
        }
      } finally {
        await session.close();
      }
    },
  );
});
