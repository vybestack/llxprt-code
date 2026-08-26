/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'bun:test';
import { renderHook, waitFor } from '../../test-utils/render.js';
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

describe('usePromptCompletion utilityModel gating (issue #2627)', () => {
  it('constructs no request when no utilityModel is configured', async () => {
    const generateContent = vi.fn();
    const config = {
      getEnablePromptCompletion: () => true,
      getUtilityModel: () => undefined,
      getAgentClient: () => ({ generateContent }),
    } as unknown as PromptCompletionRuntime;
    const buffer = makeBuffer('a sufficiently long prompt');

    const { result } = renderHook(() =>
      usePromptCompletion({ buffer, config, enabled: true }),
    );

    await new Promise((resolve) =>
      setTimeout(resolve, PROMPT_COMPLETION_DEBOUNCE_MS + 150),
    );

    expect(generateContent).not.toHaveBeenCalled();
    expect(result.current.text).toBe('');
    expect(result.current.isActive).toBe(false);
  });

  it('requests completion with the configured utilityModel', async () => {
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

    await waitFor(() => {
      expect(result.current.text).toBe(
        'a sufficiently long prompt continuation',
      );
    });

    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent.mock.calls[0]?.[3]).toBe('utility-model-x');
  });
});
