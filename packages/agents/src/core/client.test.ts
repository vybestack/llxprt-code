/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251027-STATELESS5.P09
 * Note: Legacy tests updated with plan markers. Runtime state integration tests
 * are in __tests__/agentClient.runtimeState.test.ts
 *
 * Pure-function tests for isThinkingSupported and findCompressSplitPoint.
 * AgentClient integration tests are split into sibling files:
 *   - client.methods.test.ts
 *   - client.sendMessageStream.test.ts
 *   - client.editor-context.test.ts
 *   - client.ide-context.test.ts
 *   - client.lifecycle.test.ts
 */

import { describe, it, expect } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { findCompressSplitPoint, isThinkingSupported } from './client.js';

describe('isThinkingSupported', () => {
  it('should return true for gemini-2.5', () => {
    expect(isThinkingSupported('gemini-2.5')).toBe(true);
    expect(isThinkingSupported('gemini-2.5-flash')).toBe(true);
  });

  it('should return false for gemini-2.0 models', () => {
    expect(isThinkingSupported('gemini-2.0-flash')).toBe(false);
    expect(isThinkingSupported('gemini-2.0-pro')).toBe(false);
  });

  it('should return true for other models', () => {
    expect(isThinkingSupported('some-other-model')).toBe(true);
  });
});

describe('findCompressSplitPoint', () => {
  it('should throw an error for non-positive numbers', () => {
    expect(() => findCompressSplitPoint([], 0)).toThrow(
      'Fraction must be between 0 and 1',
    );
  });

  it('should throw an error for a fraction greater than or equal to 1', () => {
    expect(() => findCompressSplitPoint([], 1)).toThrow(
      'Fraction must be between 0 and 1',
    );
  });

  it('should handle an empty history', () => {
    expect(findCompressSplitPoint([], 0.5)).toBe(0);
  });

  it('should handle a fraction in the middle', () => {
    const history: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'This is the first message.' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'This is the second message.' }],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'This is the third message.' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'This is the fourth message.' }],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'This is the fifth message.' }],
      },
    ];
    expect(findCompressSplitPoint(history, 0.5)).toBe(4);
  });

  it('should handle a fraction of last index', () => {
    const history: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'This is the first message.' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'This is the second message.' }],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'This is the third message.' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'This is the fourth message.' }],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'This is the fifth message.' }],
      },
    ];
    expect(findCompressSplitPoint(history, 0.9)).toBe(4);
  });

  it('should handle a fraction of after last index', () => {
    const history: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'This is the first message.' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'This is the second message.' }],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'This is the third message.' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'This is the fourth message.' }],
      },
    ];
    expect(findCompressSplitPoint(history, 0.8)).toBe(4);
  });

  it('should return earlier splitpoint if no valid ones are after threshhold', () => {
    const history: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'This is the first message.' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'This is the second message.' }],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'This is the third message.' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'tool_call', id: '', name: '', parameters: {} }],
      },
    ];
    expect(findCompressSplitPoint(history, 0.99)).toBe(2);
  });

  it('should handle a history with only one item', () => {
    const historyWithEmptyParts: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Message 1' }] },
    ];
    expect(findCompressSplitPoint(historyWithEmptyParts, 0.5)).toBe(0);
  });

  it('should handle history with weird parts', () => {
    const historyWithEmptyParts: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Message 1' }] },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'media',
            mimeType: 'application/octet-stream',
            data: 'derp',
            encoding: 'url',
          },
        ],
      },
      { speaker: 'human', blocks: [{ type: 'text', text: 'Message 2' }] },
    ];
    expect(findCompressSplitPoint(historyWithEmptyParts, 0.5)).toBe(2);
  });

  it('should fall back to tool call split when no user splits exist', () => {
    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          { type: 'tool_call', id: 'toolA', name: 'toolA', parameters: {} },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'toolA',
            toolName: 'toolA',
            result: { ok: true },
          },
        ],
      },
      {
        speaker: 'ai',
        blocks: [
          { type: 'tool_call', id: 'toolB', name: 'toolB', parameters: {} },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'toolB',
            toolName: 'toolB',
            result: { ok: true },
          },
        ],
      },
    ];

    expect(findCompressSplitPoint(history, 0.6)).toBe(2);
  });
});
