/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Flag the environment before React loads so act() is warning-free.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, vi, afterEach } from 'bun:test';
import { act } from 'react';
import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import { renderHook } from '../../test-utils/render.js';
import {
  usePromptCompletion,
  PROMPT_COMPLETION_DEBOUNCE_MS,
  type PromptCompletionRuntime,
} from './usePromptCompletion.js';
import type { TextBuffer } from '../components/shared/text-buffer.js';
import type { ModelOutput } from '@vybestack/llxprt-code-core';

function makeBuffer(text: string): TextBuffer {
  const buffer = {
    text,
    lines: [text],
    cursor: [0, text.length] as [number, number],
    preferredCol: text.length,
    setText: (next: string) => {
      buffer.text = next;
      buffer.lines = [next];
      buffer.cursor = [0, next.length];
      buffer.preferredCol = next.length;
    },
  };
  return buffer as unknown as TextBuffer;
}

function makeModelOutput(text: string): ModelOutput {
  return {
    content: { speaker: 'ai', blocks: [{ type: 'text', text }] },
  } as unknown as ModelOutput;
}

function makeRuntime(utilityModel: string | undefined): {
  runtime: PromptCompletionRuntime;
  generateContent: ReturnType<typeof vi.fn>;
} {
  const generateContent = vi.fn();
  const runtime = {
    getEnablePromptCompletion: () => true,
    getUtilityModel: () => utilityModel,
    getAgentClient: () => ({ generateContent }),
  } as unknown as PromptCompletionRuntime;
  return { runtime, generateContent };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('usePromptCompletion utilityModel gating (issue #2627)', () => {
  it('constructs no request when no utilityModel is configured', async () => {
    vi.useFakeTimers();
    const { runtime, generateContent } = makeRuntime(undefined);
    const buffer = makeBuffer('a sufficiently long prompt');

    const { result } = renderHook(() =>
      usePromptCompletion({ buffer, config: runtime, enabled: true }),
    );

    await act(async () => {
      await advanceTimersByTimeAsync(PROMPT_COMPLETION_DEBOUNCE_MS + 10);
    });

    expect(generateContent).not.toHaveBeenCalled();
    expect(result.current.text).toBe('');
    expect(result.current.isActive).toBe(false);
  });

  it('constructs no request when utilityModel is an empty or blank string', async () => {
    vi.useFakeTimers();
    for (const blank of ['', '   ']) {
      const { runtime, generateContent } = makeRuntime(blank);
      const buffer = makeBuffer('a sufficiently long prompt');

      const { result } = renderHook(() =>
        usePromptCompletion({ buffer, config: runtime, enabled: true }),
      );

      await act(async () => {
        await advanceTimersByTimeAsync(PROMPT_COMPLETION_DEBOUNCE_MS + 10);
      });

      expect(generateContent).not.toHaveBeenCalled();
      expect(result.current.isActive).toBe(false);
    }
  });

  it('requests completion with the configured utilityModel', async () => {
    vi.useFakeTimers();
    const generateContent = vi
      .fn()
      .mockResolvedValue(
        makeModelOutput('a sufficiently long prompt continuation'),
      );
    const config = {
      getEnablePromptCompletion: () => true,
      getUtilityModel: () => 'utility-model-x',
      getAgentClient: () => ({ generateContent }),
    } as unknown as PromptCompletionRuntime;
    const buffer = makeBuffer('a sufficiently long prompt');

    const { result } = renderHook(() =>
      usePromptCompletion({ buffer, config, enabled: true }),
    );

    expect(result.current.isActive).toBe(true);

    await act(async () => {
      await advanceTimersByTimeAsync(PROMPT_COMPLETION_DEBOUNCE_MS + 10);
    });

    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent.mock.calls[0]?.[3]).toBe('utility-model-x');
    expect(result.current.text).toBe('a sufficiently long prompt continuation');
  });
});
