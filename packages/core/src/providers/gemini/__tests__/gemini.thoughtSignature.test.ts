/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { Part } from '@google/genai';
import {
  ensureActiveLoopHasThoughtSignatures,
  stripThoughtsFromHistory,
  SYNTHETIC_THOUGHT_SIGNATURE,
} from '../thoughtSignatures.js';

/**
 * Tests for Gemini 3.x thought signature handling.
 *
 * Gemini 3.x models require that functionCall parts in the "active loop"
 * have a thoughtSignature property. The active loop is defined as all
 * content from the last user message with text to the end of the history.
 *
 * See: https://ai.google.dev/gemini-api/docs/thought-signatures
 */
describe('ensureActiveLoopHasThoughtSignatures', () => {
  interface Content {
    role: string;
    parts: Part[];
  }

  it('should add thoughtSignature to the first functionCall in each model turn of the active loop', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'Old message' }] },
      {
        role: 'model',
        parts: [{ functionCall: { name: 'old_tool', args: {} } }],
      },
      // Start of active loop (last user text message)
      { role: 'user', parts: [{ text: 'New message' }] },
      {
        role: 'model',
        parts: [
          { functionCall: { name: 'tool1', args: {} } },
          { functionCall: { name: 'tool2', args: {} } },
        ],
      },
      {
        role: 'user',
        parts: [{ functionResponse: { name: 'tool1', response: {} } }],
      },
      {
        role: 'model',
        parts: [
          {
            functionCall: { name: 'tool_with_sig', args: {} },
            thoughtSignature: 'existing-sig',
          } as Part,
          { functionCall: { name: 'another_tool', args: {} } },
        ],
      },
    ];

    const newContents = ensureActiveLoopHasThoughtSignatures(history);

    // Outside active loop - unchanged
    expect(
      (newContents[1]?.parts?.[0] as Part & { thoughtSignature?: string })
        ?.thoughtSignature,
    ).toBeUndefined();

    // Inside active loop, first model turn
    // First function call gets a signature
    expect(
      (newContents[3]?.parts?.[0] as Part & { thoughtSignature?: string })
        ?.thoughtSignature,
    ).toBe(SYNTHETIC_THOUGHT_SIGNATURE);
    // Second function call does NOT get a signature
    expect(
      (newContents[3]?.parts?.[1] as Part & { thoughtSignature?: string })
        ?.thoughtSignature,
    ).toBeUndefined();

    // User functionResponse part - unchanged (this is not a model turn)
    expect(
      (newContents[4]?.parts?.[0] as Part & { thoughtSignature?: string })
        ?.thoughtSignature,
    ).toBeUndefined();

    // Inside active loop, second model turn
    // First function call already has a signature, so it's preserved
    expect(
      (newContents[5]?.parts?.[0] as Part & { thoughtSignature?: string })
        ?.thoughtSignature,
    ).toBe('existing-sig');
    // Second function call does NOT get a signature
    expect(
      (newContents[5]?.parts?.[1] as Part & { thoughtSignature?: string })
        ?.thoughtSignature,
    ).toBeUndefined();
  });

  it('should not modify contents if there is no user text message', () => {
    const history: Content[] = [
      {
        role: 'user',
        parts: [{ functionResponse: { name: 'tool', response: {} } }],
      },
      {
        role: 'model',
        parts: [{ functionCall: { name: 'tool2', args: {} } }],
      },
    ];
    const newContents = ensureActiveLoopHasThoughtSignatures(history);
    expect(newContents).toEqual(history);
    expect(
      (newContents[1]?.parts?.[0] as Part & { thoughtSignature?: string })
        ?.thoughtSignature,
    ).toBeUndefined();
  });

  it('should handle an empty history', () => {
    const history: Content[] = [];
    const newContents = ensureActiveLoopHasThoughtSignatures(history);
    expect(newContents).toEqual([]);
  });

  it('should handle history with only a user message', () => {
    const history: Content[] = [{ role: 'user', parts: [{ text: 'Hello' }] }];
    const newContents = ensureActiveLoopHasThoughtSignatures(history);
    expect(newContents).toEqual(history);
  });

  it('should preserve existing thoughtSignature if already present', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'Hello' }] },
      {
        role: 'model',
        parts: [
          {
            functionCall: { name: 'tool', args: {} },
            thoughtSignature: 'real-signature-from-api',
          } as Part,
        ],
      },
    ];
    const newContents = ensureActiveLoopHasThoughtSignatures(history);
    expect(
      (newContents[1]?.parts?.[0] as Part & { thoughtSignature?: string })
        ?.thoughtSignature,
    ).toBe('real-signature-from-api');
  });

  it('should handle model turns with text only (no functionCall)', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'Hello' }] },
      { role: 'model', parts: [{ text: 'Hi there!' }] },
      { role: 'user', parts: [{ text: 'Can you help?' }] },
      {
        role: 'model',
        parts: [{ functionCall: { name: 'help_tool', args: {} } }],
      },
    ];
    const newContents = ensureActiveLoopHasThoughtSignatures(history);

    // Text-only model turn - no changes
    expect(newContents[1]?.parts?.[0]).toEqual({ text: 'Hi there!' });

    // Function call in active loop gets signature
    expect(
      (newContents[3]?.parts?.[0] as Part & { thoughtSignature?: string })
        ?.thoughtSignature,
    ).toBe(SYNTHETIC_THOUGHT_SIGNATURE);
  });

  it('should handle mixed parts (text + functionCall) in same turn', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'Hello' }] },
      {
        role: 'model',
        parts: [
          { text: 'Let me check...' },
          { functionCall: { name: 'check_tool', args: {} } },
          { functionCall: { name: 'another_check', args: {} } },
        ],
      },
    ];
    const newContents = ensureActiveLoopHasThoughtSignatures(history);

    // Text part unchanged
    expect(newContents[1]?.parts?.[0]).toEqual({ text: 'Let me check...' });

    // First functionCall gets signature
    expect(
      (newContents[1]?.parts?.[1] as Part & { thoughtSignature?: string })
        ?.thoughtSignature,
    ).toBe(SYNTHETIC_THOUGHT_SIGNATURE);

    // Second functionCall does NOT get signature
    expect(
      (newContents[1]?.parts?.[2] as Part & { thoughtSignature?: string })
        ?.thoughtSignature,
    ).toBeUndefined();
  });

  it('should handle multi-step tool calls across multiple turns', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'Analyze the code' }] },
      {
        role: 'model',
        parts: [
          { functionCall: { name: 'read_file', args: { path: 'a.ts' } } },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'read_file',
              response: { content: 'file a' },
            },
          },
        ],
      },
      {
        role: 'model',
        parts: [
          { functionCall: { name: 'read_file', args: { path: 'b.ts' } } },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'read_file',
              response: { content: 'file b' },
            },
          },
        ],
      },
      {
        role: 'model',
        parts: [{ text: 'Analysis complete' }],
      },
    ];

    const newContents = ensureActiveLoopHasThoughtSignatures(history);

    // First tool call gets signature
    expect(
      (newContents[1]?.parts?.[0] as Part & { thoughtSignature?: string })
        ?.thoughtSignature,
    ).toBe(SYNTHETIC_THOUGHT_SIGNATURE);

    // Second tool call gets signature
    expect(
      (newContents[3]?.parts?.[0] as Part & { thoughtSignature?: string })
        ?.thoughtSignature,
    ).toBe(SYNTHETIC_THOUGHT_SIGNATURE);

    // Final text response - unchanged
    expect(newContents[5]?.parts?.[0]).toEqual({ text: 'Analysis complete' });
  });

  it('should return the same reference if no modifications needed', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'Hello' }] },
      { role: 'model', parts: [{ text: 'Hi!' }] },
    ];
    const newContents = ensureActiveLoopHasThoughtSignatures(history);
    // No function calls, so no modifications needed
    expect(newContents).toEqual(history);
  });
});

