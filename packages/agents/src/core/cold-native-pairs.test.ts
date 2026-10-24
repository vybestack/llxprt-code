/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { encodeContentRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { storedFacts } from '@vybestack/llxprt-code-core/journal/__tests__/support/stored-format-facts.js';
import type {
  RowFormatRegistration,
  RowFormatSettings,
} from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { anthropicLengthRegistration } from '@vybestack/llxprt-code-providers/anthropic/journal-anthropic-length.js';
import { responsesLengthRegistration } from '@vybestack/llxprt-code-providers/openai-responses/journal-responses-length.js';

const settings: RowFormatSettings = {
  formatId: 'responses',
  formatRev: 1,
  model: 'model-a',
  endpoint: 'https://example.test/v1',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: false,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: true,
  unsupportedMedia: 'notice',
  outputLimits: null,
};

async function register(
  session: JournalSession,
  registration: RowFormatRegistration,
): Promise<void> {
  if (registration.nativeFacts !== undefined)
    await session.store.commit([
      { kind: 'factIndex', registration: registration.nativeFacts },
    ]);
  await session.registerRowFormat(registration);
}

const call: IContent = {
  speaker: 'ai',
  blocks: [
    {
      type: 'tool_call',
      id: 'pair',
      name: 'read',
      parameters: { path: 'file' },
    },
  ],
};
const response: IContent = {
  speaker: 'tool',
  blocks: [
    {
      type: 'tool_response',
      callId: 'pair',
      toolName: 'read',
      result: 'result',
    },
  ],
};

describe('cold native pair catch-up', () => {
  const directory = useTempDir('cold-native-pairs-');
  for (const provider of ['anthropic', 'responses']) {
    it(`repairs a measured ${provider} call when its response arrives before reattachment`, async () => {
      const registration =
        provider === 'anthropic'
          ? anthropicLengthRegistration({
              ...settings,
              formatId: 'anthropic',
              reasoningEnabled: true,
              anthropic: { cache: 'off', imageBudget: null },
            })
          : responsesLengthRegistration(settings);
      const prefix: IContent[] = [
        ...Array.from(
          { length: 16 },
          (_, index): IContent => ({
            speaker: 'human',
            blocks: [{ type: 'text', text: `prefix ${index}` }],
          }),
        ),
        call,
      ];
      const path = `${directory()}/${provider}.llxj`;
      const original = await JournalSession.create(path);
      try {
        await original.append(prefix);
        await register(original, registration);
      } finally {
        await original.close();
      }
      const resumed = await JournalSession.open(path);
      const cold = await JournalSession.create(
        `${directory()}/${provider}-cold.llxj`,
      );
      try {
        await resumed.store.commit([
          { kind: 'append', rows: [encodeContentRow(response, { owner: 0 })] },
        ]);
        await register(resumed, registration);
        await cold.append([...prefix, response]);
        await register(cold, registration);
        expect(resumed.store.published?.aggregate.summaries[0]).toStrictEqual(
          cold.store.published?.aggregate.summaries[0],
        );
        expect(await storedFacts(resumed.store)).toStrictEqual(
          await storedFacts(cold.store),
        );
      } finally {
        await resumed.close();
        await cold.close();
      }
    });
  }
});
