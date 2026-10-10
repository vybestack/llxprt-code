/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { estimateTokens } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { prepareProviderContentSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-curated-stream.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { TokenUsageLogger } from './TokenUsageLogger.js';
import {
  recordSourceRequestShapeContext,
  recordProviderOrModelSwitch,
} from './tokenUsageEstimateLogger.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import {
  shapeRow,
  shapeHead,
  shapePending,
  seedTool,
  shapeState,
  arrayShapeOracle,
  type ShapeCase,
} from './__tests__/support/token-usage-source-fixture.js';

const root = sourceRootSetup();
async function rows(mode: ShapeCase, send: number) {
  return prepareProviderContentSnapshot(
    {
      async *[Symbol.asyncIterator](): AsyncGenerator<IContent, void, unknown> {
        for (let index = 0; index < 64; index++)
          yield shapeRow(mode, index, send);
      },
    },
    [shapePending(send)],
    new DebugLogger('source-shape-context'),
    { root: root() },
  );
}
function records(path: string) {
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => z.record(z.unknown()).parse(JSON.parse(line)));
}
function serializedShape(
  shape: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(shape).map(([name, value]) => [
      name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      value,
    ]),
  );
}
async function contextualSends(providerChange: boolean) {
  const oracle = arrayShapeOracle('changed', 'tiktoken');
  const file = join(root(), 'usage.jsonl');
  const logger = new TokenUsageLogger(true, file);
  logger.getShapeMemory().recordRequestShape({
    requestContents: [seedTool()],
    tools: [],
    instructionsText: undefined,
    countTokens: estimateTokens,
  });
  for (let send = 0; send < 2; send++) {
    const source = await rows('changed', send);
    const head = shapeHead('changed', send);
    const provider =
      providerChange && send === 1 ? 'anthropic' : 'openai-responses';
    const state = createAgentRuntimeState({
      runtimeId: 'shape-runtime',
      sessionId: 'shape-session',
      provider,
      model: `model-${send}`,
    });
    try {
      logger.recordEstimate(`prompt-${send}`, {
        provider,
        model: state.model,
        estimatedTokens: 987654,
        estimator:
          provider === 'anthropic' ? 'anthropic-char' : 'openai-tiktoken',
        tiktokenTokens: null,
      });
      await recordSourceRequestShapeContext(
        logger,
        `prompt-${send}`,
        source,
        head.tools,
        head.instructionsText,
      );
      await recordProviderOrModelSwitch(logger, state, `turn-${send}`);
      await logger.recordActual(`prompt-${send}`, {
        actualPromptTokens: 123,
        cachedTokens: 4,
      });
      const expected = oracle[send];
      const current = records(file).find(
        (record) => record.prompt_id === `prompt-${send}`,
      );
      expect(current).toMatchObject(
        serializedShape(z.record(z.unknown()).parse(expected.shape)),
      );
      expect(current).toMatchObject({
        provider,
        model: state.model,
        estimated_tokens: 987654,
        actual_prompt_tokens: 123,
      });
      const observedState: unknown = shapeState(logger.getShapeMemory());
      expect(observedState).toStrictEqual(expected.state);
    } finally {
      source.close();
    }
  }
  const all = records(file);
  expect(all[1]).toMatchObject({
    from_model: 'model-0',
    to_model: 'model-1',
    turn_id: 'turn-1',
  });
  return all.map((entry) => entry.record_type);
}
describe('source shape context prerequisite', () => {
  it.each([false, true])(
    'preserves all text shape fields across observed model/provider switch=%s',
    async (providerChange) => {
      expect(await contextualSends(providerChange)).toStrictEqual([
        'turn',
        providerChange ? 'provider_switch' : 'model_switch',
        'turn',
      ]);
    },
  );
  it('does not read a disabled source logger or attach partial context', async () => {
    const file = join(root(), 'disabled.jsonl');
    const logger = new TokenUsageLogger(false, file);
    await recordSourceRequestShapeContext(
      logger,
      'disabled',
      {
        count: 1,
        openReader(): AsyncGenerator<IContent, void, unknown> {
          throw new Error('Disabled shape must not read history');
        },
      },
      [],
      undefined,
    );
    expect(logger.getShapeMemory().measurementCount).toBe(0);
    expect(existsSync(file)).toBe(false);
  });
});
