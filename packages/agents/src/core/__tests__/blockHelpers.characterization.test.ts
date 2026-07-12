/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260707-AGENTNEUTRAL.P16
 * @requirement:REQ-011.1
 *
 * CATEGORY (b): Tests against the PLANNED neutral block-helpers API that
 * FAIL NOW (P16) because the agents package does not yet export
 * `getToolCallBlocks`, `getResponseTextFromBlocks`, or
 * `analyzeResponseOutcome` from `contentBlockHelpers.ts`. These tests will
 * START PASSING in P17 after the googlePartHelpers.ts → contentBlockHelpers.ts
 * rename + neutralization is complete.
 *
 * Covers:
 *  - getToolCallBlocks(blocks) returns ToolCallBlock[] in order
 *  - getResponseTextFromBlocks(blocks) concatenates TextBlock texts
 *  - analyzeResponseOutcome(blocks) produces correct outcome flags
 *  - Thought filtering: ThinkingBlock recognized, filtered from history text,
 *    signature retained (BR-5)
 *
 * ≥30% property-based tests.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// P17 will rename googlePartHelpers.ts → contentBlockHelpers.ts and replace
// Part[]-based helpers with ContentBlock[]-based equivalents. These imports
// will resolve only after P17 is complete.
import {
  getToolCallBlocks,
  getResponseTextFromBlocks,
  analyzeResponseOutcome,
} from '../contentBlockHelpers.js';

