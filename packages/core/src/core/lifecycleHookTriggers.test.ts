/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P12,P13,P14,P20
 * @requirement:HOOK-033,HOOK-034,HOOK-035,HOOK-041,HOOK-042,HOOK-043,HOOK-044,HOOK-045
 * @pseudocode:analysis/pseudocode/04-model-hook-pipeline.md
 *
 * Tests for lifecycle hook trigger functions (SessionStart, SessionEnd, BeforeAgent, AfterAgent)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  triggerSessionStartHook,
  triggerSessionEndHook,
  triggerBeforeAgentHook,
  triggerAfterAgentHook,
  triggerPreCompressHook,
} from './lifecycleHookTriggers.js';
import type { Config } from '../config/config.js';
import type { HookSystem } from '../hooks/hookSystem.js';
import type { HookEventHandler } from '../hooks/hookEventHandler.js';
import type { AggregatedHookResult } from '../hooks/hookAggregator.js';
import {
  SessionStartSource,
  SessionEndReason,
  SessionStartHookOutput,
  SessionEndHookOutput,
  BeforeAgentHookOutput,
  AfterAgentHookOutput,
  PreCompressTrigger,
} from '../hooks/types.js';

describe('Lifecycle Hook Triggers', () => {
  let mockConfig: Config;
  let mockHookSystem: HookSystem;
  let mockEventHandler: HookEventHandler;

  beforeEach(() => {
    vi.resetAllMocks();

    // Create mock event handler (kept for type compatibility but not used)
    mockEventHandler = {
      fireSessionStartEvent: vi.fn(),
      fireSessionEndEvent: vi.fn(),
      fireBeforeAgentEvent: vi.fn(),
      fireAfterAgentEvent: vi.fn(),
      firePreCompressEvent: vi.fn(),
    } as unknown as HookEventHandler;

    // Create mock hook system with facade methods
    mockHookSystem = {
      initialize: vi.fn().mockResolvedValue(undefined),
      getEventHandler: vi.fn().mockReturnValue(mockEventHandler),
      fireSessionStartEvent: vi.fn(),
      fireSessionEndEvent: vi.fn(),
      fireBeforeAgentEvent: vi.fn(),
      fireAfterAgentEvent: vi.fn(),
      firePreCompressEvent: vi.fn(),
    } as unknown as HookSystem;

    // Create mock config
    mockConfig = {
      getEnableHooks: vi.fn().mockReturnValue(true),
      getHookSystem: vi.fn().mockReturnValue(mockHookSystem),
      getSessionId: vi.fn().mockReturnValue('test-session-123'),
      getTargetDir: vi.fn().mockReturnValue('/test/project'),
      getModel: vi.fn().mockReturnValue('test-model'),
    } as unknown as Config;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('triggerSessionStartHook', () => {
    it('should return SessionStartHookOutput when hook executes successfully', async () => {
      const mockResult: AggregatedHookResult = {
        success: true,
        finalOutput: {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: 'Welcome message',
          },
        },
        allOutputs: [],
        errors: [],
        totalDuration: 100,
      };
      vi.mocked(mockHookSystem.fireSessionStartEvent).mockResolvedValue(
        mockResult,
      );

      const result = await triggerSessionStartHook(
        mockConfig,
        SessionStartSource.Startup,
      );

      expect(result).toBeInstanceOf(SessionStartHookOutput);
      expect(mockHookSystem.initialize).toHaveBeenCalled();
      expect(mockHookSystem.fireSessionStartEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          source: SessionStartSource.Startup,
        }),
      );
    });

    it('should return undefined when hooks are disabled', async () => {
      vi.mocked(mockConfig.getEnableHooks).mockReturnValue(false);

      const result = await triggerSessionStartHook(
        mockConfig,
        SessionStartSource.Startup,
      );

      expect(result).toBeUndefined();
      expect(mockHookSystem.fireSessionStartEvent).not.toHaveBeenCalled();
    });

    it('should return undefined when hook system is not available', async () => {
      vi.mocked(mockConfig.getHookSystem).mockReturnValue(undefined);

      const result = await triggerSessionStartHook(
        mockConfig,
        SessionStartSource.Startup,
      );

      expect(result).toBeUndefined();
    });

    it('should return undefined and not throw on hook error', async () => {
      vi.mocked(mockHookSystem.fireSessionStartEvent).mockRejectedValue(
        new Error('Hook failed'),
      );

      const result = await triggerSessionStartHook(
        mockConfig,
        SessionStartSource.Startup,
      );

      expect(result).toBeUndefined();
    });
  });

  describe('triggerSessionEndHook', () => {
    it('should return SessionEndHookOutput when hook executes successfully', async () => {
      const mockResult: AggregatedHookResult = {
        success: true,
        finalOutput: {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'SessionEnd',
          },
        },
        allOutputs: [],
        errors: [],
        totalDuration: 100,
      };
      vi.mocked(mockHookSystem.fireSessionEndEvent).mockResolvedValue(
        mockResult,
      );

      const result = await triggerSessionEndHook(
        mockConfig,
        SessionEndReason.Exit,
      );

      expect(result).toBeInstanceOf(SessionEndHookOutput);
      expect(mockHookSystem.initialize).toHaveBeenCalled();
      expect(mockHookSystem.fireSessionEndEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: SessionEndReason.Exit,
        }),
      );
    });

    it('should return undefined when hooks are disabled', async () => {
      vi.mocked(mockConfig.getEnableHooks).mockReturnValue(false);

      const result = await triggerSessionEndHook(
        mockConfig,
        SessionEndReason.Exit,
      );

      expect(result).toBeUndefined();
      expect(mockHookSystem.fireSessionEndEvent).not.toHaveBeenCalled();
    });

    it('should return undefined when hook system is not available', async () => {
      vi.mocked(mockConfig.getHookSystem).mockReturnValue(undefined);

      const result = await triggerSessionEndHook(
        mockConfig,
        SessionEndReason.Exit,
      );

      expect(result).toBeUndefined();
    });

    it('should return undefined and not throw on hook error', async () => {
      vi.mocked(mockHookSystem.fireSessionEndEvent).mockRejectedValue(
        new Error('Hook failed'),
      );

      const result = await triggerSessionEndHook(
        mockConfig,
        SessionEndReason.Exit,
      );

      expect(result).toBeUndefined();
    });
  });

  describe('triggerBeforeAgentHook', () => {
    it('should return BeforeAgentHookOutput when hook executes successfully', async () => {
      const mockResult: AggregatedHookResult = {
        success: true,
        finalOutput: {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'BeforeAgent',
            additionalContext: 'Pre-turn context',
          },
        },
        allOutputs: [],
        errors: [],
        totalDuration: 100,
      };
      vi.mocked(mockHookSystem.fireBeforeAgentEvent).mockResolvedValue(
        mockResult,
      );

      const result = await triggerBeforeAgentHook(
        mockConfig,
        'User prompt text',
      );

      expect(result).toBeInstanceOf(BeforeAgentHookOutput);
      expect(mockHookSystem.initialize).toHaveBeenCalled();
      expect(mockHookSystem.fireBeforeAgentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'User prompt text',
        }),
      );
    });

    it('should return undefined when hooks are disabled', async () => {
      vi.mocked(mockConfig.getEnableHooks).mockReturnValue(false);

      const result = await triggerBeforeAgentHook(mockConfig, 'prompt');

      expect(result).toBeUndefined();
      expect(mockHookSystem.fireBeforeAgentEvent).not.toHaveBeenCalled();
    });

    it('should return undefined when hook system is not available', async () => {
      vi.mocked(mockConfig.getHookSystem).mockReturnValue(undefined);

      const result = await triggerBeforeAgentHook(mockConfig, 'prompt');

      expect(result).toBeUndefined();
    });

    it('should return undefined and not throw on hook error', async () => {
      vi.mocked(mockHookSystem.fireBeforeAgentEvent).mockRejectedValue(
        new Error('Hook failed'),
      );

      const result = await triggerBeforeAgentHook(mockConfig, 'prompt');

      expect(result).toBeUndefined();
    });
  });

  describe('triggerAfterAgentHook', () => {
    it('should return AfterAgentHookOutput when hook executes successfully', async () => {
      const mockResult: AggregatedHookResult = {
        success: true,
        finalOutput: {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'AfterAgent',
          },
        },
        allOutputs: [],
        errors: [],
        totalDuration: 100,
      };
      vi.mocked(mockHookSystem.fireAfterAgentEvent).mockResolvedValue(
        mockResult,
      );

      const result = await triggerAfterAgentHook(
        mockConfig,
        'User prompt',
        'Agent response',
        false,
      );

      expect(result).toBeInstanceOf(AfterAgentHookOutput);
      expect(mockHookSystem.initialize).toHaveBeenCalled();
      expect(mockHookSystem.fireAfterAgentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'User prompt',
          prompt_response: 'Agent response',
          stop_hook_active: false,
        }),
      );
    });

    it('should return undefined when hooks are disabled', async () => {
      vi.mocked(mockConfig.getEnableHooks).mockReturnValue(false);

      const result = await triggerAfterAgentHook(
        mockConfig,
        'prompt',
        'response',
        false,
      );

      expect(result).toBeUndefined();
      expect(mockHookSystem.fireAfterAgentEvent).not.toHaveBeenCalled();
    });

    it('should return undefined when hook system is not available', async () => {
      vi.mocked(mockConfig.getHookSystem).mockReturnValue(undefined);

      const result = await triggerAfterAgentHook(
        mockConfig,
        'prompt',
        'response',
        false,
      );

      expect(result).toBeUndefined();
    });

    it('should return undefined and not throw on hook error', async () => {
      vi.mocked(mockHookSystem.fireAfterAgentEvent).mockRejectedValue(
        new Error('Hook failed'),
      );

      const result = await triggerAfterAgentHook(
        mockConfig,
        'prompt',
        'response',
        false,
      );

      expect(result).toBeUndefined();
    });
  });

  /**
   * @plan PLAN-20250219-GMERGE021.R4.P02
   * @requirement REQ-P02-1
   */
  describe('triggerPreCompressHook', () => {
    it('should return undefined when hooks are disabled', async () => {
      vi.mocked(mockConfig.getEnableHooks).mockReturnValue(false);

      const result = await triggerPreCompressHook(
        mockConfig,
        PreCompressTrigger.Auto,
      );

      expect(result).toBeUndefined();
      expect(mockHookSystem.firePreCompressEvent).not.toHaveBeenCalled();
    });

    it('should return undefined when hook system is not available', async () => {
      vi.mocked(mockConfig.getHookSystem).mockReturnValue(undefined);

      const result = await triggerPreCompressHook(
        mockConfig,
        PreCompressTrigger.Auto,
      );

      expect(result).toBeUndefined();
    });

    it('should pass trigger value through to firePreCompressEvent', async () => {
      const mockResult: AggregatedHookResult = {
        success: true,
        finalOutput: {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'PreCompress',
          },
        },
        allOutputs: [],
        errors: [],
        totalDuration: 100,
      };
      vi.mocked(mockHookSystem.firePreCompressEvent).mockResolvedValue(
        mockResult,
      );

      await triggerPreCompressHook(mockConfig, PreCompressTrigger.Manual);

      expect(mockHookSystem.initialize).toHaveBeenCalled();
      expect(mockHookSystem.firePreCompressEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: PreCompressTrigger.Manual,
        }),
      );
    });

    it('should return undefined and not throw on hook error (fail-open)', async () => {
      vi.mocked(mockHookSystem.firePreCompressEvent).mockRejectedValue(
        new Error('Hook failed'),
      );

      const result = await triggerPreCompressHook(
        mockConfig,
        PreCompressTrigger.Auto,
      );

      expect(result).toBeUndefined();
    });
  });
});
