/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { HistoryJournalStore } from '@vybestack/llxprt-code-core/services/history/historyJournalStore.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { mediaRequestFixture } from './turn-media-request-test-helpers.js';
import { sendTurnSource } from './turnSourceRequest.js';

const UNDER_LIMIT = 100_000_000;
const SMALL = 150;
const LARGE = 1200;

interface SendCounts {
  readonly opens: number;
  readonly captures: number;
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
      const runtime = {
        ...fixture.runtimeContext,
        providerRuntime: {
          ...fixture.runtimeContext.providerRuntime,
          config: { getEnableHooks: () => false },
        },
      } as unknown as AgentRuntimeContext;
      const opens = spyOn(
        HistoryService.prototype,
        'prepareCuratedForProviderSnapshot',
      );
      const captures = spyOn(
        HistoryJournalStore.prototype,
        'capturePendingFold',
      );
      let rowsRead = 0;
      try {
        await sendTurnSource({
          runtime,
          compression: fixture.compressionHandler,
          history,
          provider: fixture.provider,
          promptId: 'turn-send-linear',
          userContents: [],
          semanticMediaPurge: undefined,
          tools: undefined,
          signal: undefined,
          log: () => undefined,
          buildOptions: (contents) =>
            ({ contents }) as unknown as RuntimeGenerateChatOptions,
          onPrepared: () => undefined,
          attempt: async (prepared) => {
            for await (const row of prepared.options.requestRows.openReader())
              if (row.blocks.length > 0) rowsRead++;
            return { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
          },
        });
        return {
          opens: opens.mock.calls.length,
          captures: captures.mock.calls.length,
          rowsRead,
        };
      } finally {
        opens.mockRestore();
        captures.mockRestore();
      }
    },
    64,
  );
}

describe('non-streaming turn send cost scales linearly with rows', () => {
  it('opens the same number of snapshots and folds per send at any history size and reads each row once', async () => {
    const small = await countedSend(SMALL);
    const large = await countedSend(LARGE);

    expect(small.opens).toBe(1);
    expect(large.opens).toBe(small.opens);
    expect(large.captures).toBe(small.captures);
    expect(small.rowsRead).toBe(SMALL);
    expect(large.rowsRead).toBe(LARGE);
  }, 120_000);
});
