/**
 * @plan PLAN-20260702-LLMTYPES.P04
 * @requirement REQ-005.1, REQ-005.2, REQ-005.3, REQ-005.4, REQ-005.5
 * @pseudocode lines 10-52
 */
import { describe, expect } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';
import {
  emptyModelOutput,
  accumulateModelStreamChunk,
  getToolCalls,
  toModelStreamChunk,
  type ModelOutput,
  type ModelStreamChunk,
  type HookRestrictions,
} from './modelEnvelope.js';
import type {
  IContent,
  UsageStats,
  TextBlock,
  ToolCallBlock,
} from '../services/history/IContent.js';
import { CANONICAL_FINISH_REASONS } from './finishReasons.js';

// Hoisted to module scope: avoids repeated Set allocation across 100+
// fast-check iterations of the property-based tests below.
const CANONICAL_FINISH_REASON_SET: ReadonlySet<string> = new Set<string>(
  CANONICAL_FINISH_REASONS,
);

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

function textBlock(text: string): TextBlock {
  return { type: 'text', text };
}

function toolCallBlock(
  id: string,
  name: string,
  parameters: unknown,
): ToolCallBlock {
  return { type: 'tool_call', id, name, parameters };
}

function textBlockArb(): fc.Arbitrary<TextBlock> {
  return fc.record({
    type: fc.constant('text' as const),
    text: fc.string({ minLength: 0, maxLength: 50 }),
  });
}

function usage(p: number, c: number, t: number): UsageStats {
  return { promptTokens: p, completionTokens: c, totalTokens: t };
}

function chunkWithText(
  text: string,
  speaker: 'human' | 'ai' | 'tool' = 'ai',
): ModelStreamChunk {
  return {
    content: { speaker, blocks: [textBlock(text)] },
  };
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) {
      value.forEach(deepFreeze);
    } else {
      Object.values(value).forEach(deepFreeze);
    }
  }
  return Object.freeze(value);
}

// ---------------------------------------------------------------------------
// emptyModelOutput
// ---------------------------------------------------------------------------

describe('emptyModelOutput', () => {
  it('produces an empty ModelOutput with ai speaker by default', () => {
    expect(emptyModelOutput()).toStrictEqual<ModelOutput>({
      content: { speaker: 'ai', blocks: [] },
    });
  });

  it('honors the speaker argument', () => {
    expect(emptyModelOutput('human')).toStrictEqual<ModelOutput>({
      content: { speaker: 'human', blocks: [] },
    });
  });

  it('does not include any optional keys', () => {
    const out = emptyModelOutput();
    expect(out).not.toHaveProperty('finishReason');
    expect(out).not.toHaveProperty('rawStopReason');
    expect(out).not.toHaveProperty('usage');
    expect(out).not.toHaveProperty('responseId');
    expect(out).not.toHaveProperty('hookRestrictions');
    expect(out).not.toHaveProperty('providerMetadata');
  });
});

// ---------------------------------------------------------------------------
// accumulateModelStreamChunk — behavioral
// ---------------------------------------------------------------------------

