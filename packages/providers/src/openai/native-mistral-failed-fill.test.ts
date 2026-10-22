/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { statSync } from 'node:fs';
import { JournalSession } from '../../../core/src/services/history/journalSession.js';
import { PinnedRequestFormats } from '../../../core/src/services/history/pinned-request-formats.js';
import { IndexedJournalRequestSnapshot } from '../../../core/src/services/history/indexed-journal-request-snapshot.js';
import { JournalWriterPoisonedError } from '../../../core/src/journal/errors.js';
import { testJournalSeams } from '../../../core/src/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../../core/src/journal/__tests__/support/useTempDir.js';
import type { RowFormatSettings } from '../../../core/src/journal/rowFormat.js';
import type { VersionSnapshot } from '../../../core/src/journal/versionSnapshot.js';
import type { IContent } from '../../../core/src/services/history/IContent.js';
import { createRuntimeTokenizerFactory } from '../composition/runtimeTokenizerFactory.js';
import { chatTokenRegistration } from './native-chat-estimate.js';
import {
  plainChatLengthRegistration,
  planStoredChatMessages,
  PLAIN_CHAT_FORMAT_REV,
} from './journal-chat-length.js';
import { nativeChatMessages } from './native-chat-messages.js';
import { buildMessagesWithReasoning } from './OpenAIRequestBuilder.js';
import {
  oldMistralUnitTokens,
  legacyUnitTokens,
} from './__tests__/support/mistral-unit-token-oracle.js';
import { observeRowFormat } from './__tests__/support/observeRowFormat.js';

