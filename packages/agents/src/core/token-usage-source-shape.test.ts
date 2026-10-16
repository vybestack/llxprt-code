/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { prepareProviderContentSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-curated-stream.js';
import { RequestShapeSessionMemory } from './tokenUsageRequestShape.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import {
  shapeCases,
  shapeRow,
  shapePending,
  shapeHead,
  shapeCapacity,
  shapeState,
  seedTool,
  arrayShapeOracle,
  countingTokenizer,
  type ShapeCase,
} from './__tests__/support/token-usage-source-fixture.js';

const root = sourceRootSetup();

async function snapshot(mode: ShapeCase, send: number) {
  return prepareProviderContentSnapshot(
    {
      async *[Symbol.asyncIterator](): AsyncGenerator<IContent, void, unknown> {
        for (let index = 0; index < 64; index++)
          yield shapeRow(mode, index, send);
      },
    },
    [shapePending(send)],
    new DebugLogger('source-shape-test'),
    { root: root() },
  );
}
async function parity(mode: ShapeCase, tokenizer: string) {
  const memory = new RequestShapeSessionMemory(shapeCapacity(mode));
  const observations: unknown[] = [];
  const { counts, countTokens } = countingTokenizer(tokenizer);
  memory.recordRequestShape({
    requestContents: [seedTool()],
    tools: [],
    instructionsText: undefined,
    countTokens,
  });
  for (let send = 0; send < 2; send++) {
    const rows = await snapshot(mode, send);
    try {
      expect(rows.count).toBe(65);
      expect(rows.isPending(64)).toBe(true);
      const shape = await memory.recordSourceRequestShape({
        requestRows: rows,
        ...shapeHead(mode, send),
        countTokens,
      });
      observations.push({
        tokenizer,
        mode,
        send,
        shape,
        state: shapeState(memory),
        calls: counts.calls,
        chars: counts.chars,
      });
    } finally {
      rows.close();
    }
  }
  const shape = memory.recordRequestShape({
    requestContents: [seedTool()],
    tools: [],
    instructionsText: undefined,
    countTokens,
  });
  observations.push({
    tokenizer,
    mode,
    send: 2,
    shape,
    state: shapeState(memory),
    calls: counts.calls,
    chars: counts.chars,
  });
  return observations;
}

describe('exact disk-backed normalized TEXT request shape', () => {
  for (const tokenizer of ['fallback', 'tiktoken']) {
    it.each([...shapeCases])(
      'matches all original array fields and session after two sends, %s / ' +
        tokenizer,
      async (mode) => {
        expect(await parity(mode, tokenizer)).toStrictEqual(
          arrayShapeOracle(mode, tokenizer),
        );
      },
      180000,
    );
  }
  it('uses different tiktoken and fallback measurements', () => {
    const fallback = arrayShapeOracle('anonymous', 'fallback')[0];
    const native = arrayShapeOracle('anonymous', 'tiktoken')[0];
    expect(fallback.shape).not.toStrictEqual(native.shape);
  });
});