describe('accumulateModelStreamChunk', () => {
  it('concatenates blocks in order across 3 chunks', () => {
    const acc = emptyModelOutput();
    const r1 = accumulateModelStreamChunk(acc, chunkWithText('A'));
    const r2 = accumulateModelStreamChunk(r1, chunkWithText('B'));
    const r3 = accumulateModelStreamChunk(r2, chunkWithText('C'));
    expect(r3).toStrictEqual<ModelOutput>({
      content: {
        speaker: 'ai',
        blocks: [textBlock('A'), textBlock('B'), textBlock('C')],
      },
    });
  });

  it('usage on middle chunk then final chunk → final wins', () => {
    const acc = emptyModelOutput();
    const r1 = accumulateModelStreamChunk(acc, {
      content: { speaker: 'ai', blocks: [textBlock('x')] },
      usage: usage(1, 1, 2),
    });
    const r2 = accumulateModelStreamChunk(r1, {
      content: { speaker: 'ai', blocks: [textBlock('y')] },
      usage: usage(5, 5, 10),
    });
    expect(r2.usage).toStrictEqual(usage(5, 5, 10));
  });

  it('finishReason only on terminal chunk → present in result', () => {
    const acc = emptyModelOutput();
    const r1 = accumulateModelStreamChunk(acc, chunkWithText('hello'));
    const r2 = accumulateModelStreamChunk(r1, {
      content: { speaker: 'ai', blocks: [] },
      finishReason: 'stop',
      rawStopReason: 'end_turn',
    });
    expect(r2.finishReason).toBe('stop');
    expect(r2.rawStopReason).toBe('end_turn');
  });

  it('providerMetadata shallow-merge: acc {a:1,b:1} + chunk {b:2} → {a:1,b:2}', () => {
    const acc: ModelOutput = {
      content: { speaker: 'ai', blocks: [] },
      providerMetadata: { a: 1, b: 1 },
    };
    const r = accumulateModelStreamChunk(acc, {
      content: { speaker: 'ai', blocks: [] },
      providerMetadata: { b: 2 },
    });
    expect(r.providerMetadata).toStrictEqual({ a: 1, b: 2 });
  });

  it('inputs NOT mutated (deep-freeze acc and chunk fixtures)', () => {
    const frozenAcc = deepFreeze({
      content: {
        speaker: 'ai' as const,
        blocks: [textBlock('a')],
        metadata: { model: 'm', nested: { k: 'v' } },
      },
      providerMetadata: { a: 1, nested: { shared: true } },
    });
    const frozenChunk = deepFreeze({
      content: {
        speaker: 'ai' as const,
        blocks: [textBlock('b')],
        metadata: { id: 'x', nested: { k2: 'v2' } },
      },
      providerMetadata: { b: 2, nested: { shared2: false } },
    });

    const beforeAcc = JSON.parse(JSON.stringify(frozenAcc));
    const beforeChunk = JSON.parse(JSON.stringify(frozenChunk));

    accumulateModelStreamChunk(frozenAcc, frozenChunk);

    expect(JSON.parse(JSON.stringify(frozenAcc))).toStrictEqual(beforeAcc);
    expect(JSON.parse(JSON.stringify(frozenChunk))).toStrictEqual(beforeChunk);
  });

  it('empty-blocks usage-only chunk is valid and contributes usage without blocks', () => {
    const acc = accumulateModelStreamChunk(emptyModelOutput(), {
      content: { speaker: 'ai', blocks: [] },
      usage: usage(10, 0, 10),
    });
    expect(acc.content.blocks).toStrictEqual([]);
    expect(acc.usage).toStrictEqual(usage(10, 0, 10));
  });

  it('merges content.metadata shallowly when present on acc or chunk', () => {
    const acc: ModelOutput = {
      content: {
        speaker: 'ai',
        blocks: [],
        metadata: { model: 'gpt' },
      },
    };
    const r = accumulateModelStreamChunk(acc, {
      content: {
        speaker: 'ai',
        blocks: [],
        metadata: { id: 'resp-1' },
      },
    });
    expect(r.content.metadata).toStrictEqual({ model: 'gpt', id: 'resp-1' });
  });

  it('responseId last-write-wins', () => {
    const acc: ModelOutput = {
      content: { speaker: 'ai', blocks: [] },
      responseId: 'r1',
    };
    const r = accumulateModelStreamChunk(acc, {
      content: { speaker: 'ai', blocks: [] },
      responseId: 'r2',
    });
    expect(r.responseId).toBe('r2');
  });

  it('hookRestrictions: chunk wins over acc when both present', () => {
    const accHook: HookRestrictions = { allowedToolNames: ['a'] };
    const chunkHook: HookRestrictions = { allowedToolNames: ['b', 'c'] };
    const acc: ModelOutput = {
      content: { speaker: 'ai', blocks: [] },
      hookRestrictions: accHook,
    };
    const r = accumulateModelStreamChunk(acc, {
      content: { speaker: 'ai', blocks: [] },
      hookRestrictions: chunkHook,
    });
    expect(r.hookRestrictions).toStrictEqual(chunkHook);
    expect(r.hookRestrictions).not.toBe(accHook);
  });

  it('preserves acc.hookRestrictions when chunk omits it', () => {
    const hook: HookRestrictions = { allowedToolNames: ['a'] };
    const acc: ModelOutput = {
      content: { speaker: 'ai', blocks: [] },
      hookRestrictions: hook,
    };
    const r = accumulateModelStreamChunk(acc, {
      content: { speaker: 'ai', blocks: [] },
    });
    expect(r.hookRestrictions).toStrictEqual(hook);
  });

  it('omits undefined-valued optional keys from result', () => {
    const r = accumulateModelStreamChunk(
      { content: { speaker: 'ai', blocks: [textBlock('x')] } },
      { content: { speaker: 'ai', blocks: [textBlock('y')] } },
    );
    expect(r).not.toHaveProperty('finishReason');
    expect(r).not.toHaveProperty('usage');
    expect(r).not.toHaveProperty('providerMetadata');
  });
});