/**
 * Tests for stripThoughtsFromHistory function.
 *
 * Gemini returns thought content with `thought: true` on parts.
 * These should be stripped from history before sending back to the API.
 */
describe('stripThoughtsFromHistory', () => {
  interface Content {
    role: string;
    parts: Part[];
  }

  it('should strip thought parts from model turns with policy "all"', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'Hello' }] },
      {
        role: 'model',
        parts: [
          { text: 'Let me think...', thought: true } as Part,
          { text: 'Here is my answer.' },
        ],
      },
    ];

    const result = stripThoughtsFromHistory(history, 'all');

    expect(result).toHaveLength(2);
    expect(result[1].parts).toHaveLength(1);
    expect((result[1].parts[0] as { text: string }).text).toBe(
      'Here is my answer.',
    );
  });

  it('should remove thoughtSignature properties', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'Hello' }] },
      {
        role: 'model',
        parts: [
          {
            functionCall: { name: 'tool', args: {} },
            thoughtSignature: 'some-sig',
          } as Part,
        ],
      },
    ];

    const result = stripThoughtsFromHistory(history, 'all');

    expect(result).toHaveLength(2);
    const firstPart = result[1].parts[0] as Part & {
      thoughtSignature?: string;
    };
    expect(firstPart.thoughtSignature).toBeUndefined();
    expect((firstPart as { functionCall: unknown }).functionCall).toBeDefined();
  });

  it('should return unchanged contents with policy "none"', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'Hello' }] },
      {
        role: 'model',
        parts: [
          { text: 'Thinking...', thought: true } as Part,
          { text: 'Answer' },
        ],
      },
    ];

    const result = stripThoughtsFromHistory(history, 'none');

    expect(result).toBe(history); // Same reference
    expect(result[1].parts).toHaveLength(2);
  });

  it('should keep last model turn with policy "allButLast"', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'First question' }] },
      {
        role: 'model',
        parts: [
          { text: 'First thought', thought: true } as Part,
          { text: 'First answer' },
        ],
      },
      { role: 'user', parts: [{ text: 'Second question' }] },
      {
        role: 'model',
        parts: [
          { text: 'Second thought', thought: true } as Part,
          { text: 'Second answer' },
        ],
      },
    ];

    const result = stripThoughtsFromHistory(history, 'allButLast');

    // First model turn should have thought stripped
    expect(result[1].parts).toHaveLength(1);
    expect((result[1].parts[0] as { text: string }).text).toBe('First answer');

    // Last model turn should be preserved
    expect(result[3].parts).toHaveLength(2);
    expect(
      (result[3].parts[0] as { text: string; thought?: boolean }).thought,
    ).toBe(true);
  });

  it('should handle empty history', () => {
    const result = stripThoughtsFromHistory([], 'all');
    expect(result).toEqual([]);
  });

  it('should preserve user turns unchanged', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'Hello' }] },
      {
        role: 'model',
        parts: [{ text: 'Thought', thought: true } as Part],
      },
      { role: 'user', parts: [{ text: 'Another question' }] },
    ];

    const result = stripThoughtsFromHistory(history, 'all');

    // User turns preserved
    expect(result[0]).toBe(history[0]);
    expect(result[1]).toBe(history[2]); // Second user turn becomes index 1
    // Model turn with only thought parts is removed entirely
    expect(result).toHaveLength(2);
  });

  it('should remove model turns that become empty after stripping thoughts', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'Hello' }] },
      {
        role: 'model',
        parts: [{ text: 'Only thinking...', thought: true } as Part],
      },
      { role: 'user', parts: [{ text: 'Next question' }] },
      {
        role: 'model',
        parts: [{ text: 'Real answer' }],
      },
    ];

    const result = stripThoughtsFromHistory(history, 'all');

    // First model turn is removed entirely (only had thought)
    expect(result).toHaveLength(3);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('user');
    expect(result[2].role).toBe('model');
    expect((result[2].parts[0] as { text: string }).text).toBe('Real answer');
  });

  it('should return same reference if no modifications needed', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'Hello' }] },
      { role: 'model', parts: [{ text: 'Hi!' }] },
    ];

    const result = stripThoughtsFromHistory(history, 'all');

    expect(result).toEqual(history);
  });
});