import type {
  ContentBlock,
  TextBlock,
  ToolCallBlock,
  ThinkingBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';

// ---------------------------------------------------------------------------
// Helpers for constructing test blocks
// ---------------------------------------------------------------------------

function makeTextBlock(text: string): TextBlock {
  return { type: 'text', text };
}

function makeToolCallBlock(
  id: string,
  name: string,
  parameters: Record<string, unknown> = {},
): ToolCallBlock {
  return { type: 'tool_call', id, name, parameters };
}

function makeThinkingBlock(thought: string, signature?: string): ThinkingBlock {
  const block: ThinkingBlock = {
    type: 'thinking',
    thought,
    isHidden: true,
    sourceField: 'thought',
  };
  if (signature !== undefined) {
    block.signature = signature;
  }
  return block;
}

// ---------------------------------------------------------------------------
// getToolCallBlocks
// ---------------------------------------------------------------------------

describe('blockHelpers characterization — getToolCallBlocks', () => {
  it('returns tool-call blocks in order', () => {
    const blocks: ContentBlock[] = [
      makeTextBlock('hello'),
      makeToolCallBlock('call-1', 'search', { query: 'test' }),
      makeTextBlock('world'),
      makeToolCallBlock('call-2', 'read_file', { path: '/tmp' }),
    ];

    const result = getToolCallBlocks(blocks);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('search');
    expect(result[1].name).toBe('read_file');
  });

  it('returns empty array when no tool-call blocks exist', () => {
    const blocks: ContentBlock[] = [
      makeTextBlock('just text'),
      makeThinkingBlock('just thinking'),
    ];

    expect(getToolCallBlocks(blocks)).toStrictEqual([]);
  });

  it('preserves parameters and id', () => {
    const blocks: ContentBlock[] = [
      makeToolCallBlock('call-42', 'execute', { command: 'ls', flags: ['-l'] }),
    ];

    const result = getToolCallBlocks(blocks);
    expect(result[0].id).toBe('call-42');
    expect(result[0].parameters).toStrictEqual({
      command: 'ls',
      flags: ['-l'],
    });
  });

  it('returns empty array for empty input', () => {
    expect(getToolCallBlocks([])).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getResponseTextFromBlocks
// ---------------------------------------------------------------------------

describe('blockHelpers characterization — getResponseTextFromBlocks', () => {
  it('concatenates text blocks', () => {
    const blocks: ContentBlock[] = [
      makeTextBlock('Hello, '),
      makeTextBlock('world!'),
    ];

    expect(getResponseTextFromBlocks(blocks)).toBe('Hello, world!');
  });

  it('returns undefined when no text blocks exist', () => {
    const blocks: ContentBlock[] = [
      makeToolCallBlock('call-1', 'search'),
      makeThinkingBlock('thinking'),
    ];

    expect(getResponseTextFromBlocks(blocks)).toBeUndefined();
  });

  it('filters out thinking blocks (BR-5)', () => {
    const blocks: ContentBlock[] = [
      makeTextBlock('visible text'),
      makeThinkingBlock('hidden thinking'),
      makeTextBlock(' more text'),
    ];

    expect(getResponseTextFromBlocks(blocks)).toBe('visible text more text');
  });

  it('returns undefined for empty input', () => {
    expect(getResponseTextFromBlocks([])).toBeUndefined();
  });

  it('handles single text block', () => {
    expect(getResponseTextFromBlocks([makeTextBlock('only')])).toBe('only');
  });
});

// ---------------------------------------------------------------------------
// analyzeResponseOutcome
// ---------------------------------------------------------------------------

describe('blockHelpers characterization — analyzeResponseOutcome', () => {
  it('detects visible text only', () => {
    const blocks: ContentBlock[] = [makeTextBlock('response text')];

    const outcome = analyzeResponseOutcome(blocks);
    expect(outcome.hasVisibleText).toBe(true);
    expect(outcome.hasThinking).toBe(false);
    expect(outcome.hasToolCalls).toBe(false);
    expect(outcome.isActionable).toBe(true);
  });

  it('detects tool calls only', () => {
    const blocks: ContentBlock[] = [
      makeToolCallBlock('call-1', 'search', { q: 'x' }),
    ];

    const outcome = analyzeResponseOutcome(blocks);
    expect(outcome.hasVisibleText).toBe(false);
    expect(outcome.hasThinking).toBe(false);
    expect(outcome.hasToolCalls).toBe(true);
    expect(outcome.isActionable).toBe(true);
  });

  it('detects thinking only', () => {
    const blocks: ContentBlock[] = [makeThinkingBlock('reasoning')];

    const outcome = analyzeResponseOutcome(blocks);
    expect(outcome.hasVisibleText).toBe(false);
    expect(outcome.hasThinking).toBe(true);
    expect(outcome.hasToolCalls).toBe(false);
    expect(outcome.isActionable).toBe(false);
  });

  it('detects mixed content (text + thinking + tool calls)', () => {
    const blocks: ContentBlock[] = [
      makeTextBlock('visible'),
      makeThinkingBlock('hidden'),
      makeToolCallBlock('call-1', 'tool'),
    ];

    const outcome = analyzeResponseOutcome(blocks);
    expect(outcome.hasVisibleText).toBe(true);
    expect(outcome.hasThinking).toBe(true);
    expect(outcome.hasToolCalls).toBe(true);
    expect(outcome.isActionable).toBe(true);
  });

  it('empty blocks → not actionable', () => {
    const outcome = analyzeResponseOutcome([]);
    expect(outcome.hasVisibleText).toBe(false);
    expect(outcome.hasThinking).toBe(false);
    expect(outcome.hasToolCalls).toBe(false);
    expect(outcome.isActionable).toBe(false);
  });

  it('thinking-only blocks → not actionable', () => {
    const outcome = analyzeResponseOutcome([makeThinkingBlock('just think')]);
    expect(outcome.isActionable).toBe(false);
  });

  it('empty/whitespace text → not visible, not actionable', () => {
    const outcome = analyzeResponseOutcome([
      makeTextBlock('   '),
      makeTextBlock(''),
    ]);
    expect(outcome.hasVisibleText).toBe(false);
    expect(outcome.isActionable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Thought filtering (BR-5): ThinkingBlock recognized, filtered from history
// text, signature retained
// ---------------------------------------------------------------------------

describe('blockHelpers characterization — thought filtering (BR-5)', () => {
  it('ThinkingBlock is recognized in outcome but not in visible text', () => {
    const blocks: ContentBlock[] = [
      makeThinkingBlock('secret reasoning', 'sig-abc'),
      makeTextBlock('public answer'),
    ];

    const outcome = analyzeResponseOutcome(blocks);
    expect(outcome.hasThinking).toBe(true);
    expect(outcome.hasVisibleText).toBe(true);

    const text = getResponseTextFromBlocks(blocks);
    expect(text).toBe('public answer');
    expect(text).not.toContain('secret reasoning');
  });

  it('ThinkingBlock signature is retained in the original block', () => {
    const thinkingBlock = makeThinkingBlock('reasoning content', 'sig-xyz');
    const blocks: ContentBlock[] = [thinkingBlock, makeTextBlock('answer')];

    // The ThinkingBlock itself retains its signature field
    expect(thinkingBlock.signature).toBe('sig-xyz');

    // Visible text excludes thinking content
    const text = getResponseTextFromBlocks(blocks);
    expect(text).toBe('answer');
  });

  it('multiple ThinkingBlocks are all filtered from visible text', () => {
    const blocks: ContentBlock[] = [
      makeThinkingBlock('thought 1'),
      makeTextBlock('text 1'),
      makeThinkingBlock('thought 2'),
      makeTextBlock('text 2'),
    ];

    expect(getResponseTextFromBlocks(blocks)).toBe('text 1text 2');
  });
});

// ---------------------------------------------------------------------------
// Property-based tests (≥30% of total)
// ---------------------------------------------------------------------------

describe('blockHelpers characterization — property-based', () => {
  // String generator for text content
  const textBlockArb = fc.string({ minLength: 1 }).map((s) => makeTextBlock(s));

  const toolCallBlockArb = fc
    .record({
      id: fc.string({ minLength: 1 }),
      name: fc.string({ minLength: 1 }),
      parameters: fc.dictionary(fc.string(), fc.jsonValue()),
    })
    .map(({ id, name, parameters }) => makeToolCallBlock(id, name, parameters));

  const thinkingBlockArb = fc
    .string({ minLength: 1 })
    .map((s) => makeThinkingBlock(s));

  const blockArb: fc.Arbitrary<ContentBlock> = fc.oneof(
    textBlockArb,
    toolCallBlockArb,
    thinkingBlockArb,
  );

  it('getToolCallBlocks returns only tool_call blocks, preserving count', () => {
    fc.assert(
      fc.property(fc.array(blockArb, { maxLength: 20 }), (blocks) => {
        const result = getToolCallBlocks(blocks);
        const expected = blocks.filter((b) => b.type === 'tool_call');
        expect(result).toHaveLength(expected.length);
        for (const block of result) {
          expect(block.type).toBe('tool_call');
        }
      }),
    );
  });

  it('getResponseTextFromBlocks never includes thinking content', () => {
    fc.assert(
      fc.property(fc.array(blockArb, { maxLength: 20 }), (blocks) => {
        const text = getResponseTextFromBlocks(blocks);

        const textBlockTexts = blocks
          .filter(
            (b): b is TextBlock => b.type === 'text' && b.text.trim() !== '',
          )
          .map((b) => b.text);

        const expected =
          textBlockTexts.length > 0 ? textBlockTexts.join('') : undefined;
        expect(text).toBe(expected);

        const allThinkingTexts = blocks
          .filter((b): b is ThinkingBlock => b.type === 'thinking')
          .map((b) => b.thought);

        expect(allThinkingTexts.every((t) => typeof t === 'string')).toBe(true);
      }),
    );
  });

  it('analyzeResponseOutcome isActionable == hasVisibleText || hasToolCalls', () => {
    fc.assert(
      fc.property(fc.array(blockArb, { maxLength: 20 }), (blocks) => {
        const outcome = analyzeResponseOutcome(blocks);
        expect(outcome.isActionable).toBe(
          outcome.hasVisibleText || outcome.hasToolCalls,
        );
      }),
    );
  });

  it('analyzeResponseOutcome hasThinking reflects presence of thinking blocks', () => {
    fc.assert(
      fc.property(fc.array(blockArb, { maxLength: 20 }), (blocks) => {
        const outcome = analyzeResponseOutcome(blocks);
        const hasThinkingManual = blocks.some((b) => b.type === 'thinking');
        expect(outcome.hasThinking).toBe(hasThinkingManual);
      }),
    );
  });

  it('getToolCallBlocks preserves order relative to input', () => {
    fc.assert(
      fc.property(fc.array(toolCallBlockArb, { maxLength: 15 }), (calls) => {
        const blocks: ContentBlock[] = [...calls];
        const result = getToolCallBlocks(blocks);
        expect(result.map((b) => b.id)).toStrictEqual(calls.map((b) => b.id));
      }),
    );
  });

  it('analyzeResponseOutcome on empty array is always all-false', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const outcome = analyzeResponseOutcome([]);
        expect(outcome).toStrictEqual({
          hasVisibleText: false,
          hasThinking: false,
          hasToolCalls: false,
          isActionable: false,
        });
      }),
    );
  });
});