// ---------------------------------------------------------------------------
// accumulateModelStreamChunk — property-based
// ---------------------------------------------------------------------------

describe('accumulateModelStreamChunk property-based', () => {
  it.prop([
    fc.array(
      fc.array(
        fc.record({
          type: fc.constant('text' as const),
          text: fc.string({ minLength: 0, maxLength: 50 }),
        }),
        { minLength: 0, maxLength: 5 },
      ),
      { minLength: 0, maxLength: 5 },
    ),
  ])(
    'for ANY sequence of text-block chunks, accumulated blocks length === sum of chunk block lengths and text preserved in order',
    (blocksPerChunk) => {
      const chunks: ModelStreamChunk[] = blocksPerChunk.map((blocks) => ({
        content: { speaker: 'ai' as const, blocks },
      }));
      const result = chunks.reduce(
        (acc, chunk) => accumulateModelStreamChunk(acc, chunk),
        emptyModelOutput(),
      );
      const expectedBlocks = blocksPerChunk.flat();
      return (
        result.content.blocks.length === expectedBlocks.length &&
        result.content.blocks.every(
          (b, i) => b.type === 'text' && b.text === expectedBlocks[i].text,
        )
      );
    },
  );

  it.prop([fc.string({ minLength: 1, maxLength: 20 })])(
    'accumulate is pure: repeated accumulation yields same result',
    (text) => {
      const c1 = chunkWithText(text);
      const c2 = chunkWithText(text);
      const r1 = accumulateModelStreamChunk(
        accumulateModelStreamChunk(emptyModelOutput(), c1),
        c2,
      );
      const r2 = accumulateModelStreamChunk(
        accumulateModelStreamChunk(emptyModelOutput(), chunkWithText(text)),
        chunkWithText(text),
      );
      return JSON.stringify(r1) === JSON.stringify(r2);
    },
  );
});

// ---------------------------------------------------------------------------
// getToolCalls
// ---------------------------------------------------------------------------

