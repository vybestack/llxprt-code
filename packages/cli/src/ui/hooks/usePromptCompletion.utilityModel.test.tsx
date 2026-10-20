/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'bun:test';
import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import { useCliGenerationEnvironment } from '../../__tests__/utility-generation-fixture.js';
import { act } from 'react';
import { renderHook } from '../../__tests__/render.js';
import {
  usePromptCompletion,
  PROMPT_COMPLETION_DEBOUNCE_MS,
  type PromptTextGenerator,
} from './usePromptCompletion.js';
import type { TextBuffer } from '../components/shared/text-buffer.js';
import {
  withGenerationOwner,
  generationGate,
} from '../../../../agents/src/api/__tests__/helpers/generation-owner-fixture.js';
import { withOwners } from '../../../../agents/src/api/__tests__/turn-revision-capture.fixture.js';
import { useRecordingPrompts } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';

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

async function realDebounce(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) =>
      setTimeout(resolve, PROMPT_COMPLETION_DEBOUNCE_MS + 10),
    );
  });
}

async function debounce(): Promise<void> {
  await act(async () => {
    await advanceTimersByTimeAsync(PROMPT_COMPLETION_DEBOUNCE_MS + 10);
  });
}

describe('usePromptCompletion utilityModel gating (issue #2627)', () => {
  useRecordingPrompts();
  useCliGenerationEnvironment();
  afterEach(() => vi.useRealTimers());

  it('constructs no request when no utilityModel is configured', async () => {
    await withOwners(async (agent, _peer, transport) => {
      const generate = agent.generate.bind(agent);
      vi.useFakeTimers();
      const { result, unmount } = renderHook(() =>
        usePromptCompletion({
          buffer: makeBuffer('a sufficiently long prompt'),
          config: {
            getEnablePromptCompletion: () => true,
            getUtilityModel: () => undefined,
          },
          generateContent: generate,
          enabled: true,
        }),
      );
      await debounce();
      expect(transport.requests()).toHaveLength(0);
      expect(result.current.text).toBe('');
      expect(result.current.isActive).toBe(false);
      unmount();
    });
  });

  it('constructs no request when utilityModel is an empty or blank string', async () => {
    await withOwners(async (agent, _peer, transport) => {
      const generate = agent.generate.bind(agent);
      vi.useFakeTimers();
      for (const blank of ['', '   ']) {
        const { result, unmount } = renderHook(() =>
          usePromptCompletion({
            buffer: makeBuffer('a sufficiently long prompt'),
            config: {
              getEnablePromptCompletion: () => true,
              getUtilityModel: () => blank,
            },
            generateContent: generate,
            enabled: true,
          }),
        );
        await debounce();
        expect(transport.requests()).toHaveLength(0);
        expect(result.current.isActive).toBe(false);
        unmount();
      }
    });
  });

  it('requests completion with the configured utilityModel', async () => {
    await withOwners(
      async (agent, _peer, transport) => {
        let completion: Promise<string> | undefined;
        const generate: PromptTextGenerator = (...args) => {
          completion = agent.generate(...args);
          return completion;
        };
        agent.setEphemeralSetting('reasoning.enabled', true);
        agent.setEphemeralSetting('reasoning.budgetTokens', 4096);
        agent.setEphemeralSetting('reasoning.enabledWireFormat', 'thinking');
        transport.release();
        const buffer = makeBuffer('a sufficiently long prompt');
        const config = {
          getEnablePromptCompletion: () => true,
          getUtilityModel: () => 'utility-model-x',
        };
        vi.useFakeTimers();
        const { result, unmount } = renderHook(() =>
          usePromptCompletion({
            buffer,
            config,
            generateContent: generate,
            enabled: true,
          }),
        );
        expect(result.current.isActive).toBe(true);
        await debounce();
        await act(async () => {
          if (completion === undefined)
            throw new Error(
              'Debounce did not admit the actual completion request',
            );
          await completion;
        });
        expect(result.current.text).toBe(
          'a sufficiently long prompt continuation',
        );
        expect(transport.requests()).toHaveLength(1);
        expect(transport.requests()[0]).toMatchObject({
          model: 'utility-model-x',
          temperature: 0.3,
          max_tokens: 16000,
          thinking: { type: 'disabled' },
        });
        expect(JSON.stringify(transport.requests()[0].messages)).toContain(
          JSON.stringify(
            `You are a professional prompt engineering assistant. Complete the user's partial prompt with expert precision and clarity. User's input: "a sufficiently long prompt" Continue this prompt by adding specific, actionable details that align with the user's intent. Focus on: clear, precise language; structured requirements; professional terminology; measurable outcomes. Length Guidelines: Keep suggestions concise (ideally 10-20 characters); prioritize brevity while maintaining clarity; use essential keywords only; avoid redundant phrases. Start your response with the exact user text ("a sufficiently long prompt") followed by your completion. Provide practical, implementation-focused suggestions rather than creative interpretations. Format: Plain text only. Single completion. Match the user's language. Emphasize conciseness over elaboration.`,
          ).slice(1, -1),
        );
        expect(await agent.getHistory()).toStrictEqual([]);
        expect(agent.getModel()).toBe('capture-a');
        unmount();
      },
      false,
      false,
      0,
      0,
      false,
      413,
      '  a sufficiently long prompt continuation  ',
    );
  });

  it('aborts superseded and unmounted requests at the provider boundary', async () => {
    const cleanup = await withGenerationOwner(
      async (owner, clients, provider) => {
        const first = generationGate();
        const second = generationGate();
        const signals: AbortSignal[] = [];
        provider.generating = async (request) => {
          const signal = request.invocation?.signal;
          if (signal === undefined)
            throw new Error('Missing provider cancellation');
          signals.push(signal);
          (signals.length === 1 ? first : second).release();
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          });
        };
        const buffer = makeBuffer('a sufficiently long prompt');
        const config = {
          getEnablePromptCompletion: () => true,
          getUtilityModel: () => 'utility-model-x',
        };
        const generate: PromptTextGenerator = (input, options) =>
          owner.generate(input, options);
        const { result, rerender, unmount } = renderHook(() =>
          usePromptCompletion({
            buffer,
            config,
            generateContent: generate,
            enabled: true,
          }),
        );
        await realDebounce();
        await first.promise;
        buffer.setText('a different sufficiently long prompt');
        rerender();
        await realDebounce();
        await second.promise;
        expect(signals[0].aborted).toBe(true);
        expect(signals[1].aborted).toBe(false);
        unmount();
        expect(signals[1].aborted).toBe(true);
        expect(result.current.text).toBe('');
        expect(await clients[1].getHistory()).toStrictEqual([]);
        provider.generating = undefined;
        expect(await owner.generate('primary remains usable', undefined)).toBe(
          'turn one reply',
        );
      },
      'anthropic',
    );
    expect(cleanup).toStrictEqual([]);
  });
});
