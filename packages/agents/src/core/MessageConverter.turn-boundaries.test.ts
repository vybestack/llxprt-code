/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for turn-boundary preservation through the
 * MessageConverter → TurnProcessor (stream) / DirectMessageProcessor (direct)
 * pipeline.
 *
 * Finding #1: createUserContentWithFunctionResponseFix and
 * normalizeToolInteractionInput must preserve IContent[] turn boundaries,
 * speakers, and metadata — not flatten all blocks into a single IContent.
 *
 * Tests the REAL normalizeToolInteractionInput with multi-turn inputs and
 * verifies each turn retains its own IContent entry with correct speaker.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeToolInteractionInput,
  createUserContentWithFunctionResponseFix,
} from './MessageConverter.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

describe('createUserContentWithFunctionResponseFix — turn boundary preservation', () => {
  it('returns a single IContent[] entry for a simple string input', () => {
    const result = createUserContentWithFunctionResponseFix('hello');
    expect(result).toHaveLength(1);
    expect(result[0].speaker).toBe('human');
    expect(result[0].blocks).toHaveLength(1);
  });

  it('preserves multiple IContent[] entries from multi-turn input', () => {
    const input: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'what files are here?' }],
        metadata: { timestamp: 1000 },
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-1',
            name: 'ls',
            parameters: {},
          },
        ],
        metadata: { timestamp: 1001 },
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call-1',
            toolName: 'ls',
            result: 'file1.txt',
          },
        ],
        metadata: { timestamp: 1002 },
      },
    ];
    const result = createUserContentWithFunctionResponseFix(input);
    // Must NOT flatten — 3 turns → 3 entries.
    expect(result).toHaveLength(3);
    expect(result[0].speaker).toBe('human');
    expect(result[1].speaker).toBe('ai');
    expect(result[2].speaker).toBe('tool');
    // Metadata preserved per entry.
    expect(result[0].metadata?.timestamp).toBe(1000);
    expect(result[1].metadata?.timestamp).toBe(1001);
    expect(result[2].metadata?.timestamp).toBe(1002);
  });

  it('preserves mixed human/ai/tool metadata through multi-turn input', () => {
    const input: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'do thing A' }],
        metadata: { id: 'turn-1', provider: 'openai' },
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'doing A' }],
        metadata: { id: 'turn-2', model: 'gpt-4' },
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'now do B' }],
        metadata: { id: 'turn-3', turnId: 't-3' },
      },
    ];
    const result = createUserContentWithFunctionResponseFix(input);
    expect(result).toHaveLength(3);
    // Each turn retains its own metadata.
    expect(result[0].metadata?.id).toBe('turn-1');
    expect(result[0].metadata?.provider).toBe('openai');
    expect(result[1].metadata?.id).toBe('turn-2');
    expect(result[1].metadata?.model).toBe('gpt-4');
    expect(result[2].metadata?.id).toBe('turn-3');
    expect(result[2].metadata?.turnId).toBe('t-3');
  });

  it('stamps tool speaker when all blocks in an entry are tool responses', () => {
    const input: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'tool_response',
            callId: 'c1',
            toolName: 'read',
            result: 'ok',
          },
          {
            type: 'tool_response',
            callId: 'c2',
            toolName: 'write',
            result: 'done',
          },
        ],
      },
    ];
    const result = createUserContentWithFunctionResponseFix(input);
    expect(result).toHaveLength(1);
    expect(result[0].speaker).toBe('tool');
    expect(result[0].blocks).toHaveLength(2);
  });

  it('splits mixed tool-response + continuation blocks into separate tool and human turns', () => {
    const input: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'here is the result:' },
          {
            type: 'tool_response',
            callId: 'c1',
            toolName: 'read',
            result: 'data',
          },
        ],
      },
    ];
    const result = createUserContentWithFunctionResponseFix(input);
    // Mixed blocks must be split: tool-response → tool turn, continuation
    // text → human turn. Order: tool first, then human continuation.
    expect(result).toHaveLength(2);
    expect(result[0].speaker).toBe('tool');
    expect(result[0].blocks).toHaveLength(1);
    expect(result[0].blocks[0].type).toBe('tool_response');
    expect(result[1].speaker).toBe('human');
    expect(result[1].blocks).toHaveLength(1);
    expect(result[1].blocks[0].type).toBe('text');
  });

  it('splits mixed tool-response + text preserving original entry order (tool then human)', () => {
    const input: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'tool_response',
            callId: 'c1',
            toolName: 'search',
            result: 'found',
          },
          { type: 'text', text: 'based on the above' },
        ],
      },
    ];
    const result = createUserContentWithFunctionResponseFix(input);
    expect(result).toHaveLength(2);
    // Tool response comes first (answers prior tool call), then text.
    expect(result[0].speaker).toBe('tool');
    expect(result[0].blocks[0]).toMatchObject({ type: 'tool_response' });
    expect(result[1].speaker).toBe('human');
    expect(result[1].blocks[0]).toMatchObject({
      type: 'text',
      text: 'based on the above',
    });
  });
});