describe('getToolCalls', () => {
  it('extracts id/name/args from tool_call blocks among mixed blocks, order preserved', () => {
    const output: ModelOutput = {
      content: {
        speaker: 'ai',
        blocks: [
          textBlock('thinking...'),
          toolCallBlock('t1', 'getWeather', { city: 'NYC' }),
          toolCallBlock('t2', 'getTime', { zone: 'EST' }),
          textBlock('done'),
        ],
      },
    };
    expect(getToolCalls(output)).toStrictEqual([
      { id: 't1', name: 'getWeather', args: { city: 'NYC' } },
      { id: 't2', name: 'getTime', args: { zone: 'EST' } },
    ]);
  });

  it('non-object parameters → args {}', () => {
    const output: ModelOutput = {
      content: {
        speaker: 'ai',
        blocks: [toolCallBlock('t1', 'noArgs', null)],
      },
    };
    expect(getToolCalls(output)).toStrictEqual([
      { id: 't1', name: 'noArgs', args: {} },
    ]);
  });

  it('array parameters → args {} (only plain object accepted)', () => {
    const output: ModelOutput = {
      content: {
        speaker: 'ai',
        blocks: [toolCallBlock('t1', 'arr', [1, 2, 3])],
      },
    };
    expect(getToolCalls(output)).toStrictEqual([
      { id: 't1', name: 'arr', args: {} },
    ]);
  });

  it('returns empty array when no tool_call blocks', () => {
    const output: ModelOutput = {
      content: { speaker: 'ai', blocks: [textBlock('hi')] },
    };
    expect(getToolCalls(output)).toStrictEqual([]);
  });

  it('returns empty array for empty blocks', () => {
    expect(getToolCalls(emptyModelOutput())).toStrictEqual([]);
  });
});

describe('getToolCalls property-based', () => {
  it.prop([
    fc.array(
      fc.record({
        id: fc.string({ minLength: 1, maxLength: 10 }),
        name: fc.string({ minLength: 1, maxLength: 15 }),
      }),
      { minLength: 0, maxLength: 8 },
    ),
  ])(
    'n tool_call blocks in → n ToolCallRequests out with matching names',
    (calls) => {
      const output: ModelOutput = {
        content: {
          speaker: 'ai',
          blocks: calls.map((c) => toolCallBlock(c.id, c.name, {})),
        },
      };
      const result = getToolCalls(output);
      return (
        result.length === calls.length &&
        result.every((r, i) => r.name === calls[i].name)
      );
    },
  );
});

// ---------------------------------------------------------------------------
// toModelStreamChunk
// ---------------------------------------------------------------------------

describe('toModelStreamChunk', () => {
  it('IContent metadata {stopReason, usage, id} → full chunk', () => {
    const ic: IContent = {
      speaker: 'ai',
      blocks: [textBlock('hello')],
      metadata: {
        stopReason: 'end_turn',
        usage: usage(1, 2, 3),
        id: 'resp-42',
      },
    };
    expect(toModelStreamChunk(ic)).toStrictEqual<ModelStreamChunk>({
      content: ic,
      rawStopReason: 'end_turn',
      finishReason: 'stop',
      usage: usage(1, 2, 3),
      responseId: 'resp-42',
    });
  });

  it('metadata.finishReason length (OpenAI) → max_tokens', () => {
    const ic: IContent = {
      speaker: 'ai',
      blocks: [],
      metadata: { finishReason: 'length' },
    };
    expect(toModelStreamChunk(ic)).toStrictEqual<ModelStreamChunk>({
      content: ic,
      rawStopReason: 'length',
      finishReason: 'max_tokens',
    });
  });

  it('metadata.stopReason MAX_TOKENS (Gemini) → max_tokens', () => {
    const ic: IContent = {
      speaker: 'ai',
      blocks: [],
      metadata: { stopReason: 'MAX_TOKENS' },
    };
    const result = toModelStreamChunk(ic);
    expect(result.rawStopReason).toBe('MAX_TOKENS');
    expect(result.finishReason).toBe('max_tokens');
  });

  it('unknown raw weird_reason → finishReason other, rawStopReason preserved', () => {
    const ic: IContent = {
      speaker: 'ai',
      blocks: [],
      metadata: { stopReason: 'weird_reason' },
    };
    const result = toModelStreamChunk(ic);
    expect(result.rawStopReason).toBe('weird_reason');
    expect(result.finishReason).toBe('other');
  });

  it('no metadata → bare chunk {content} with no extra keys', () => {
    const ic: IContent = {
      speaker: 'ai',
      blocks: [textBlock('hi')],
    };
    expect(toModelStreamChunk(ic)).toStrictEqual<ModelStreamChunk>({
      content: ic,
    });
  });

  it('already-canonical value passes through', () => {
    const ic: IContent = {
      speaker: 'ai',
      blocks: [],
      metadata: { finishReason: 'stop' },
    };
    const result = toModelStreamChunk(ic);
    expect(result.finishReason).toBe('stop');
    expect(result.rawStopReason).toBe('stop');
  });

  it('metadata.finishReason non-canonical value is mapped', () => {
    const ic: IContent = {
      speaker: 'ai',
      blocks: [],
      metadata: { finishReason: 'end_turn' },
    };
    const result = toModelStreamChunk(ic);
    expect(result.rawStopReason).toBe('end_turn');
    expect(result.finishReason).toBe('stop');
  });

  it('stopReason preferred over finishReason when both present', () => {
    const ic: IContent = {
      speaker: 'ai',
      blocks: [],
      metadata: { stopReason: 'end_turn', finishReason: 'length' },
    };
    const result = toModelStreamChunk(ic);
    expect(result.rawStopReason).toBe('end_turn');
    expect(result.finishReason).toBe('stop');
  });

  it('metadata present but no stop/finish/usage/id → bare content chunk', () => {
    const ic: IContent = {
      speaker: 'ai',
      blocks: [],
      metadata: { model: 'gpt-4' },
    };
    expect(toModelStreamChunk(ic)).toStrictEqual<ModelStreamChunk>({
      content: ic,
    });
  });
});

