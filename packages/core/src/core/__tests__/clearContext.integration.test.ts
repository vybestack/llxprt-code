/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { AfterAgentHookOutput, DefaultHookOutput } from '../../hooks/types.js';
import { GeminiEventType } from '../turn.js';
import type { ServerGeminiStreamEvent } from '../turn.js';

/**
 * These tests validate the clearContext behavior at the unit level
 * for each layer of the runtime stack.
 *
 * The MessageStreamOrchestrator integration is tested indirectly through
 * the AgentHookManager + AfterAgentHookOutput.shouldClearContext() contract.
 */
describe('clearContext end-to-end contract', () => {
  describe('AfterAgentHookOutput.shouldClearContext() contract', () => {
    it('returns true when clearContext is true in hookSpecificOutput', () => {
      const output = new AfterAgentHookOutput({
        hookSpecificOutput: { clearContext: true },
      });
      expect(output.shouldClearContext()).toBe(true);
    });

    it('returns false when clearContext is not set', () => {
      const output = new AfterAgentHookOutput({});
      expect(output.shouldClearContext()).toBe(false);
    });

    it('returns false for DefaultHookOutput (other hook types)', () => {
      const output = new DefaultHookOutput({
        hookSpecificOutput: { clearContext: true },
      });
      expect(output.shouldClearContext()).toBe(false);
    });
  });

  describe('AgentExecutionStopped event structure with contextCleared', () => {
    it('has contextCleared field in type definition', () => {
      const event: ServerGeminiStreamEvent = {
        type: GeminiEventType.AgentExecutionStopped,
        reason: 'test',
        contextCleared: true,
      };
      expect(event.type).toBe(GeminiEventType.AgentExecutionStopped);
      expect((event as { contextCleared: boolean }).contextCleared).toBe(true);
    });

    it('has contextCleared field on AgentExecutionBlocked events', () => {
      const event: ServerGeminiStreamEvent = {
        type: GeminiEventType.AgentExecutionBlocked,
        reason: 'test',
        contextCleared: true,
      };
      expect(event.type).toBe(GeminiEventType.AgentExecutionBlocked);
      expect((event as { contextCleared: boolean }).contextCleared).toBe(true);
    });
  });

  describe('clearContext + blocking decision combination', () => {
    it('preserves both clearContext and blocking decision', () => {
      const output = new AfterAgentHookOutput({
        decision: 'block',
        reason: 'Clear and block',
        hookSpecificOutput: { clearContext: true },
      });
      expect(output.isBlockingDecision()).toBe(true);
      expect(output.shouldClearContext()).toBe(true);
      expect(output.getEffectiveReason()).toBe('Clear and block');
    });

    it('clearContext works alongside shouldStopExecution', () => {
      const output = new AfterAgentHookOutput({
        continue: false,
        stopReason: 'Stop and clear',
        hookSpecificOutput: { clearContext: true },
      });
      expect(output.shouldStopExecution()).toBe(true);
      expect(output.shouldClearContext()).toBe(true);
    });

    it('clearContext can be true without blocking', () => {
      const output = new AfterAgentHookOutput({
        hookSpecificOutput: {
          clearContext: true,
          additionalContext: 'context',
        },
      });
      expect(output.isBlockingDecision()).toBe(false);
      expect(output.shouldStopExecution()).toBe(false);
      expect(output.shouldClearContext()).toBe(true);
    });
  });

  describe('event ordering contract', () => {
    it('AgentExecutionStopped with contextCleared signals terminal event', () => {
      // When the orchestrator emits AgentExecutionStopped with contextCleared,
      // the UI should display the clear context notification. The event
      // should arrive after any content events in the same stream.
      const events: ServerGeminiStreamEvent[] = [
        { type: GeminiEventType.Content, value: 'response text' },
        { type: GeminiEventType.Finished, value: { reason: 'STOP' as const } },
        {
          type: GeminiEventType.AgentExecutionStopped,
          reason: 'Context cleared by AfterAgent hook',
          contextCleared: true,
        },
      ];

      const clearEvent = events.find(
        (e) =>
          e.type === GeminiEventType.AgentExecutionStopped &&
          'contextCleared' in e &&
          (e as { contextCleared?: boolean }).contextCleared === true,
      );

      // Content should come before clearContext event
      const contentIndex = events.findIndex(
        (e) => e.type === GeminiEventType.Content,
      );
      const clearIndex = events.indexOf(clearEvent!);
      expect(contentIndex).toBeLessThan(clearIndex);
      expect(clearEvent).toBeDefined();
    });

    it('contextCleared is not present on normal Finished events', () => {
      const event: ServerGeminiStreamEvent = {
        type: GeminiEventType.Finished,
        value: { reason: 'STOP' as const },
      };
      expect('contextCleared' in event).toBe(false);
    });
  });
});