describe('normalizeToolInteractionInput — turn boundary preservation (stream+direct)', () => {
  it('returns IContent[] with one entry per turn from multi-turn input', () => {
    const input: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'step 1' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'done step 1' }],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'step 2' }],
      },
    ];
    const result = normalizeToolInteractionInput(input);
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.speaker)).toStrictEqual([
      'human',
      'ai',
      'human',
    ]);
  });

  it('returns a single human turn for plain string input', () => {
    const result = normalizeToolInteractionInput('do something');
    expect(result).toHaveLength(1);
    expect(result[0].speaker).toBe('human');
    expect(result[0].blocks[0]).toStrictEqual({
      type: 'text',
      text: 'do something',
    });
  });

  it('preserves mixed human/ai/tool turns with full metadata', () => {
    const input: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'run tool X' }],
        metadata: { id: 'h1', timestamp: 100 },
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'tc1',
            name: 'toolX',
            parameters: { arg: 1 },
          },
        ],
        metadata: { id: 'a1', model: 'test-model' },
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'tc1',
            toolName: 'toolX',
            result: 'success',
          },
        ],
        metadata: { id: 't1' },
      },
    ];
    const result = normalizeToolInteractionInput(input);

    // All 3 turns preserved.
    expect(result).toHaveLength(3);

    // Turn 1: human with text block and metadata.
    expect(result[0].speaker).toBe('human');
    expect(result[0].blocks[0].type).toBe('text');
    expect(result[0].metadata?.id).toBe('h1');
    expect(result[0].metadata?.timestamp).toBe(100);

    // Turn 2: ai with tool_call and model metadata.
    expect(result[1].speaker).toBe('ai');
    expect(result[1].blocks[0].type).toBe('tool_call');
    expect(result[1].metadata?.id).toBe('a1');
    expect(result[1].metadata?.model).toBe('test-model');

    // Turn 3: tool with tool_response.
    expect(result[2].speaker).toBe('tool');
    expect(result[2].blocks[0].type).toBe('tool_response');
    expect(result[2].metadata?.id).toBe('t1');
  });

  it('does NOT flatten tool-response-only entries with text entries into one IContent', () => {
    const input: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'context' }],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'c1',
            toolName: 'read',
            result: 'data',
          },
        ],
      },
    ];
    const result = normalizeToolInteractionInput(input);
    // Must remain as 2 separate entries — NOT flattened.
    expect(result).toHaveLength(2);
    expect(result[0].speaker).toBe('human');
    expect(result[0].blocks).toHaveLength(1);
    expect(result[0].blocks[0].type).toBe('text');
    expect(result[1].speaker).toBe('tool');
    expect(result[1].blocks).toHaveLength(1);
    expect(result[1].blocks[0].type).toBe('tool_response');
  });
});

describe('normalizeToolInteractionInput — mixed tool-response + continuation normalization for provider payload', () => {
  it('splits a single mixed entry into tool then human turns for the provider payload', () => {
    const input: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'tool_response',
            callId: 'c1',
            toolName: 'read',
            result: 'data',
          },
          { type: 'text', text: 'continue with this' },
        ],
      },
    ];
    const result = normalizeToolInteractionInput(input);
    expect(result).toHaveLength(2);
    // Tool response must be a separate tool turn.
    expect(result[0].speaker).toBe('tool');
    expect(result[0].blocks).toHaveLength(1);
    expect(result[0].blocks[0].type).toBe('tool_response');
    // Continuation text must be a separate human turn.
    expect(result[1].speaker).toBe('human');
    expect(result[1].blocks).toHaveLength(1);
    expect(result[1].blocks[0].type).toBe('text');
    expect((result[1].blocks[0] as { text: string }).text).toBe(
      'continue with this',
    );
  });

  it('preserves multi-turn order when a mixed entry appears between pure entries', () => {
    const input: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'first message' }],
      },
      {
        speaker: 'human',
        blocks: [
          {
            type: 'tool_response',
            callId: 'c1',
            toolName: 'search',
            result: 'found',
          },
          { type: 'text', text: 'and here is my follow-up' },
        ],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'third message' }],
      },
    ];
    const result = normalizeToolInteractionInput(input);
    // The mixed entry is split into 2, so total = 4.
    expect(result).toHaveLength(4);
    // Order: human(text), tool(response), human(follow-up text), human(third).
    expect(result.map((c) => c.speaker)).toStrictEqual([
      'human',
      'tool',
      'human',
      'human',
    ]);
    expect(result[0].blocks[0]).toMatchObject({
      type: 'text',
      text: 'first message',
    });
    expect(result[1].blocks[0]).toMatchObject({ type: 'tool_response' });
    expect(result[2].blocks[0]).toMatchObject({
      type: 'text',
      text: 'and here is my follow-up',
    });
    expect(result[3].blocks[0]).toMatchObject({
      type: 'text',
      text: 'third message',
    });
  });

  it('preserves metadata on both split entries from a mixed block', () => {
    const input: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'tool_response',
            callId: 'c1',
            toolName: 'read',
            result: 'ok',
          },
          { type: 'text', text: 'next' },
        ],
        metadata: { id: 'mixed-turn', turnId: 't-1' },
      },
    ];
    const result = normalizeToolInteractionInput(input);
    expect(result).toHaveLength(2);
    expect(result[0].metadata?.id).toBe('mixed-turn');
    expect(result[0].metadata?.turnId).toBe('t-1');
    expect(result[1].metadata?.id).toBe('mixed-turn');
    expect(result[1].metadata?.turnId).toBe('t-1');
  });
});
