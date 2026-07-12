/**
 * @plan:PLAN-20260707-AGENTNEUTRAL.P04
 * @requirement:REQ-001.4, REQ-001.5
 *
 * Behavioral TDD tests for afcHistory on ModelOutput (REQ-001.4) and
 * providerMetadata preservation in toModelStreamChunk (REQ-001.5).
 * RED tests that fail via VALUE MISMATCH against the P03 stubs/current
 * implementation. P05 implements the real logic.
 */
import { describe, expect } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';
import {
  emptyModelOutput,
  accumulateModelStreamChunk,
  toModelStreamChunk,
  type ModelOutput,
  type ModelStreamChunk,
} from './modelEnvelope.js';
import type {
  IContent,
  TextBlock,
  ContentBlock,
} from '../services/history/IContent.js';

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

function textBlock(text: string): TextBlock {
  return { type: 'text', text };
}

function afcTurn(text: string): IContent {
  return { speaker: 'tool', blocks: [textBlock(text)] };
}

// ---------------------------------------------------------------------------
// afcHistory on ModelOutput — behavioral (REQ-001.4)
// ---------------------------------------------------------------------------

describe('ModelOutput.afcHistory', () => {
  it('ModelOutput can carry afcHistory: IContent[]', () => {
    const afc: IContent[] = [
      afcTurn('tool result A'),
      afcTurn('tool result B'),
    ];
    const output: ModelOutput = {
      content: { speaker: 'ai', blocks: [textBlock('response')] },
      afcHistory: afc,
    };
    expect(output.afcHistory).toStrictEqual<IContent[]>(afc);
  });

  it('afcHistory is typed as IContent[] (neutral, not Google shape)', () => {
    const output: ModelOutput = {
      content: { speaker: 'ai', blocks: [] },
      afcHistory: [
        {
          speaker: 'tool',
          blocks: [
            { type: 'tool_response', callId: 'c1', toolName: 't', result: 42 },
          ],
        },
      ],
    };
    expect(output.afcHistory).toHaveLength(1);
    expect(output.afcHistory?.[0].speaker).toBe('tool');
    expect(output.afcHistory?.[0].blocks[0].type).toBe('tool_response');
  });

  it('afcHistory undefined when not set', () => {
    const output: ModelOutput = {
      content: { speaker: 'ai', blocks: [] },
    };
    expect(output.afcHistory).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// accumulateModelStreamChunk preserves afcHistory — behavioral (REQ-001.4)
// ---------------------------------------------------------------------------

describe('accumulateModelStreamChunk preserves afcHistory', () => {
  it('afcHistory from chunk survives accumulation', () => {
    const afc: IContent[] = [afcTurn('result')];
    const acc = emptyModelOutput();
    const chunk: ModelStreamChunk = {
      content: { speaker: 'ai', blocks: [textBlock('text')] },
      afcHistory: afc,
    };
    const result = accumulateModelStreamChunk(acc, chunk);
    expect(result.afcHistory).toStrictEqual<IContent[]>(afc);
  });

  it('afcHistory on acc preserved when chunk omits it', () => {
    const afc: IContent[] = [afcTurn('existing')];
    const acc: ModelOutput = {
      content: { speaker: 'ai', blocks: [] },
      afcHistory: afc,
    };
    const chunk: ModelStreamChunk = {
      content: { speaker: 'ai', blocks: [textBlock('more')] },
    };
    const result = accumulateModelStreamChunk(acc, chunk);
    expect(result.afcHistory).toStrictEqual<IContent[]>(afc);
  });

  it('afcHistory from chunk overrides acc (last-write-wins)', () => {
    const accAfc: IContent[] = [afcTurn('old')];
    const chunkAfc: IContent[] = [afcTurn('new')];
    const acc: ModelOutput = {
      content: { speaker: 'ai', blocks: [] },
      afcHistory: accAfc,
    };
    const chunk: ModelStreamChunk = {
      content: { speaker: 'ai', blocks: [] },
      afcHistory: chunkAfc,
    };
    const result = accumulateModelStreamChunk(acc, chunk);
    expect(result.afcHistory).toStrictEqual<IContent[]>(chunkAfc);
  });
});

// ---------------------------------------------------------------------------
// accumulateModelStreamChunk afcHistory — property-based (REQ-001.4)
// ---------------------------------------------------------------------------

describe('accumulateModelStreamChunk afcHistory property-based', () => {
  it.prop([
    fc.array(
      fc.record({
        type: fc.constant('text' as const),
        text: fc.string({ minLength: 1, maxLength: 30 }),
      }),
      { minLength: 0, maxLength: 5 },
    ),
  ])('afcHistory from chunk always survives accumulation', (blockTexts) => {
    const blocks: ContentBlock[] = blockTexts.map((b) => textBlock(b.text));
    const afc: IContent[] = [{ speaker: 'tool', blocks }];
    const chunk: ModelStreamChunk = {
      content: { speaker: 'ai', blocks: [textBlock('x')] },
      afcHistory: afc,
    };
    const result = accumulateModelStreamChunk(emptyModelOutput(), chunk);
    expect(result.afcHistory).toStrictEqual(afc);
  });
});

// ---------------------------------------------------------------------------
// toModelStreamChunk providerMetadata — behavioral (REQ-001.5)
// ---------------------------------------------------------------------------

describe('toModelStreamChunk preserves providerMetadata', () => {
  it('IContent with metadata.providerMetadata → chunk.providerMetadata populated', () => {
    const providerMeta = {
      'gemini.safetyRatings': [
        { category: 'HARM_CATEGORY', probability: 'LOW' },
      ],
    };
    const ic: IContent = {
      speaker: 'ai',
      blocks: [textBlock('hello')],
      metadata: { providerMetadata: providerMeta },
    };
    const chunk = toModelStreamChunk(ic);
    expect(chunk.providerMetadata).toStrictEqual(providerMeta);
  });

  it('IContent with metadata.id → chunk.responseId set', () => {
    const ic: IContent = {
      speaker: 'ai',
      blocks: [textBlock('hello')],
      metadata: { id: 'resp-12345' },
    };
    const chunk = toModelStreamChunk(ic);
    expect(chunk.responseId).toBe('resp-12345');
  });

  it('block-level providerMetadata survives (by reference/deep-equal)', () => {
    const blockMeta = { 'gemini.groundingMetadata': { sources: ['url1'] } };
    const block: TextBlock = {
      type: 'text',
      text: 'grounded answer',
      providerMetadata: blockMeta,
    };
    const ic: IContent = {
      speaker: 'ai',
      blocks: [block],
    };
    const chunk = toModelStreamChunk(ic);
    const resultBlock = chunk.content.blocks[0] as TextBlock;
    expect(resultBlock.providerMetadata).toStrictEqual(blockMeta);
  });

  it('both response-level and block-level providerMetadata survive together', () => {
    const responseMeta = {
      'gemini.usageMetadata': { cachedContentTokenCount: 5 },
    };
    const blockMeta = { 'gemini.citation': { index: 0 } };
    const ic: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'x', providerMetadata: blockMeta }],
      metadata: { providerMetadata: responseMeta },
    };
    const chunk = toModelStreamChunk(ic);
    expect(chunk.providerMetadata).toStrictEqual(responseMeta);
    expect(
      (chunk.content.blocks[0] as TextBlock).providerMetadata,
    ).toStrictEqual(blockMeta);
  });

  it('IContent without metadata.providerMetadata → chunk has no providerMetadata key', () => {
    const ic: IContent = {
      speaker: 'ai',
      blocks: [textBlock('plain')],
    };
    const chunk = toModelStreamChunk(ic);
    expect(chunk).not.toHaveProperty('providerMetadata');
  });
});

// ---------------------------------------------------------------------------
// toModelStreamChunk providerMetadata — property-based (REQ-001.5)
// ---------------------------------------------------------------------------

describe('toModelStreamChunk providerMetadata property-based', () => {
  it.prop([
    fc.dictionary(
      fc.string({ minLength: 1, maxLength: 30 }),
      fc.oneof(
        fc.string({ maxLength: 20 }),
        fc.nat({ max: 1000 }),
        fc.boolean(),
        fc.array(fc.string({ maxLength: 10 }), { maxLength: 5 }),
      ),
    ),
  ])(
    'for ANY metadata.providerMetadata record, every key survives onto chunk.providerMetadata',
    (providerMeta) => {
      const ic: IContent = {
        speaker: 'ai',
        blocks: [textBlock('x')],
        metadata: { providerMetadata: providerMeta },
      };
      const chunk = toModelStreamChunk(ic);
      expect(Object.entries(chunk.providerMetadata ?? {})).toStrictEqual(
        Object.entries(providerMeta),
      );
    },
  );

  it.prop([fc.string({ minLength: 1, maxLength: 40 })])(
    'metadata.id always becomes chunk.responseId',
    (id) => {
      const ic: IContent = {
        speaker: 'ai',
        blocks: [],
        metadata: { id },
      };
      return toModelStreamChunk(ic).responseId === id;
    },
  );

  it.prop([
    fc.record({
      thought: fc.string({ minLength: 1, maxLength: 20 }),
    }),
  ])(
    'block-level providerMetadata on a thinking block survives toModelStreamChunk',
    ({ thought }) => {
      const blockMeta = { 'anthropic.thinking': { redacted: true } };
      const ic: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'thinking', thought, providerMetadata: blockMeta }],
      };
      const chunk = toModelStreamChunk(ic);
      const tb = chunk.content.blocks.find(
        (b): b is { type: 'thinking'; providerMetadata?: unknown } =>
          b.type === 'thinking',
      );
      expect(tb?.providerMetadata).toStrictEqual(blockMeta);
    },
  );
});
