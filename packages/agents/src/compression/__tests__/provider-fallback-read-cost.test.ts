/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { stat } from 'node:fs/promises';
import * as positional from '@vybestack/llxprt-code-core/journal/positionalFile.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { exactTokenizer } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import {
  providerFarFixtureRow,
  providerPendingFixture,
} from '@vybestack/llxprt-code-core/services/history/__tests__/support/provider-curated-test-helpers.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { installFixtureCandidate } from './provider-fallback-candidate-fixture.js';
import { enforceWithHandler } from './support/enforce-with-handler.js';
import { buildRuntimeContext } from '../../core/__tests__/chatSession-density-helpers.js';

describe('provider fallback read amplification', () => {
  it.each([512, 2048, 8192])(
    'sends %i rows after rejecting an installed candidate with bounded I/O',
    async (size) => {
      let reads = 0;
      let bytes = 0;
      let parses = 0;
      let measuring = false;
      let journalPath: () => string | null = () => null;
      const createReader = positional.createFileHandleReader;
      const readerSpy = spyOn(
        positional,
        'createFileHandleReader',
      ).mockImplementation((handle) => {
        const reader = createReader(handle);
        return {
          readAt: (position, length) => {
            if (measuring) {
              reads++;
              bytes += length;
            }
            return reader.readAt(position, length);
          },
        };
      });
      const parse = JSON.parse;
      const parseSpy = spyOn(JSON, 'parse').mockImplementation(
        (text, reviver) => {
          if (measuring) parses++;
          return parse(text, reviver);
        },
      );
      try {
        await withSuffixFixture(
          size,
          async (history) => {
            const filePath = journalPath();
            if (filePath === null) throw new Error('Missing journal path');
            const journalBytes = (await stat(filePath)).size;
            const exact = exactTokenizer();
            history.setTokenizerFactory({
              ...exact,
              getTokenizer: (...args) => ({
                ...exact.getTokenizer(...args),
                countTokens: async (text: string): Promise<number> =>
                  text.length > 10000 ? Math.ceil(text.length / 4) : 1,
              }),
            });
            const pending = providerPendingFixture();
            const response = pending[0].blocks[0];
            if (response.type !== 'tool_response')
              throw new Error('Missing far response');
            pending[0] = {
              ...pending[0],
              blocks: [{ ...response, result: 'far answer '.repeat(20000) }],
            };
            measuring = true;
            const rows = await enforceWithHandler({
              history,
              runtimeContext: buildRuntimeContext(history, {
                contextLimit: 30000,
                compressionThreshold: 0.8,
              }),
              generationConfig: { maxOutputTokens: 100 },
              pending,
              promptId: 'fallback-read-cost',
              performCompression: async () => {
                throw new Error('provider failed');
              },
              fallbackDeps: {
                performFallbackCompression: async (_promptId, install) => {
                  await installFixtureCandidate(install, [
                    providerFarFixtureRow(0),
                    providerFarFixtureRow(2),
                  ]);
                  return false;
                },
              },
              estimateRows: async (contents) =>
                contents.length +
                (contents.some((row) =>
                  row.blocks.some(
                    (block) =>
                      block.type === 'tool_response' &&
                      block.callId === 'far-call' &&
                      block.providerMetadata?.contextTruncated !== true,
                  ),
                )
                  ? 60000
                  : 0),
            });
            measuring = false;
            expect(rows.length).toBeGreaterThan(size / 2);
            expect(
              rows.some((row) =>
                row.blocks.some(
                  (block) =>
                    block.type === 'tool_response' &&
                    block.callId === 'far-call' &&
                    block.providerMetadata?.contextTruncated === true,
                ),
              ),
            ).toBe(true);
            expect(parses).toBeLessThanOrEqual(16 * size);
            expect(reads).toBeLessThanOrEqual(20 * size);
            expect(bytes).toBeLessThanOrEqual(5 * journalBytes);
          },
          2048,
          providerFarFixtureRow,
          undefined,
          (options) => {
            journalPath = () => options.recording?.getFilePath() ?? null;
            return new HistoryService(options);
          },
        );
      } finally {
        measuring = false;
        readerSpy.mockRestore();
        parseSpy.mockRestore();
      }
    },
  );
});