describe('toModelStreamChunk property-based', () => {
  it.prop([fc.constantFrom(...CANONICAL_FINISH_REASONS)])(
    'already-canonical raw passes through unchanged',
    (canonical: string) => {
      const ic: IContent = {
        speaker: 'ai',
        blocks: [],
        metadata: { stopReason: canonical },
      };
      const result = toModelStreamChunk(ic);
      return (
        result.finishReason === canonical && result.rawStopReason === canonical
      );
    },
  );

  it.prop([fc.string({ minLength: 0, maxLength: 30 })])(
    'any raw stopReason produces a canonical finishReason and preserves raw',
    (raw: string) => {
      const ic: IContent = {
        speaker: 'ai',
        blocks: [],
        metadata: { stopReason: raw },
      };
      const result = toModelStreamChunk(ic);
      expect(typeof result.finishReason).toBe('string');
      expect(CANONICAL_FINISH_REASON_SET.has(result.finishReason)).toBe(true);
      expect(result.rawStopReason).toBe(raw);
    },
  );

  it.prop([fc.string({ minLength: 0, maxLength: 20 })])(
    'toModelStreamChunk never mutates input IContent',
    (text) => {
      const ic: IContent = {
        speaker: 'ai',
        blocks: [textBlock(text)],
        metadata: { stopReason: 'end_turn', id: 'x' },
      };
      const snapshot = JSON.parse(JSON.stringify(ic));
      toModelStreamChunk(ic);
      return JSON.stringify(ic) === JSON.stringify(snapshot);
    },
  );

  it.prop([
    fc.record({
      promptTokens: fc.nat({ max: 10000 }),
      completionTokens: fc.nat({ max: 10000 }),
      totalTokens: fc.nat({ max: 20000 }),
    }),
  ])('toModelStreamChunk preserves usage byte-identical from metadata', (u) => {
    const ic: IContent = {
      speaker: 'ai',
      blocks: [],
      metadata: { usage: u },
    };
    const result = toModelStreamChunk(ic);
    return JSON.stringify(result.usage) === JSON.stringify(u);
  });

  it.prop([fc.string({ minLength: 1, maxLength: 30 })])(
    'toModelStreamChunk preserves id as responseId',
    (id) => {
      const ic: IContent = {
        speaker: 'ai',
        blocks: [],
        metadata: { id },
      };
      return toModelStreamChunk(ic).responseId === id;
    },
  );
});

// ---------------------------------------------------------------------------
// emptyModelOutput property-based
// ---------------------------------------------------------------------------

