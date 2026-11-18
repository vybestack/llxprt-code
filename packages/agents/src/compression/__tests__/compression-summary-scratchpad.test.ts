/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4128: a summarizer that writes a scratchpad anyway must not poison
 * the session. The stored summary keeps only the snapshot, the verification
 * pass never sees or returns one, and older summaries in the compressed span
 * are cleaned before they are sent back to the summarizer.
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  EmptySummaryError,
  type StrategyCompressionResult,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import {
  buildRecordingContext,
  createRecordingProvider,
  createStrategy,
  requestText,
  type StrategyName,
} from './compression-request-capture.js';
import { generateHistory, humanMsg } from './MiddleOutStrategy-test-helpers.js';

const SNAPSHOT =
  '<state_snapshot><overall_goal>Fix #4128</overall_goal></state_snapshot>';
const IMPROVED =
  '<state_snapshot><overall_goal>Fix #4128 fully</overall_goal></state_snapshot>';
const STRATEGIES: readonly StrategyName[] = ['one-shot', 'middle-out'];

function storedSummary(result: StrategyCompressionResult): string {
  if (result.kind !== 'applied') {
    throw new Error(`expected an applied compression, got ${result.kind}`);
  }
  const summary = result.newHistory.find(
    (entry) => entry.metadata?.reason === 'compression-state-snapshot',
  );
  return (summary?.blocks ?? [])
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('');
}

async function compressWithReplies(
  strategyName: StrategyName,
  replies: string[],
  options: { verification?: boolean; history?: IContent[] } = {},
): Promise<{ summary: string; requests: string[] }> {
  const provider = createRecordingProvider(...replies);
  const context = buildRecordingContext(
    provider,
    options.history ?? generateHistory(20),
    { verification: options.verification },
  );
  const result = await createStrategy(strategyName).compress(context);
  return {
    summary: storedSummary(result),
    requests: provider.requests.map(requestText),
  };
}

describe('compression summaries are stored without a scratchpad (issue #4128)', () => {
  for (const strategyName of STRATEGIES) {
    it(`${strategyName}: keeps only the snapshot from a reply with a scratchpad block`, async () => {
      const { summary } = await compressWithReplies(strategyName, [
        `<scratchpad>x</scratchpad>${SNAPSHOT}`,
      ]);

      expect(summary).toBe(SNAPSHOT);
    });

    it(`${strategyName}: keeps only the snapshot from a reply with an unterminated leading scratchpad`, async () => {
      const { summary } = await compressWithReplies(strategyName, [
        `<scratchpad>\nLet me review the history first.\n\n${SNAPSHOT}`,
      ]);

      expect(summary).toBe(SNAPSHOT);
    });

    it(`${strategyName}: treats a reply that is only a scratchpad as an empty summary`, async () => {
      const replies = ['<scratchpad>reasoning that never finished'];

      await expect(
        compressWithReplies(strategyName, replies),
      ).rejects.toBeInstanceOf(EmptySummaryError);
    });

    it(`${strategyName}: the verification request never carries the scratchpad`, async () => {
      const { requests } = await compressWithReplies(
        strategyName,
        [`<scratchpad>x</scratchpad>${SNAPSHOT}`, 'VERIFIED'],
        { verification: true },
      );

      expect(requests).toHaveLength(2);
      expect(requests[1]).toContain(SNAPSHOT);
      expect(requests[1].toLowerCase()).not.toContain('scratchpad');
    });

    it(`${strategyName}: keeps only the snapshot from a verification reply with a scratchpad`, async () => {
      const { summary } = await compressWithReplies(
        strategyName,
        [SNAPSHOT, `<scratchpad>Missing detail.</scratchpad>\n${IMPROVED}`],
        { verification: true },
      );

      expect(summary).toBe(IMPROVED);
    });

    it(`${strategyName}: keeps only the snapshot from a verification reply with an unterminated scratchpad`, async () => {
      const { summary } = await compressWithReplies(
        strategyName,
        [SNAPSHOT, `<scratchpad>Missing detail.\n${IMPROVED}`],
        { verification: true },
      );

      expect(summary).toBe(IMPROVED);
    });

    it(`${strategyName}: cleans an older summary before sending it to the summarizer`, async () => {
      const history = generateHistory(20).map((entry, index) =>
        index === 4
          ? {
              ...humanMsg(`<scratchpad>old notes</scratchpad>\n${SNAPSHOT}`),
              metadata: {
                isSummary: true,
                reason: 'compression-state-snapshot' as const,
              },
            }
          : entry,
      );

      const { requests } = await compressWithReplies(strategyName, [IMPROVED], {
        history,
      });

      expect(requests[0]).toContain(SNAPSHOT);
      expect(requests[0].toLowerCase()).not.toContain('scratchpad');
    });

    it(`${strategyName}: sends ordinary messages that mention a scratchpad unchanged`, async () => {
      const userText = 'Please explain <scratchpad>notes</scratchpad> tags.';
      const history = generateHistory(20).map((entry, index) =>
        index === 4 ? humanMsg(userText) : entry,
      );

      const { requests } = await compressWithReplies(strategyName, [SNAPSHOT], {
        history,
      });

      expect(requests[0]).toContain(userText);
    });
  }
});
