/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type {
  IContent,
  ContentBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { prepareProviderContentSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-curated-stream.js';
import { estimateTokens } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { RequestShapeSessionMemory } from './tokenUsageRequestShape.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import { BoundarySnapshotDisk } from './boundary-snapshot-disk.js';
import {
  shapeCases,
  shapeRow,
  shapePending,
  shapeHead,
  shapeCapacity,
  shapeState,
  seedTool,
  fallbackCount,
  independentSeed,
  type ShapeCase,
} from './__tests__/support/token-usage-source-fixture.js';

const root = sourceRootSetup();
const evidence = join(process.cwd(), 'tmp/source-shape-disk-20261009-sol');
const oracle = z
  .array(
    z.object({
      tokenizer: z.string(),
      mode: z.string(),
      send: z.number(),
      shape: z.unknown(),
      state: z.unknown(),
      calls: z.number(),
      chars: z.number(),
    }),
  )
  .parse(JSON.parse(readFileSync(join(evidence, 'oracle.json'), 'utf8')));

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
  let calls = 0;
  let chars = 0;
  const countTokens = (text: string): number => {
    calls++;
    chars += text.length;
    return tokenizer === 'fallback'
      ? fallbackCount(text)
      : estimateTokens(text);
  };
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
        calls,
        chars,
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
    calls,
    chars,
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
          oracle.filter(
            (entry) => entry.mode === mode && entry.tokenizer === tokenizer,
          ),
        );
      },
      180000,
    );
  }
  it('uses different tiktoken and fallback measurements', () => {
    const fallback = oracle.find(
      (entry) => entry.mode === 'anonymous' && entry.tokenizer === 'fallback',
    );
    const native = oracle.find(
      (entry) => entry.mode === 'anonymous' && entry.tokenizer === 'tiktoken',
    );
    expect(fallback?.shape).not.toStrictEqual(native?.shape);
  });
});

const unsupported: Array<{ classification: string; blocks: ContentBlock[] }> = [
  {
    classification: 'tool',
    blocks: [{ type: 'tool_call', id: 'call', name: 'read', parameters: {} }],
  },
  {
    classification: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'call',
        toolName: 'read',
        result: 'body',
      },
    ],
  },
  {
    classification: 'media',
    blocks: [
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: 'YQ==',
      },
    ],
  },
  {
    classification: 'mixed',
    blocks: [
      { type: 'text', text: 'caption' },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: 'YQ==',
      },
    ],
  },
  {
    classification: 'mixed',
    blocks: [
      { type: 'text', text: 'text' },
      { type: 'tool_call', id: 'call', name: 'read', parameters: {} },
    ],
  },
  {
    classification: 'non-text',
    blocks: [{ type: 'thinking', thought: 'thought' }],
  },
  {
    classification: 'non-text',
    blocks: [{ type: 'code', code: 'code', language: 'typescript' }],
  },
];
describe('unsupported source shape admission', () => {
  it.each(unsupported)(
    'rejects $classification before measuring or mutating session state',
    async ({ classification, blocks }) => {
      const memory = new RequestShapeSessionMemory(128);
      const baseline = memory.recordRequestShape({
        requestContents: [seedTool()],
        tools: [],
        instructionsText: undefined,
        countTokens: fallbackCount,
      });
      const before = independentSeed();
      const initial: unknown = baseline;
      expect(initial).toStrictEqual(before.shape);
      const disk = new BoundarySnapshotDisk(root());
      await disk.capture('after', {
        count: 65,
        async *openReader(): AsyncGenerator<IContent, void, unknown> {
          for (let index = 0; index < 64; index++)
            yield shapeRow('stable', index, 0);
          yield {
            speaker: blocks.some((block) => block.type === 'tool_response')
              ? 'tool'
              : 'ai',
            blocks,
          };
        },
      });
      const rows = disk.selection('after');
      let measured = 0;
      let uploaded = 0;
      try {
        await expect(
          (async () => {
            await memory.recordSourceRequestShape({
              requestRows: rows,
              tools: [],
              instructionsText: undefined,
              countTokens: (text) => {
                measured++;
                return fallbackCount(text);
              },
            });
            uploaded++;
          })(),
        ).rejects.toMatchObject({
          name: 'UnsupportedSourceRequestShapeError',
          classification,
          rowIndex: 64,
        });
        expect(measured).toBe(0);
        expect(uploaded).toBe(0);
        const currentState: unknown = shapeState(memory);
        expect(currentState).toStrictEqual(before.state);
        const after = memory.recordRequestShape({
          requestContents: [seedTool()],
          tools: [],
          instructionsText: undefined,
          countTokens: fallbackCount,
        });
        expect(after.prefixFingerprint).toBe(baseline.prefixFingerprint);
        expect(after.prefixFingerprintChanged).toBe(false);
        expect(after.carriedToolResultTokens).toBe(
          baseline.newToolResultTokens,
        );
      } finally {
        disk.close();
      }
    },
  );
});
