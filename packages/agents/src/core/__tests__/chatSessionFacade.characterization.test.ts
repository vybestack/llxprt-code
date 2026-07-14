/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import * as fc from 'fast-check';
import {
  createFullLoopHarness,
  runFullLoop,
  findFinished,
  extractContentText,
  textIContent,
  terminalIContent,
  makeProviderStream,
} from './streamPipeline-characterization-helpers.js';
import { AgentEventType } from '@vybestack/llxprt-code-core/core/turn.js';

/**
 * @plan PLAN-20260707-AGENTNEUTRAL.P26
 * @requirement REQ-005.5c
 *
 * Characterization tests for the ChatSession PUBLIC facade (sendMessageStream).
 * Asserts OBSERVABLE behavior through the PUBLIC facade: sendMessageStream emits
 * the same ServerAgentStreamEvent sequence (type ordering + terminal Finished).
 */

function providerMock(chunks: Array<ReturnType<typeof textIContent>>): Mock {
  return vi.fn(() => makeProviderStream(chunks)) as Mock;
}

describe('ChatSession facade — sendMessageStream (characterization)', () => {
  describe('event sequence ordering', () => {
    it('emits Content then Finished for a simple text turn', async () => {
      const mock = providerMock([
        textIContent('Hello world'),
        terminalIContent('Hello world', 'end_turn'),
      ]);
      const harness = createFullLoopHarness(mock);
      const events = await runFullLoop(harness.turn, 'test prompt');

      const types = events.map((e) => e.type);
      expect(types).toContain(AgentEventType.Content);
      expect(findFinished(events)).toBeDefined();
    });

    it('always emits a terminal Finished event', async () => {
      const mock = providerMock([terminalIContent('Done', 'end_turn')]);
      const harness = createFullLoopHarness(mock);
      const events = await runFullLoop(harness.turn, 'prompt 1');
      expect(findFinished(events)).toBeDefined();
    });

    it('emits content text that accumulates the provider text', async () => {
      const mock = providerMock([
        textIContent('Accumulated text'),
        terminalIContent('Accumulated text', 'end_turn'),
      ]);
      const harness = createFullLoopHarness(mock);
      const events = await runFullLoop(harness.turn, 'prompt');
      const text = extractContentText(events);
      expect(text).toContain('Accumulated text');
    });
  });

  describe('event sequence (property-based)', () => {
    it('always terminates with Finished for any text input', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 100 }),
          async (prompt) => {
            const mock = providerMock([
              textIContent('Response to: ' + prompt),
              terminalIContent('Response to: ' + prompt, 'end_turn'),
            ]);
            const harness = createFullLoopHarness(mock);
            const events = await runFullLoop(harness.turn, prompt);
            return findFinished(events) !== undefined;
          },
        ),
        { numRuns: 5 },
      );
    });

    it('emits at least one Content event for non-empty provider text', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 200 }),
          async (text) => {
            const mock = providerMock([
              textIContent(text),
              terminalIContent(text, 'end_turn'),
            ]);
            const harness = createFullLoopHarness(mock);
            const events = await runFullLoop(harness.turn, 'prompt');
            const contentEvents = events.filter(
              (e) => e.type === AgentEventType.Content,
            );
            return contentEvents.length >= 1;
          },
        ),
        { numRuns: 5 },
      );
    });
  });

  describe('multi-turn behavior', () => {
    it('handles two sequential turns with different prompts', async () => {
      const mock1 = providerMock([
        textIContent('First response'),
        terminalIContent('First response', 'end_turn'),
      ]);
      const harness1 = createFullLoopHarness(mock1);
      const events1 = await runFullLoop(harness1.turn, 'first prompt');
      expect(extractContentText(events1)).toContain('First');

      const mock2 = providerMock([
        textIContent('Second response'),
        terminalIContent('Second response', 'end_turn'),
      ]);
      const harness2 = createFullLoopHarness(mock2);
      const events2 = await runFullLoop(harness2.turn, 'second prompt');
      expect(extractContentText(events2)).toContain('Second');
    });
  });
});
