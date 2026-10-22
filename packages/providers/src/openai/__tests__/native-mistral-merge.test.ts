/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { operationFileCreates } from '../../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { appendFileSync } from 'node:fs';
import { generateDeterministicMistralId } from '@vybestack/llxprt-code-tools/ToolIdStrategy.js';
import { JournalSession } from '../../../../core/src/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '../../../../core/src/services/history/indexed-journal-request-snapshot.js';
import { testJournalSeams } from '../../../../core/src/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import { call } from '../../../../core/src/services/history/__tests__/support/normalization-cases.js';
import type { IContent } from '../../../../core/src/services/history/IContent.js';
import { multiIdSettings as settings } from './support/mistral-multi-id-cases.js';
import {
  plainChatLengthRegistration,
  planRequestChatMessages,
} from '../journal-chat-length.js';
import { nativeChatMessages } from '../native-chat-messages.js';
import { buildMessagesWithReasoning } from '../OpenAIRequestBuilder.js';
import {
  legacyUnitTokens,
  oldMistralUnitTokens,
} from './support/mistral-unit-token-oracle.js';

describe('Mistral simultaneous historical mapping changes', () => {
  const directory = useTempDir('mistral-merge-');
  it.each(
    [40, 4000].flatMap((size) =>
      [2, 17, 129].map((groups) => ({ size, groups })),
    ),
  )(
    'merges real occurrence queries once for $size rows and $groups changed historical IDs',
    async ({ size, groups }) => {
      const ids = Array.from({ length: groups }, (_, index) =>
        index === 0 ? 'toolu_alpha-1' : `toolu_group-${index}`,
      );
      const blockers = ids.map((id) => generateDeterministicMistralId(id, 0));
      const rows: readonly IContent[] = [
        { speaker: 'ai', blocks: blockers.map((id) => call(id, '')) },
        { speaker: 'ai', blocks: ids.map((id) => call(id)) },
        ...Array.from(
          { length: size },
          (_, index): IContent => ({
            speaker: 'ai',
            blocks: [
              call(ids[index % groups]),
              call(ids[(index + 1) % groups]),
            ],
          }),
        ),
      ];
      const projected: IContent = {
        speaker: 'ai',
        blocks: [
          ...blockers.map((id) => call(id, '')),
          { type: 'text', text: 'curated prefix' },
        ],
      };
      const tail: readonly IContent[] = [
        { speaker: 'ai', blocks: blockers.map((id) => call(id)) },
      ];
      const readCounter = { reads: 0 };
      const session = await JournalSession.create(`${directory()}/case.llxj`, {
        journal: testJournalSeams({ readCounter }, 1, false).dependencies,
      });
      try {
        await session.append(rows);
        await session.registerRowFormat(
          plainChatLengthRegistration(settings, legacyUnitTokens),
        );
        const pin = await session.store.snapshot();
        const entries = await Array.fromAsync(pin.entries());
        const request = await IndexedJournalRequestSnapshot.create(pin, tail, {
          label: entries[0].label,
          readChangedRow: async () => projected,
          header: (row) => row,
        });
        try {
          const resolver = await request.mistralForSnapshot(pin, 0);
          const before = pin.facts.lookups;
          const original = pin.facts.occurrence.bind(pin.facts);
          let occurrenceReads = 0;
          pin.facts.occurrence = async (id, kind, ordinal) => {
            occurrenceReads++;
            return original(id, kind, ordinal);
          };
          const readsBefore = readCounter.reads;
          const labels: bigint[] = [];
          const created = await operationFileCreates(async () => {
            for await (const label of resolver.affectedSources())
              labels.push(label);
          }, true);
          const queries = pin.facts.lookups - before;
          const physicalReads = readCounter.reads - readsBefore;
          pin.facts.occurrence = original;
          expect(created).toStrictEqual({ files: [], directories: [] });
          expect(occurrenceReads).toBe(size * 2 + groups);
          expect(physicalReads).toBeLessThanOrEqual(
            size * 20 + groups * 500 + 1000,
          );
          expect(labels).toStrictEqual(
            entries.slice(1).map((entry) => entry.label),
          );
          for (const id of ids) {
            expect(await pin.mistralMapping(id, 0)).toStrictEqual({
              id: generateDeterministicMistralId(id, 0),
              salt: 0,
            });
            expect(await resolver.resolve(id)).toStrictEqual({
              id: generateDeterministicMistralId(id, 1),
              salt: 1,
            });
          }
          const units = await Array.fromAsync(request.openReader());
          const plan = await planRequestChatMessages(
            pin,
            request,
            settings,
            0,
            '',
            legacyUnitTokens,
          );
          const parts: Uint8Array[] = [
            Buffer.from('[{"role":"system","content":""}'),
          ];
          for await (const part of nativeChatMessages(
            request.openReader(),
            settings,
            'none',
            plan.lastThinking,
            resolver,
          ))
            parts.push(part);
          parts.push(Buffer.from(']'));
          const expected = Buffer.from(
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
          expect(Buffer.concat(parts)).toStrictEqual(expected);
          expect(plan.bytes).toBe(expected.length);
          expect(plan.tokens).toBe(await oldMistralUnitTokens(units, 'none'));
          if (process.env.MISTRAL_MERGE_RECEIPT !== undefined)
            appendFileSync(
              process.env.MISTRAL_MERGE_RECEIPT,
              JSON.stringify({
                size,
                groups,
                queries,
                occurrenceReads,
                physicalReads,
                pid: process.pid,
              }) + '\n',
            );
          expect(queries).toBeLessThanOrEqual(size * 3 + groups * 40 + 100);
        } finally {
          await request.close();
          await pin.close();
        }
      } finally {
        await session.close();
      }
    },
  );
});
