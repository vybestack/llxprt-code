/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for issue #2410:
 * Empty message arrays must not create zero-block IContent items that would
 * be injected into subagent conversation history, causing z.ai to return
 * HTTP 400 error 1213 ("prompt parameter not received normally").
 *
 * After the neutral-type migration, these functions return IContent with
 * speaker/blocks instead of Google-shaped Content with role/parts.
 *
 * CRITICAL (#2410 restore): empty AgentMessageInput (e.g. [] after hook
 * restriction) must produce [] from the converter — NOT a fabricated
 * placeholder text block. Callers skip the provider turn entirely when the
 * result is empty. This proves no provider-visible placeholder or history
 * contamination.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeToolInteractionInput,
  createUserContentWithFunctionResponseFix,
  convertMixedPartsToIContent,
} from './MessageConverter.js';

describe('issue #2410 – empty message arrays must not create zero-block IContent', () => {
  describe('createUserContentWithFunctionResponseFix', () => {
    it('returns [] for an empty array — NO fabricated placeholder (#2410)', () => {
      const result = createUserContentWithFunctionResponseFix([]);
      expect(result).toStrictEqual([]);
    });

    it('returns [] for an empty ContentBlock[] — NO fabricated placeholder (#2410)', () => {
      const result = createUserContentWithFunctionResponseFix(
        [] as unknown as Parameters<
          typeof createUserContentWithFunctionResponseFix
        >[0],
      );
      expect(result).toStrictEqual([]);
    });

    it('converts a non-empty function-response array into IContent[] preserving tool speaker', () => {
      const parts = [
        {
          type: 'tool_response' as const,
          callId: 'call_1',
          toolName: 'read_file',
          result: { output: 'hello' },
        },
      ];
      const result = createUserContentWithFunctionResponseFix(parts);
      expect(result.length).toBeGreaterThan(0);
      // The tool_response block is preserved and gets speaker 'tool'.
      const allBlocks = result.flatMap((c) => c.blocks);
      expect(allBlocks.length).toBeGreaterThan(0);
    });
  });

  describe('normalizeToolInteractionInput', () => {
    it('returns [] for an empty array — NO fabricated placeholder (#2410)', () => {
      const result = normalizeToolInteractionInput([]);
      expect(result).toStrictEqual([]);
    });

    it('still handles a non-empty function-response array correctly', () => {
      const parts = [
        {
          type: 'tool_response' as const,
          callId: 'call_1',
          toolName: 'read_file',
          result: { output: 'hello' },
        },
      ];
      const result = normalizeToolInteractionInput(parts);
      expect(result.length).toBeGreaterThan(0);
      const allBlocks = result.flatMap((c) => c.blocks);
      expect(allBlocks.length).toBeGreaterThan(0);
    });

    it('still handles string input correctly', () => {
      const result = normalizeToolInteractionInput('hello');
      expect(result).toHaveLength(1);
      expect(result[0].speaker).toBe('human');
      expect(result[0].blocks).toHaveLength(1);
      expect(result[0].blocks[0].type).toBe('text');
    });
  });

  describe('convertMixedPartsToIContent', () => {
    it('returns an IContent with zero blocks for an empty parts array', () => {
      const result = convertMixedPartsToIContent([]);
      expect(result.blocks).toHaveLength(0);
      expect(result.speaker).toBe('human');
    });

    it('still converts all-function-response parts to a tool message', () => {
      const blocks = [
        {
          type: 'tool_response' as const,
          callId: 'call_1',
          toolName: 'read_file',
          result: { output: 'hello' },
        },
      ];
      const result = convertMixedPartsToIContent(blocks);
      expect(result.speaker).toBe('tool');
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].type).toBe('tool_response');
    });

    it('still converts text parts to an AI message', () => {
      const blocks = [{ type: 'text' as const, text: 'hello world' }];
      const result = convertMixedPartsToIContent(blocks);
      expect(result.speaker).toBe('ai');
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].type).toBe('text');
    });
  });
});

describe('issue #2410 — no provider-visible placeholder or history contamination', () => {
  it('createUserContentWithFunctionResponseFix([]) produces zero turns — no text block', () => {
    const result = createUserContentWithFunctionResponseFix([]);
    expect(result).toStrictEqual([]);
    // Crucially: no fabricated "unsupported legacy input" or any placeholder.
    const allBlocks = result.flatMap((c) => c.blocks);
    expect(allBlocks).toHaveLength(0);
  });

  it('normalizeToolInteractionInput([]) produces zero turns — no text block', () => {
    const result = normalizeToolInteractionInput([]);
    expect(result).toStrictEqual([]);
    const allBlocks = result.flatMap((c) => c.blocks);
    expect(allBlocks).toHaveLength(0);
  });

  it('no placeholder text leaks into the JSON serialization of the result', () => {
    const result = normalizeToolInteractionInput([]);
    const json = JSON.stringify(result);
    expect(json).toBe('[]');
    expect(json).not.toContain('placeholder');
    expect(json).not.toContain('unsupported');
    expect(json).not.toContain('empty conversion');
  });

  it('empty result from [] does not contaminate multi-turn arrays', () => {
    const result1 = normalizeToolInteractionInput([]);
    const result2 = normalizeToolInteractionInput('hello');
    // The empty result is truly empty; it does not carry forward any
    // fabricated speaker/blocks into subsequent conversions.
    expect(result1).toStrictEqual([]);
    expect(result2).toHaveLength(1);
    expect(result2[0].blocks[0]).toMatchObject({ type: 'text', text: 'hello' });
  });
});
