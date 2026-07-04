/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import {
  AgentEventType,
  type ServerAgentStreamEvent,
} from '@vybestack/llxprt-code-core';
import {
  applyReplacement,
  handleStreamError,
  type TaskStreamContext,
} from './task-support.js';
import { CoderAgentEvent } from '../types.js';
import type { StateChange } from '../types.js';

describe('applyReplacement', () => {
  describe('isNewFile behavior', () => {
    it('should return newString if isNewFile is true', () => {
      expect(applyReplacement(null, 'old', 'new', true)).toBe('new');
      expect(applyReplacement('existing', 'old', 'new', true)).toBe('new');
    });
  });

  describe('null currentContent handling', () => {
    it('should return newString if currentContent is null and oldString is empty (defensive)', () => {
      expect(applyReplacement(null, '', 'new', false)).toBe('new');
    });

    it('should return empty string if currentContent is null and oldString is not empty (defensive)', () => {
      expect(applyReplacement(null, 'old', 'new', false)).toBe('');
    });
  });

  describe('empty oldString handling', () => {
    it('should return currentContent if oldString is empty and not a new file', () => {
      expect(applyReplacement('hello world', '', 'new', false)).toBe(
        'hello world',
      );
    });
  });

  describe('single replacement (default)', () => {
    it('should replace only the first occurrence with default expectedReplacements=1', () => {
      expect(applyReplacement('hello old world old', 'old', 'new', false)).toBe(
        'hello new world old',
      );
    });

    it('should handle text with special characters', () => {
      expect(
        applyReplacement(
          'path/to/file path/to/other',
          'path/to',
          'new/path',
          false,
        ),
      ).toBe('new/path/file path/to/other');
    });
  });

  describe('multiple replacements', () => {
    it('should replace all occurrences when expectedReplacements > 1', () => {
      expect(
        applyReplacement('hello old world old', 'old', 'new', false, 2),
      ).toBe('hello new world new');
    });

    it('should replace all occurrences with replaceAll when expectedReplacements is large', () => {
      expect(applyReplacement('a b a b a', 'a', 'X', false, 10)).toBe(
        'X b X b X',
      );
    });
  });

  describe('edge cases', () => {
    it('should handle replacement when oldString not found', () => {
      expect(applyReplacement('hello world', 'notfound', 'new', false)).toBe(
        'hello world',
      );
    });

    it('should handle replacement with identical old and new strings', () => {
      expect(applyReplacement('hello world', 'hello', 'hello', false)).toBe(
        'hello world',
      );
    });

    it('should handle empty newString (deletion)', () => {
      expect(applyReplacement('hello world', ' world', '', false)).toBe(
        'hello',
      );
    });

    it('should handle oldString containing special regex characters literally', () => {
      // Test that $ is treated literally, not as a regex special character
      expect(applyReplacement('price: $100 price: $200', '$', '€', false)).toBe(
        'price: €100 price: $200',
      );

      expect(
        applyReplacement('price: $100 price: $200', '$', '€', false, 2),
      ).toBe('price: €100 price: €200');
    });
  });
});

describe('handleStreamError', () => {
  it('formats Anthropic rate-limit errors without Gemini fallback guidance', () => {
    const publishedUpdates: Array<{ error?: string }> = [];
    const context: TaskStreamContext = {
      taskState: 'working',
      providerName: 'anthropic',
      currentModel: 'claude-opus-4-6',
      cancelPendingTools: vi.fn(),
      setTaskStateAndPublishUpdate: vi.fn(
        (_state, _msg, _text, _parts, _final, error) => {
          publishedUpdates.push({ error });
        },
      ),
    };
    const stateChange: StateChange = {
      kind: CoderAgentEvent.StateChangeEvent,
    };
    const event: ServerAgentStreamEvent & {
      type: typeof AgentEventType.Error;
    } = {
      type: AgentEventType.Error,
      value: {
        error: {
          message: 'Rate limit exceeded',
          status: 429,
        },
      },
    };

    handleStreamError(event, context, stateChange);

    expect(publishedUpdates[0]?.error).toContain(
      'Anthropic rate limit exceeded',
    );
    expect(publishedUpdates[0]?.error).not.toContain('gemini');
    expect(publishedUpdates[0]?.error).not.toContain('gemini-2.5-flash');
    expect(publishedUpdates[0]?.error).not.toContain('AI Studio');
    expect(publishedUpdates[0]?.error).not.toContain('Gemini Code Assist');
    expect(publishedUpdates[0]?.error).not.toContain('Switching to the');
  });
});
