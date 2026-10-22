/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from '../../../../core/src/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '../../../../core/src/services/history/indexed-journal-request-snapshot.js';
import { testJournalSeams } from '../../../../core/src/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import { oldTailUnits } from '../../../../core/src/services/history/__tests__/support/tail-query-oracle.js';
import {
  multiIdCase,
  multiIdSettings as settings,
} from './support/mistral-multi-id-cases.js';
import {
  plainChatLengthRegistration,
  planRequestChatMessages,
} from '../journal-chat-length.js';
import { nativeChatMessages } from '../native-chat-messages.js';
import { buildMessagesWithReasoning } from '../OpenAIRequestBuilder.js';
import {
  legacyUnitTokens,
  oldMistralUnitTokens,
  type MistralStrip,
} from './support/mistral-unit-token-oracle.js';

describe('Mistral multi-ID pending replay', () => {
  const directory = useTempDir('mistral-multi-id-');
  it.each(
    [2, 17, 129].flatMap((groups) =>
      (['none', 'all', 'allButLast'] satisfies MistralStrip[]).map((strip) => ({
        groups,
        strip,
      })),
    ),
  )(
    'matches independent old units, mapper and mandatory token oracle under $groups groups/$strip',
    async ({ groups, strip }) => {
      const input = multiIdCase(Math.max(12, groups * 2), true, groups);
      const session = await JournalSession.create(`${directory()}/case.llxj`, {
        journal: testJournalSeams({}, 1, false).dependencies,
      });
      try {
        await session.append(input.rows);
        await session.registerRowFormat(
          plainChatLengthRegistration(settings, legacyUnitTokens),
        );
        const pin = await session.store.snapshot();
        const request = await IndexedJournalRequestSnapshot.create(
          pin,
          input.tail,
        );
        try {
          const units = await oldTailUnits(input.rows, input.tail);
          const selected = (
            { none: 0, all: 1, allButLast: 2 } satisfies Record<
              MistralStrip,
              0 | 1 | 2
            >
          )[strip];
          const plan = await planRequestChatMessages(
            pin,
            request,
            settings,
            selected,
            '',
            legacyUnitTokens,
          );
          const resolver = await request.mistralForSnapshot(pin, 0);
          const parts: Uint8Array[] = [
            Buffer.from('[{"role":"system","content":""}'),
          ];
          for await (const part of nativeChatMessages(
            request.openReader(),
            settings,
            strip,
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
                    ephemerals: {
                      'reasoning.includeInContext': true,
                      'reasoning.stripFromContext': strip,
                    },
                  },
                },
                'mistral',
                undefined,
              ),
            ]),
          );
          expect(Buffer.concat(parts)).toStrictEqual(expected);
          expect(plan.bytes).toBe(expected.length);
          expect(plan.tokens).toBe(await oldMistralUnitTokens(units, strip));
          const affected: bigint[] = [];
          for await (const label of resolver.affectedSources())
            affected.push(label);
          expect(affected.length).toBeGreaterThanOrEqual(12);
          expect(affected).toStrictEqual(
            [...new Set(affected)].sort((a, b) => (a < b ? -1 : Number(a > b))),
          );
          expect((await pin.mistralMapping('toolu_alpha-1', 0))?.salt).toBe(1);
          expect(
            await request.mistralMapping('toolu_alpha-1', 0),
          ).toStrictEqual(await pin.mistralMapping('toolu_alpha-1', 0));
          for (const id of input.ids) {
            expect((await pin.mistralMapping(id, 0))?.salt).toBe(1);
            expect(await request.mistralMapping(id, 0)).toStrictEqual(
              await pin.mistralMapping(id, 0),
            );
          }
        } finally {
          await request.close();
          await pin.close();
        }
      } finally {
        await session.close();
      }
    },
  );
  it.each([40, 4000])(
    'walks affected holder ordinals once over %s dense rows',
    async (size) => {
      const input = multiIdCase(size, true);
      const session = await JournalSession.create(`${directory()}/cost.llxj`, {
        journal: testJournalSeams({}, 1, false).dependencies,
      });
      try {
        await session.append(input.rows);
        await session.registerRowFormat(
          plainChatLengthRegistration(settings, legacyUnitTokens),
        );
        const pin = await session.store.snapshot();
        const request = await IndexedJournalRequestSnapshot.create(
          pin,
          input.tail,
        );
        try {
          const resolver = await request.mistralForSnapshot(pin, 0);
          const before = pin.facts.lookups;
          let count = 0;
          for await (const _label of resolver.affectedSources()) count++;
          expect(count).toBeGreaterThanOrEqual(size);
          expect(pin.facts.lookups - before).toBeLessThanOrEqual(
            size * 5 + 150,
          );
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