describe('emptyModelOutput property-based', () => {
  it.prop([fc.constantFrom('human', 'ai', 'tool')])(
    'always produces empty blocks array and correct speaker',
    (speaker) => {
      const out = emptyModelOutput(speaker);
      return (
        out.content.speaker === speaker &&
        Array.isArray(out.content.blocks) &&
        out.content.blocks.length === 0
      );
    },
  );

  it.prop([fc.constantFrom('human', 'ai', 'tool')])(
    'result has no optional keys regardless of speaker',
    (speaker) => {
      const out = emptyModelOutput(speaker);
      const optionalKeys = [
        'finishReason',
        'rawStopReason',
        'usage',
        'responseId',
        'providerMetadata',
        'hookRestrictions',
      ];
      return optionalKeys.every((key) => !(key in out));
    },
  );
});

// ---------------------------------------------------------------------------
// Additional accumulateModelStreamChunk property-based
// ---------------------------------------------------------------------------

describe('accumulateModelStreamChunk additional property-based', () => {
  it.prop([
    fc.record({
      a: fc.nat({ max: 100 }),
      b: fc.nat({ max: 100 }),
    }),
    fc.record({
      b: fc.nat({ max: 100 }),
      c: fc.nat({ max: 100 }),
    }),
  ])(
    'providerMetadata shallow-merge always has chunk keys overwrite acc keys',
    (accMeta, chunkMeta) => {
      const acc: ModelOutput = {
        content: { speaker: 'ai', blocks: [] },
        providerMetadata: accMeta,
      };
      const chunk: ModelStreamChunk = {
        content: { speaker: 'ai', blocks: [] },
        providerMetadata: chunkMeta,
      };
      const result = accumulateModelStreamChunk(acc, chunk);
      const merged = result.providerMetadata;
      if (!merged) return false;
      return (
        merged['b'] === chunkMeta['b'] &&
        merged['a'] === accMeta['a'] &&
        merged['c'] === chunkMeta['c']
      );
    },
  );

  it.prop([
    fc.record({
      promptTokens: fc.nat({ max: 1000 }),
      completionTokens: fc.nat({ max: 1000 }),
      totalTokens: fc.nat({ max: 2000 }),
    }),
  ])('usage from last chunk always wins', (finalUsage) => {
    const acc: ModelOutput = {
      content: { speaker: 'ai', blocks: [] },
      usage: usage(1, 1, 2),
    };
    const chunk: ModelStreamChunk = {
      content: { speaker: 'ai', blocks: [] },
      usage: finalUsage,
    };
    return (
      JSON.stringify(accumulateModelStreamChunk(acc, chunk).usage) ===
      JSON.stringify(finalUsage)
    );
  });

  it.prop([fc.array(textBlockArb(), { minLength: 0, maxLength: 3 })])(
    'accumulating into emptyModelOutput preserves block count',
    (blocks) => {
      const chunk: ModelStreamChunk = {
        content: { speaker: 'ai', blocks },
      };
      const result = accumulateModelStreamChunk(emptyModelOutput(), chunk);
      return result.content.blocks.length === blocks.length;
    },
  );

  it.prop([
    fc.array(
      fc.record({
        id: fc.string({ minLength: 1, maxLength: 10 }),
        name: fc.string({ minLength: 1, maxLength: 15 }),
        parameters: fc.record({ value: fc.nat({ max: 100 }) }),
      }),
      { minLength: 0, maxLength: 5 },
    ),
  ])(
    'getToolCalls extracts matching args when parameters is a plain object',
    (calls) => {
      const output: ModelOutput = {
        content: {
          speaker: 'ai',
          blocks: calls.map((c) => toolCallBlock(c.id, c.name, c.parameters)),
        },
      };
      const result = getToolCalls(output);
      return (
        result.length === calls.length &&
        result.every(
          (r, i) =>
            JSON.stringify(r.args) === JSON.stringify(calls[i].parameters),
        )
      );
    },
  );
});
