/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-008.1, REQ-008.2
 * @pseudocode lines 100-103
 */
import { describe, expect } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';
import type {
  CountTokensRequest,
  CountTokensResult,
  EmbedContentRequest,
  EmbedContentResult,
} from './tokensAndEmbeddings.js';
import type { IContent, ContentBlock } from '../services/history/IContent.js';

describe('CountTokensRequest / Result', () => {
  it('constructs a count tokens request with contents', () => {
    const req: CountTokensRequest = {
      contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] }],
    };
    expect(req.contents).toHaveLength(1);
  });

  it('constructs a count tokens result with totalTokens', () => {
    const result: CountTokensResult = { totalTokens: 42 };
    expect(result.totalTokens).toBe(42);
  });

  it('allows empty contents array', () => {
    const req: CountTokensRequest = { contents: [] };
    expect(req.contents).toHaveLength(0);
  });
});

describe('EmbedContentRequest / Result', () => {
  it('constructs an embed request with texts', () => {
    const req: EmbedContentRequest = { texts: ['hello', 'world'] };
    expect(req.texts).toStrictEqual(['hello', 'world']);
  });

  it('constructs an embed result with vector embeddings', () => {
    const result: EmbedContentResult = {
      embeddings: [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ],
    };
    expect(result.embeddings).toHaveLength(2);
    expect(result.embeddings[0]).toStrictEqual([0.1, 0.2, 0.3]);
  });

  it('allows empty texts array', () => {
    const req: EmbedContentRequest = { texts: [] };
    expect(req.texts).toHaveLength(0);
  });

  it('allows empty embeddings result', () => {
    const result: EmbedContentResult = { embeddings: [] };
    expect(result.embeddings).toHaveLength(0);
  });
});

describe('integration with IContent', () => {
  it('CountTokensRequest accepts real IContent shapes', () => {
    const contents: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'world' }] },
    ];
    const req: CountTokensRequest = { contents };
    expect(req.contents).toBe(contents);
  });
});

// ============================================================================
// Property-based tests
// ============================================================================

describe('tokensAndEmbeddings property-based', () => {
  it.prop([fc.nat({ max: 1000000 })])(
    'CountTokensResult totalTokens round-trips through JSON unchanged',
    (totalTokens: number) => {
      const result: CountTokensResult = { totalTokens };
      const roundTripped: CountTokensResult = JSON.parse(
        JSON.stringify(result),
      );
      return roundTripped.totalTokens === totalTokens;
    },
  );

  it.prop([
    fc.array(fc.string({ minLength: 1, maxLength: 50 }), {
      minLength: 0,
      maxLength: 10,
    }),
  ])(
    'EmbedContentRequest texts round-trip preserving order and content',
    (texts: string[]) => {
      const req: EmbedContentRequest = { texts };
      const roundTripped: EmbedContentRequest = JSON.parse(JSON.stringify(req));
      return (
        roundTripped.texts.length === texts.length &&
        roundTripped.texts.every((t, i) => t === texts[i])
      );
    },
  );

  it.prop([
    fc.array(
      fc.array(
        // Exclude -0: JSON.stringify(-0) → "0" → JSON.parse → +0, so -0 is
        // not losslessly round-trippable. Object.is (below) would correctly
        // flag it; filtering it scopes the property to JSON-lossless doubles.
        // Exclude ±Infinity: JSON.stringify(Infinity) → "null". noNaN:true
        // does NOT exclude Infinity, so Number.isFinite is required.
        fc
          .double({ noNaN: true })
          .filter((v) => Number.isFinite(v) && !Object.is(v, -0)),
        {
          minLength: 1,
          maxLength: 10,
        },
      ),
      { minLength: 0, maxLength: 5 },
    ),
  ])(
    'EmbedContentResult embeddings preserve dimensions through JSON round-trip',
    (embeddings: number[][]) => {
      const result: EmbedContentResult = { embeddings };
      const roundTripped: EmbedContentResult = JSON.parse(
        JSON.stringify(result),
      );
      return (
        roundTripped.embeddings.length === embeddings.length &&
        roundTripped.embeddings.every(
          (vec, i) =>
            vec.length === embeddings[i].length &&
            vec.every((v, j) => Object.is(v, embeddings[i][j])),
        )
      );
    },
  );

  it.prop([
    fc.array(
      fc.oneof(
        fc.record({
          type: fc.constant('text' as const),
          text: fc.string({ minLength: 1, maxLength: 30 }),
        }),
        fc.record({
          type: fc.constant('code' as const),
          code: fc.string({ minLength: 1, maxLength: 30 }),
          language: fc.option(fc.string()),
        }),
      ),
      { minLength: 0, maxLength: 5 },
    ),
  ])(
    'CountTokensRequest contents length is preserved through JSON round-trip',
    (blocks: ContentBlock[]) => {
      const contents: IContent[] = [{ speaker: 'human' as const, blocks }];
      const req: CountTokensRequest = { contents };
      const roundTripped: CountTokensRequest = JSON.parse(JSON.stringify(req));
      return (
        roundTripped.contents.length === 1 &&
        JSON.stringify(roundTripped.contents[0].blocks) ===
          JSON.stringify(blocks)
      );
    },
  );
});
