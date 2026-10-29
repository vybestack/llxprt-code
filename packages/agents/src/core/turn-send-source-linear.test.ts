/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { mediaRequestFixture } from './__tests__/support/turn-media-request-test-helpers.js';
import { sendTurnSource } from './turnSourceRequest.js';

const UNDER_LIMIT = 100_000_000;
const SMALL = 150;
const LARGE = 1200;

interface SendCounts {
  readonly opens: number;
  readonly rowsRead: number;
}

/**
 * One non-streaming source send over a journal-backed history. The fixture's
 * compression factory throws, so any entry into the enforcement ladder fails
 * the send instead of being counted.
 */
async function countedSend(rows: number): Promise<SendCounts> {
  return withSuffixFixture(
    rows,
    async (history) => {
      const fixture = mediaRequestFixture(history, UNDER_LIMIT);
      const config = new Config({
        cwd: process.cwd(),
        targetDir: process.cwd(),
        sessionId: 'turn-source-linear',
        model: 'test-model',
        debugMode: false,
        enableHooks: false,
      });
      const runtime = {
        ...fixture.runtimeContext,
        providerRuntime: { ...fixture.runtimeContext.providerRuntime, config },
      };
      const opens = spyOn(
        HistoryService.prototype,
        'prepareCuratedForProviderSnapshot',
      );
      let rowsRead = 0;
      try {
        await sendTurnSource({
          runtime,
          compression: fixture.compressionHandler,
          history,
          provider: fixture.provider,
          promptId: 'turn-send-linear',
          userContents: [
            { speaker: 'human', blocks: [{ type: 'text', text: 'continue' }] },
          ],
          semanticMediaPurge: undefined,
          tools: undefined,
          signal: undefined,
          log: () => undefined,
          buildOptions: (contents) => ({ contents }),
          onPrepared: () => undefined,
          attempt: async (prepared) => {
            expect(prepared.options.requestRows.native).toBeDefined();
            for await (const row of prepared.options.requestRows.openReader())
              if (row.blocks.length > 0) rowsRead++;
            return;
          },
        });
        return {
          opens: opens.mock.calls.length,
          rowsRead,
        };
      } finally {
        opens.mockRestore();
        await config.dispose();
      }
    },
    64,
  );
}

describe('non-streaming turn send cost scales linearly with rows', () => {
  it('opens one native snapshot per send at both history sizes and reads each row once', async () => {
    const small = await countedSend(SMALL);
    const large = await countedSend(LARGE);

    expect(small.opens).toBe(1);
    expect(large.opens).toBe(small.opens);
    expect(small.rowsRead).toBe(SMALL + 1);
    expect(large.rowsRead).toBe(LARGE + 1);
  }, 120_000);
});
