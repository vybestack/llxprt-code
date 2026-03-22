/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Config } from '../config/config.js';
import {
  triggerBeforeModelHook,
  triggerAfterModelHook,
} from './geminiChatHookTriggers.js';
import { HookSystem } from '../hooks/HookSystem.js';
import type { IContent } from '@vybestack/llxprt-code-providers';

describe('geminiChatHookTriggers', () => {
  let mockConfig: Config;
  let mockHookSystem: HookSystem;
  let mockEventHandler: {
    fireBeforeModelEvent: ReturnType<typeof vi.fn>;
    fireAfterModelEvent: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockEventHandler = {
      fireBeforeModelEvent: vi.fn(),
      fireAfterModelEvent: vi.fn(),
    };
    mockHookSystem = {
      initialize: vi.fn(async () => {}),
      getEventHandler: vi.fn(() => mockEventHandler),
      fireBeforeModelEvent: vi.fn(),
      fireAfterModelEvent: vi.fn(),
    } as unknown as HookSystem;
    mockConfig = {
      getHookSystem: vi.fn(() => mockHookSystem),
      getEnableHooks: vi.fn(() => true),
      getModel: vi.fn(() => 'test-model'),
    } as unknown as Config;
  });

  describe('triggerBeforeModelHook', () => {
    it('should return undefined when hook system is not available', async () => {
      const configWithoutHooks = {
        getHookSystem: vi.fn(() => undefined),
      } as unknown as Config;

      const result = await triggerBeforeModelHook(configWithoutHooks, {
        contents: [],
      });

      expect(result).toBeUndefined();
    });

    it('should return undefined when hook execution fails', async () => {
      mockHookSystem.fireBeforeModelEvent = vi.fn(() => {
        throw new Error('Hook execution failed');
      });

      const result = await triggerBeforeModelHook(mockConfig, {
        contents: [],
      });

      expect(result).toBeUndefined();
    });

    it('should preserve stop semantics from hook output', async () => {
      const hookOutput = {
        stopExecution: true,
        reason: 'Test stop reason',
      };

      mockHookSystem.fireBeforeModelEvent = vi.fn(async () => ({
        finalOutput: hookOutput,
      }));

      const result = await triggerBeforeModelHook(mockConfig, {
        contents: [],
      });

      expect(result).toBeDefined();
      expect(result?.shouldStopExecution()).toBe(true);
      expect(result?.getEffectiveReason()).toBe('Test stop reason');
    });

    it('should preserve block semantics from hook output', async () => {
      const hookOutput = {
        blockDecision: true,
        reason: 'Test block reason',
        synthetic_response: {
          candidates: [
            {
              content: {
                role: 'model' as const,
                parts: [{ text: 'Blocked response' }],
              },
            },
          ],
        },
      };

      mockHookSystem.fireBeforeModelEvent = vi.fn(async () => ({
        finalOutput: hookOutput,
      }));

      const result = await triggerBeforeModelHook(mockConfig, {
        contents: [],
      });

      expect(result).toBeDefined();
      expect(result?.isBlockingDecision()).toBe(true);
      expect(result?.getEffectiveReason()).toBe('Test block reason');
      expect(result?.getSyntheticResponse()).toBeDefined();
    });

    it('should handle no-op hook (no special actions)', async () => {
      const hookOutput = {};

      mockHookSystem.fireBeforeModelEvent = vi.fn(async () => ({
        finalOutput: hookOutput,
      }));

      const result = await triggerBeforeModelHook(mockConfig, {
        contents: [],
      });

      expect(result).toBeDefined();
      expect(result?.shouldStopExecution()).toBe(false);
      expect(result?.isBlockingDecision()).toBe(false);
    });
  });

  describe('triggerAfterModelHook', () => {
    it('should return undefined when hook system is not available', async () => {
      const configWithoutHooks = {
        getHookSystem: vi.fn(() => undefined),
      } as unknown as Config;

      const mockIContent: IContent = {
        role: 'model',
        blocks: [{ type: 'text', text: 'Test response' }],
      };

      const result = await triggerAfterModelHook(
        configWithoutHooks,
        mockIContent,
      );

      expect(result).toBeUndefined();
    });

    it('should return undefined when hook execution fails', async () => {
      mockHookSystem.fireAfterModelEvent = vi.fn(() => {
        throw new Error('Hook execution failed');
      });

      const mockIContent: IContent = {
        role: 'model',
        blocks: [{ type: 'text', text: 'Test response' }],
      };

      const result = await triggerAfterModelHook(mockConfig, mockIContent);

      expect(result).toBeUndefined();
    });

    it('should preserve stop semantics from hook output', async () => {
      const hookOutput = {
        stopExecution: true,
        reason: 'Test stop after model',
      };

      mockHookSystem.fireAfterModelEvent = vi.fn(async () => ({
        finalOutput: hookOutput,
      }));

      const mockIContent: IContent = {
        role: 'model',
        blocks: [{ type: 'text', text: 'Test response' }],
      };

      const result = await triggerAfterModelHook(mockConfig, mockIContent);

      expect(result).toBeDefined();
      expect(result?.shouldStopExecution()).toBe(true);
      expect(result?.getEffectiveReason()).toBe('Test stop after model');
    });

    it('should preserve block semantics from hook output', async () => {
      const hookOutput = {
        blockDecision: true,
        reason: 'Test block after model',
      };

      mockHookSystem.fireAfterModelEvent = vi.fn(async () => ({
        finalOutput: hookOutput,
      }));

      const mockIContent: IContent = {
        role: 'model',
        blocks: [{ type: 'text', text: 'Test response' }],
      };

      const result = await triggerAfterModelHook(mockConfig, mockIContent);

      expect(result).toBeDefined();
      expect(result?.isBlockingDecision()).toBe(true);
      expect(result?.getEffectiveReason()).toBe('Test block after model');
    });

    it('should preserve modified response from hook output', async () => {
      const hookOutput = {
        llm_response: {
          candidates: [
            {
              content: {
                role: 'model' as const,
                parts: ['Modified response'],
              },
            },
          ],
        },
      };

      mockHookSystem.fireAfterModelEvent = vi.fn(async () => ({
        finalOutput: hookOutput,
      }));

      const mockIContent: IContent = {
        role: 'model',
        blocks: [{ type: 'text', text: 'Original response' }],
      };

      const result = await triggerAfterModelHook(mockConfig, mockIContent);

      expect(result).toBeDefined();
      const modifiedResponse = result?.getModifiedResponse();
      expect(modifiedResponse).toBeDefined();
      expect(
        modifiedResponse?.candidates?.[0]?.content?.parts?.[0],
      ).toHaveProperty('text', 'Modified response');
    });

    it('should handle no-op hook (no modifications)', async () => {
      const hookOutput = {};

      mockHookSystem.fireAfterModelEvent = vi.fn(async () => ({
        finalOutput: hookOutput,
      }));

      const mockIContent: IContent = {
        role: 'model',
        blocks: [{ type: 'text', text: 'Test response' }],
      };

      const result = await triggerAfterModelHook(mockConfig, mockIContent);

      expect(result).toBeDefined();
      expect(result?.shouldStopExecution()).toBe(false);
      expect(result?.isBlockingDecision()).toBe(false);
      expect(result?.getModifiedResponse()).toBeUndefined();
    });
  });
});
