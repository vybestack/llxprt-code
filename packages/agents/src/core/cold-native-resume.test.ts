/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { encodeContentRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { anthropicLengthRegistration } from '@vybestack/llxprt-code-providers/anthropic/journal-anthropic-length.js';
import { storedFacts } from '@vybestack/llxprt-code-core/journal/__tests__/support/stored-format-facts.js';

const settings: RowFormatSettings = {
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

describe('cold native resume', () => {
  const directory = useTempDir('cold-native-resume-');
  it.each([16, 128])(
    'catches up native Anthropic facts after %i measured rows',
    async (size) => {
      const registration = anthropicLengthRegistration(settings);
      if (registration.nativeFacts === undefined)
        throw new Error('Missing native facts');
      const rows = Array.from({ length: size + 3 }, (_, index) =>
        encodeContentRow(
          {
            speaker: index % 2 === 0 ? 'human' : 'ai',
            blocks: [{ type: 'text', text: `row ${index}` }],
          },
          { owner: 0 },
        ),
      );
      const deps = { journal: testJournalSeams().dependencies };
      const path = join(directory(), `resume-${size}.llxj`);
      const original = (await JournalSession.create(path, deps)).store;
      try {
        await original.commit([
          { kind: 'replace', rows: rows.slice(0, size) },
          { kind: 'factIndex', registration: registration.nativeFacts },
        ]);
        await original.commit([{ kind: 'format', registration }]);
      } finally {
        await original.close();
      }
      const resumed = (await JournalSession.open(path, deps)).store;
      const cold = (
        await JournalSession.create(
          join(directory(), `cold-${size}.llxj`),
          deps,
        )
      ).store;
      try {
        await resumed.commit([
          { kind: 'append', rows: rows.slice(size, size + 1) },
        ]);
        await resumed.commit([
          {
            kind: 'setState',
            key: 'resume-marker',
            value: new Uint8Array([1]),
          },
        ]);
        await resumed.commit([{ kind: 'append', rows: rows.slice(size + 1) }]);
        const pending = await resumed.snapshot();
        try {
          await expect(
            pending.nativeFacts(registration.nativeFacts.scope),
          ).rejects.toThrow('require a fill');
        } finally {
          await pending.close();
        }
        let measured = 0;
        const counted = {
          ...registration,
          prepareAppend:
            registration.prepareAppend === undefined
              ? undefined
              : async (
                  ...args: Parameters<
                    NonNullable<typeof registration.prepareAppend>
                  >
                ) => {
                  const fill = await registration.prepareAppend?.(...args);
                  if (fill === undefined)
                    throw new Error('Missing append fill');
                  return {
                    ...fill,
                    measure: async (
                      ...input: Parameters<typeof fill.measure>
                    ) => {
                      measured++;
                      return fill.measure(...input);
                    },
                  };
                },
        };
        await resumed.commit([
          { kind: 'factIndex', registration: registration.nativeFacts },
        ]);
        await resumed.commit([{ kind: 'format', registration: counted }]);
        expect(measured).toBe(3);
        await cold.commit([
          { kind: 'replace', rows },
          { kind: 'factIndex', registration: registration.nativeFacts },
        ]);
        await cold.commit([{ kind: 'format', registration }]);
        expect(resumed.published?.aggregate.summaries[0]).toStrictEqual(
          cold.published?.aggregate.summaries[0],
        );
        expect(await storedFacts(resumed)).toStrictEqual(
          await storedFacts(cold),
        );
      } finally {
        await resumed.close();
        await cold.close();
      }
    },
  );
});
