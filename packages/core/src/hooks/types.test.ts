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
  defaultHookTranslator,
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
        stopExecution: true,
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
        llm_response: llmResponse,
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
        stopExecution: true,
        reason: 'Test stop',
        llm_response: llmResponse,
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
});
