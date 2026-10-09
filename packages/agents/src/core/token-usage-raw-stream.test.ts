/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { TokenUsageLogger } from './TokenUsageLogger.js';
import { recordTurnJoinContext } from './tokenUsageEstimateLogger.js';

for (const size of [512, 8192]) {
  describe(`send-seam chronology over ${size} journal rows`, () => {
    it('writes the persisted position and send turn identity without materializing raw history', async () => {
      const root = mkdtempSync(join(tmpdir(), 'raw-usage-test-'));
      const file = join(root, 'usage.jsonl');
      try {
        await withSuffixFixture(size, async (history, ownership, counters) => {
          const logger = new TokenUsageLogger(true, file);
          const runtime = createAgentRuntimeState({
            runtimeId: 'raw-runtime',
            sessionId: 'raw-session',
            provider: 'anthropic',
            model: 'test-model',
          });
          logger.recordEstimate('request', {
            provider: 'anthropic',
            model: 'test-model',
            estimatedTokens: 100,
            estimator: 'anthropic-char',
            tiktokenTokens: 90,
          });
          await recordTurnJoinContext(
            logger,
            'request',
            runtime,
            history,
            'sending-turn',
          );
          await logger.recordActual('request', {
            actualPromptTokens: 500,
            cachedTokens: 0,
          });
          const record: unknown = JSON.parse(readFileSync(file, 'utf8').trim());
          expect(record).toMatchObject({
            turn_id: 'sending-turn',
            user_turn: size,
            step: 0,
            runtime_id: 'raw-runtime',
          });
          expect(counters.snapshot().rowsDecoded).toBe(size);
          expect(ownership.snapshot().peakRows).toBe(1);
          expect(ownership.snapshot().liveRows).toBe(0);
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }, 120_000);
  });
}
