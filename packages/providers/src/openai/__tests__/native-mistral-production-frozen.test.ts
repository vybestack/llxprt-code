/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../../../core/src/journal/versionSnapshot.js';
import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { JournalSession } from '../../../../core/src/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '../../../../core/src/services/history/indexed-journal-request-snapshot.js';
import { testJournalSeams } from '../../../../core/src/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import {
  unitCase,
  UNIT_CASE_COUNT,
} from '../../../../core/src/services/history/__tests__/support/normalization-cases.js';
import { oldTailUnits } from '../../../../core/src/services/history/__tests__/support/tail-query-oracle.js';
import { digest } from '../../../../core/src/services/history/__tests__/support/normalization-oracle.js';
import { encodeContentRow } from '../../../../core/src/services/history/journalRowCodec.js';
import type { RowFormatSettings } from '../../../../core/src/journal/rowFormat.js';
import { requestFormatSlot } from '../../../../core/src/services/history/native-provider-format.js';
import {
  plainChatLengthRegistration,
  planRequestChatMessages,
  PLAIN_CHAT_FORMAT_REV,
} from '../journal-chat-length.js';
import { nativeChatMessages } from '../native-chat-messages.js';
import { mistralRowIds } from '../native-mistral-row.js';
import { buildMessagesWithReasoning } from '../OpenAIRequestBuilder.js';
import {
  legacyUnitTokens,
  oldMistralUnitTokens,
  type MistralStrip,
} from './support/mistral-unit-token-oracle.js';

const frozenRecord = z.object({
  inputHash: z.string(),
  outputHash: z.string(),
});
const settings: RowFormatSettings = {
  formatId: 'openai-chat:mistral',
  formatRev: PLAIN_CHAT_FORMAT_REV,
  model: 'mistral',
  endpoint: 'https://example.test/v1',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: false,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: false,
  unsupportedMedia: 'notice',
  outputLimits: null,
  chat: { includeInContext: true, toolFormat: 'mistral' },
};

async function emittedMessages(
  request: IndexedJournalRequestSnapshot,
  pin: VersionSnapshot,
  lastThinking: number,
  strip: MistralStrip,
): Promise<Buffer> {
  const resolver = await request.mistralForSnapshot(
    pin,
    requestFormatSlot(pin, settings),
  );
  const chunks: Uint8Array[] = [Buffer.from('[{"role":"system","content":""}')];
  for await (const chunk of nativeChatMessages(
    request.openReader(),
    settings,
    strip,
    lastThinking,
    mistralRowIds(resolver),
  ))
    chunks.push(chunk);
  chunks.push(Buffer.from(']'));
  return Buffer.concat(chunks);
}

describe('Mistral production stored planner and native emitter', () => {
  const directory = useTempDir('native-mistral-production-');
  it.each(['none', 'all', 'allButLast'] satisfies MistralStrip[])(
    'matches old bytes, lengths and per-unit tokens for all 5000 immutable inputs under %s',
    async (strip) => {
      const selected = (
        { none: 0, all: 1, allButLast: 2 } satisfies Record<
          MistralStrip,
          0 | 1 | 2
        >
      )[strip];
      const lines = (
        await readFile(
          new URL(
            '../../../../core/src/services/history/__tests__/fixtures/normalization-units.jsonl',
            import.meta.url,
          ),
          'utf8',
        )
      )
        .trimEnd()
        .split('\n');
      expect(lines.length).toBe(UNIT_CASE_COUNT);
      const session = await JournalSession.create(`${directory()}/all.llxj`, {
        journal: testJournalSeams({}, 1, false).dependencies,
      });
      let accepted = 0;
      try {
        await session.store.commit([
          {
            kind: 'format',
            registration: plainChatLengthRegistration(
              settings,
              async (messages) => legacyUnitTokens(messages),
            ),
          },
        ]);
        for (let seed = 0; seed < UNIT_CASE_COUNT; seed++) {
          const input = unitCase(seed);
          const frozen = frozenRecord.parse(JSON.parse(lines[seed]));
          expect(digest(input)).toBe(frozen.inputHash);
          const units = await oldTailUnits(input.rows, input.tail);
          expect(digest(units)).toBe(frozen.outputHash);
          await session.store.commit([
            {
              kind: 'replace',
              rows: input.rows.map((row) =>
                encodeContentRow(row, { owner: 0 }),
              ),
            },
          ]);
          const pin = await session.store.snapshot();
          const request = await IndexedJournalRequestSnapshot.create(
            pin,
            input.tail,
          );
          try {
            const plan = await planRequestChatMessages(
              pin,
              request,
              settings,
              selected,
              '',
              async (messages) => legacyUnitTokens(messages),
            );
            const actual = await emittedMessages(
              request,
              pin,
              plan.lastThinking,
              strip,
            );
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
            expect(actual.length).toBe(plan.bytes);
            expect(actual).toStrictEqual(expected);
            expect({ seed, tokens: plan.tokens }).toStrictEqual({
              seed,
              tokens: await oldMistralUnitTokens(units, strip),
            });
            accepted++;
          } finally {
            await request.close();
            await pin.close();
          }
        }
      } finally {
        await session.close();
      }
      expect(accepted).toBe(5000);
    },
    120000,
  );
});
