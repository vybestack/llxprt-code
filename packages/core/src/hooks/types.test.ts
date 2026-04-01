/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  HookEventName,
  HookType,
  AfterModelHookOutput,
  AfterAgentHookOutput,
  DefaultHookOutput,
  BeforeAgentHookOutput,
} from './types.js';
import type { LLMResponse } from './types.js';

describe('Hook Types', () => {
  describe('HookEventName', () => {
    it('should contain all required event names', () => {
      const expectedEvents = [
        'BeforeTool',
        'AfterTool',
        'BeforeAgent',
        'Notification',
        'AfterAgent',
        'SessionStart',
        'SessionEnd',
        'PreCompress',
        'BeforeModel',
        'AfterModel',
        'BeforeToolSelection',
      ];

      for (const event of expectedEvents) {
        expect(Object.values(HookEventName)).toContain(event);
      }
    });
  });

  describe('HookType', () => {
    it('should contain command type', () => {
      expect(HookType.Command).toBe('command');
    });
  });

  describe('AfterModelHookOutput.getModifiedResponse', () => {
    it('should return undefined when stop is requested and no llm_response', () => {
      const hookOutput = new AfterModelHookOutput({
        continue: false,
        reason: 'Test stop',
      });

      const modifiedResponse = hookOutput.getModifiedResponse();

      expect(modifiedResponse).toBeUndefined();
    });

    it('should return translated modified response when llm_response exists', () => {
      const llmResponse: LLMResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: ['Modified response text'],
            },
            finishReason: 'STOP',
          },
        ],
      };

      const hookOutput = new AfterModelHookOutput({
        hookSpecificOutput: {
          llm_response: llmResponse,
        },
      });

      const modifiedResponse = hookOutput.getModifiedResponse();

      expect(modifiedResponse).toBeDefined();
      expect(modifiedResponse?.candidates?.[0]?.content?.parts).toBeDefined();
    });

    it('should return modified response even when stop is requested if llm_response exists', () => {
      const llmResponse: LLMResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: ['Modified response text'],
            },
            finishReason: 'STOP',
          },
        ],
      };

      const hookOutput = new AfterModelHookOutput({
        continue: false,
        reason: 'Test stop',
        hookSpecificOutput: {
          llm_response: llmResponse,
        },
      });

      const modifiedResponse = hookOutput.getModifiedResponse();

      expect(modifiedResponse).toBeDefined();
    });

    it('should return undefined when no llm_response and no stop', () => {
      const hookOutput = new AfterModelHookOutput({});

      const modifiedResponse = hookOutput.getModifiedResponse();

      expect(modifiedResponse).toBeUndefined();
    });
  });

  describe('DefaultHookOutput.shouldClearContext', () => {
    it('should return false by default', () => {
      const hookOutput = new DefaultHookOutput({});
      expect(hookOutput.shouldClearContext()).toBe(false);
    });

    it('should return false when hookSpecificOutput is undefined', () => {
      const hookOutput = new DefaultHookOutput({});
      expect(hookOutput.shouldClearContext()).toBe(false);
    });

    it('should return false when hookSpecificOutput has no clearContext', () => {
      const hookOutput = new DefaultHookOutput({
        hookSpecificOutput: { additionalContext: 'test' },
      });
      expect(hookOutput.shouldClearContext()).toBe(false);
    });

    it('should return false when clearContext is explicitly false', () => {
      const hookOutput = new DefaultHookOutput({
        hookSpecificOutput: { clearContext: false },
      });
      expect(hookOutput.shouldClearContext()).toBe(false);
    });
  });

  describe('AfterAgentHookOutput.shouldClearContext', () => {
    it('should return true when clearContext is true in hookSpecificOutput', () => {
      const hookOutput = new AfterAgentHookOutput({
        hookSpecificOutput: { clearContext: true },
      });
      expect(hookOutput.shouldClearContext()).toBe(true);
    });

    it('should return true when clearContext is true alongside other fields', () => {
      const hookOutput = new AfterAgentHookOutput({
        hookSpecificOutput: {
          hookEventName: 'AfterAgent',
          additionalContext: 'some context',
          clearContext: true,
        },
      });
      expect(hookOutput.shouldClearContext()).toBe(true);
    });

    it('should return false when clearContext is not present', () => {
      const hookOutput = new AfterAgentHookOutput({
        hookSpecificOutput: { additionalContext: 'some context' },
      });
      expect(hookOutput.shouldClearContext()).toBe(false);
    });

    it('should return false when clearContext is false', () => {
      const hookOutput = new AfterAgentHookOutput({
        hookSpecificOutput: { clearContext: false },
      });
      expect(hookOutput.shouldClearContext()).toBe(false);
    });

    it('should return false when hookSpecificOutput is undefined', () => {
      const hookOutput = new AfterAgentHookOutput({});
      expect(hookOutput.shouldClearContext()).toBe(false);
    });

    it('should return false when hookSpecificOutput is empty', () => {
      const hookOutput = new AfterAgentHookOutput({
        hookSpecificOutput: {},
      });
      expect(hookOutput.shouldClearContext()).toBe(false);
    });
  });

  describe('BeforeAgentHookOutput.shouldClearContext', () => {
    it('should return false (BeforeAgent does not support clearContext)', () => {
      const hookOutput = new BeforeAgentHookOutput({
        hookSpecificOutput: { clearContext: true },
      });
      expect(hookOutput.shouldClearContext()).toBe(false);
    });
  });
});