const settings: RowFormatSettings = {
  formatId: 'openai-chat:mistral',
  formatRev: PLAIN_CHAT_FORMAT_REV,
  model: 'mistral-large-latest',
  endpoint: 'https://api.mistral.ai/v1',
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
const rows: readonly IContent[] = ['first 雪', 'second unit', 'third unit'].map(
  (text) => ({
    speaker: 'ai',
    blocks: [
      { type: 'thinking', thought: `reason ${text}` },
      { type: 'text', text },
    ],
  }),
);
async function body(
  pin: VersionSnapshot,
  captured: RowFormatSettings,
): Promise<Buffer> {
  const request = await IndexedJournalRequestSnapshot.create(pin, []);
  try {
    const chunks = [Buffer.from('[{"role":"system","content":""}')];
    for await (const chunk of nativeChatMessages(
      request.openReader(),
      captured,
      'none',
      0,
    ))
      chunks.push(Buffer.from(chunk));
    chunks.push(Buffer.from(']'));
    return Buffer.concat(chunks);
  } finally {
    await request.close();
  }
}

describe('failed native Mistral fused fill', () => {
  const directory = useTempDir('mistral-failed-fill-');
  it('does not publish or cache a format after the tokenizer fails in the second unit', async () => {
    const session = await JournalSession.create(`${directory()}/failure.llxj`, {
      journal: testJournalSeams({}, 1, false).dependencies,
    });
    const oldSettings: RowFormatSettings = {
      ...settings,
      formatId: 'openai-chat:plain',
      chat: { includeInContext: true, toolFormat: 'openai' },
    };
    try {
      await session.append(rows);
      await session.registerRowFormat(
        plainChatLengthRegistration(oldSettings, legacyUnitTokens),
      );
      const pin = await session.store.snapshot();
      const formats = new PinnedRequestFormats(pin, (source, registration) =>
        session.store.prepareSnapshotFormat(source, registration),
      );
      try {
        const before = session.store.published;
        const beforeSize = statSync(session.path).size;
        const oldBody = await body(pin, oldSettings);
        const failure = new Error('tokenizer failed in second normalized unit');
        const factory = createRuntimeTokenizerFactory();
        let calls = 0;
        const tokenized = await chatTokenRegistration(
          settings,
          {
            activeProvider: 'openai',
            canonicalModel: settings.model,
            protocol: 'openai-chat',
            wireMethod: 'chat/completions/v1',
            projectionRevision: 'test-failed-fill',
          },
          {
            ...factory,
            estimatePrompt: async (request) => {
              calls++;
              if (calls === 6) throw failure;
              return factory.estimatePrompt(request);
            },
          },
        );
        await expect(formats.prepare(pin, tokenized.registration)).rejects.toBe(
          failure,
        );
        expect(calls).toBe(6);
        expect(statSync(session.path).size).toBeGreaterThan(beforeSize);
        expect(session.store.published).toStrictEqual(before);
        expect(await body(pin, oldSettings)).toStrictEqual(oldBody);
        expect(planStoredChatMessages(pin, oldSettings, 0, '').bytes).toBe(
          oldBody.length,
        );
        expect(() =>
          planStoredChatMessages(pin, tokenized.registration.settings, 0, ''),
        ).toThrow(/registered/);
        await expect(
          formats.prepare(pin, tokenized.registration),
        ).rejects.toBeInstanceOf(JournalWriterPoisonedError);
        expect(session.store.published).toStrictEqual(before);
        expect(await body(pin, oldSettings)).toStrictEqual(oldBody);
      } finally {
        await formats.close();
        await pin.close();
      }
      await session.close();
      const reopened = await JournalSession.open(session.path);
      try {
        const factory = createRuntimeTokenizerFactory();
        let estimates = 0;
        let measuredUnits = 0;
        let countCalls = 0;
        const tokenized = await chatTokenRegistration(
          settings,
          {
            activeProvider: 'openai',
            canonicalModel: settings.model,
            protocol: 'openai-chat',
            wireMethod: 'chat/completions/v1',
            projectionRevision: 'test-failed-fill',
          },
          {
            ...factory,
            estimatePrompt: async (request) => {
              estimates++;
              return factory.estimatePrompt(request);
            },
          },
        );
        await reopened.registerRowFormat(
          observeRowFormat(
            plainChatLengthRegistration(
              tokenized.registration.settings,
              async (messages) => {
                countCalls++;
                return tokenized.count(messages);
              },
            ),
            (_entry, facts) => {
              if (
                facts.summary.kind !== 'chat' ||
                facts.summary.thinkingRank === undefined
              )
                throw new Error('Missing measured Chat unit facts');
              measuredUnits += facts.summary.thinkingRank.units;
            },
          ),
        );
        const recovered = await reopened.store.snapshot();
        try {
          const captured = tokenized.registration.settings;
          const expected = Buffer.from(
            JSON.stringify([
              { role: 'system', content: '' },
              ...buildMessagesWithReasoning(
                [...rows],
                {
                  invocation: {
                    ephemerals: {
                      'reasoning.includeInContext': true,
                      'reasoning.stripFromContext': 'none',
                    },
                  },
                },
                'mistral',
                undefined,
              ),
            ]),
          );
          const omitted = Buffer.from(
            JSON.stringify([
              { role: 'system', content: '' },
              ...buildMessagesWithReasoning(
                [...rows],
                {
                  invocation: {
                    ephemerals: { 'reasoning.includeInContext': false },
                  },
                },
                'mistral',
                undefined,
              ),
            ]),
          );
          const plan = planStoredChatMessages(recovered, captured, 0, '');
          expect(await body(recovered, captured)).toStrictEqual(expected);
          expect(plan.bytes).toBe(expected.length);
          expect(plan.tokens).toBe(await oldMistralUnitTokens(rows, 'none'));
          expect(
            planStoredChatMessages(recovered, captured, 1, '').tokens,
          ).toBe(await oldMistralUnitTokens(rows, 'all'));
          expect(plan.bytes - plan.omittedReasoningBytes).toBe(omitted.length);
          expect(
            await body(recovered, {
              ...captured,
              chat: { ...captured.chat, includeInContext: false },
            }),
          ).toStrictEqual(omitted);
          expect(measuredUnits).toBe(rows.length);
          expect(countCalls).toBe(rows.length * 2);
          expect(estimates).toBe(1 + rows.length * 4);
        } finally {
          await recovered.close();
        }
      } finally {
        await reopened.close();
      }
    } finally {
      await session.close();
    }
  });
});
