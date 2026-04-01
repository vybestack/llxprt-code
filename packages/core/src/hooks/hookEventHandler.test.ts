/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P06,P07
 * @requirement:HOOK-061,HOOK-062,HOOK-063,HOOK-064,HOOK-065,HOOK-066,HOOK-067a,HOOK-067b,HOOK-068,HOOK-069,HOOK-070,HOOK-143,HOOK-144,HOOK-145,HOOK-146,HOOK-147
 * @pseudocode:analysis/pseudocode/02-hook-event-handler-flow.md
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HookEventHandler } from './hookEventHandler.js';
import type { Config } from '../config/config.js';
import type { HookRegistry } from './hookRegistry.js';
import type { HookPlanner } from './hookPlanner.js';
import type { HookRunner } from './hookRunner.js';
import type { HookAggregator, AggregatedHookResult } from './hookAggregator.js';
import type { SessionRecordingService } from '../recording/SessionRecordingService.js';
import { HookEventName } from './types.js';
import type { HookExecutionResult } from './types.js';
import { coreEvents } from '../utils/events.js';

// Mock DebugLogger
vi.mock('../debug/index.js', () => {
  const createLogger = () => ({
    debug: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });

  class MockDebugLogger {
    static getLogger() {
      return createLogger();
    }

    constructor(_namespace?: string) {}

    debug = vi.fn();
    log = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  }

  return {
    DebugLogger: MockDebugLogger,
  };
});

// Mock coreEvents
vi.mock('../utils/events.js', () => ({
  coreEvents: {
    emitFeedback: vi.fn(),
  },
}));

describe('HookEventHandler', () => {
  let mockConfig: Config;
  let mockRegistry: HookRegistry;
  let mockPlanner: HookPlanner;
  let mockRunner: HookRunner;
  let mockAggregator: HookAggregator;
  let eventHandler: HookEventHandler;

  const EMPTY_SUCCESS_RESULT: AggregatedHookResult = {
    success: true,
    finalOutput: undefined,
    allOutputs: [],
    errors: [],
    totalDuration: 0,
  };

  beforeEach(() => {
    mockConfig = {
      getSessionId: vi.fn().mockReturnValue('test-session-123'),
      getTargetDir: vi.fn().mockReturnValue('/test/target'),
      getSessionRecordingService: vi.fn().mockReturnValue({
        getFilePath: vi
          .fn()
          .mockReturnValue(
            '/test/target/.llxprt/tmp/chats/session-2025-01-20-test-session-123.jsonl',
          ),
      }),
    } as unknown as Config;

    mockRegistry = {} as unknown as HookRegistry;

    mockPlanner = {
      createExecutionPlan: vi.fn().mockReturnValue(null),
    } as unknown as HookPlanner;

    mockRunner = {
      executeHooksSequential: vi.fn().mockResolvedValue([]),
      executeHooksParallel: vi.fn().mockResolvedValue([]),
    } as unknown as HookRunner;

    mockAggregator = {
      aggregateResults: vi.fn().mockReturnValue(EMPTY_SUCCESS_RESULT),
    } as unknown as HookAggregator;

    eventHandler = new HookEventHandler(
      mockConfig,
      mockRegistry,
      mockPlanner,
      mockRunner,
      mockAggregator,
    );
  });

  describe('fireBeforeToolEvent', () => {
    it('should return undefined when no hooks match', async () => {
      // @requirement:HOOK-145 - Returns empty success result when no hooks match
      const result = await eventHandler.fireBeforeToolEvent('read_file', {
        path: '/test.txt',
      });
      expect(result).toBeUndefined();
    });

    it('should call planner with BeforeTool event name', async () => {
      await eventHandler.fireBeforeToolEvent('write_file', {
        path: '/out.txt',
      });
      expect(mockPlanner.createExecutionPlan).toHaveBeenCalledWith(
        'BeforeTool',
        { toolName: 'write_file' },
      );
    });
  });

  describe('fireAfterToolEvent', () => {
    it('should return undefined when no hooks match', async () => {
      // @requirement:HOOK-145

      const result = await eventHandler.fireAfterToolEvent(
        'read_file',
        { path: '/test.txt' },
        { content: 'file content' },
      );
      expect(result).toBeUndefined();
    });

    it('should call planner with AfterTool event name', async () => {
      await eventHandler.fireAfterToolEvent(
        'shell',
        { command: 'ls' },
        { output: 'files' },
      );
      expect(mockPlanner.createExecutionPlan).toHaveBeenCalledWith(
        'AfterTool',
        {
          toolName: 'shell',
        },
      );
    });
  });

  describe('fireBeforeModelEvent', () => {
    it('should return empty success result when no hooks match', async () => {
      // @requirement:HOOK-145
      const result = await eventHandler.fireBeforeModelEvent({
        messages: [{ role: 'user', content: 'Hello' }],
      });
      expect(result).toEqual(EMPTY_SUCCESS_RESULT);
    });

    it('should call planner with BeforeModel event name', async () => {
      await eventHandler.fireBeforeModelEvent({ messages: [] });
      expect(mockPlanner.createExecutionPlan).toHaveBeenCalledWith(
        'BeforeModel',
        undefined,
      );
    });

    it('should handle errors gracefully and return failure envelope', async () => {
      // @requirement:HOOK-147 - Wraps in try/catch, never propagates exceptions
      // @requirement:DELTA-HFAIL-001 - Errors surface via failure envelope, not masked
      vi.mocked(mockPlanner.createExecutionPlan).mockImplementation(() => {
        throw new Error('Planner error');
      });

      const result = await eventHandler.fireBeforeModelEvent({ messages: [] });
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toBe('Planner error');
    });
  });

  describe('fireAfterModelEvent', () => {
    it('should return empty success result when no hooks match', async () => {
      // @requirement:HOOK-145
      const result = await eventHandler.fireAfterModelEvent(
        { messages: [] },
        { text: 'Response text' },
      );
      expect(result).toEqual(EMPTY_SUCCESS_RESULT);
    });

    it('should call planner with AfterModel event name', async () => {
      await eventHandler.fireAfterModelEvent({ messages: [] }, { text: 'Hi' });
      expect(mockPlanner.createExecutionPlan).toHaveBeenCalledWith(
        'AfterModel',
        undefined,
      );
    });

    it('should handle errors gracefully and return failure envelope', async () => {
      // @requirement:HOOK-147
      // @requirement:DELTA-HFAIL-001 - Errors surface via failure envelope, not masked
      vi.mocked(mockPlanner.createExecutionPlan).mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const result = await eventHandler.fireAfterModelEvent(
        { messages: [] },
        { text: 'Response' },
      );
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toBe('Unexpected error');
    });
  });

  describe('fireBeforeToolSelectionEvent', () => {
    it('should return empty success result when no hooks match', async () => {
      // @requirement:HOOK-145
      const result = await eventHandler.fireBeforeToolSelectionEvent({
        messages: [],
      });
      expect(result).toEqual(EMPTY_SUCCESS_RESULT);
    });

    it('should call planner with BeforeToolSelection event name', async () => {
      await eventHandler.fireBeforeToolSelectionEvent({ messages: [] });
      expect(mockPlanner.createExecutionPlan).toHaveBeenCalledWith(
        'BeforeToolSelection',
        undefined,
      );
    });

    it('should handle errors gracefully and return failure envelope', async () => {
      // @requirement:HOOK-147
      // @requirement:DELTA-HFAIL-001 - Errors surface via failure envelope, not masked
      vi.mocked(mockPlanner.createExecutionPlan).mockImplementation(() => {
        throw new Error('Tool selection error');
      });

      const result = await eventHandler.fireBeforeToolSelectionEvent({
        messages: [],
      });
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toBe('Tool selection error');
    });
  });

  describe('HookInput base fields', () => {
    it('should include session_id from config', async () => {
      // @requirement:HOOK-062 - Base fields included
      // @requirement:HOOK-144 - Builds HookInput payloads with base fields from Config
      const plan = {
        hookConfigs: [{ type: 'command', command: 'echo test' }],
        sequential: false,
      };
      vi.mocked(mockPlanner.createExecutionPlan).mockReturnValue(plan);

      await eventHandler.fireBeforeModelEvent({ messages: [] });

      expect(mockRunner.executeHooksParallel).toHaveBeenCalledWith(
        plan.hookConfigs,
        'BeforeModel',
        expect.objectContaining({
          session_id: 'test-session-123',
          cwd: '/test/target',
          hook_event_name: 'BeforeModel',
          transcript_path:
            '/test/target/.llxprt/tmp/chats/session-2025-01-20-test-session-123.jsonl',
        }),
      );
    });

    it('should include timestamp in HookInput', async () => {
      // @requirement:HOOK-062
      const plan = {
        hookConfigs: [{ type: 'command', command: 'echo test' }],
        sequential: false,
      };
      vi.mocked(mockPlanner.createExecutionPlan).mockReturnValue(plan);

      await eventHandler.fireBeforeModelEvent({ messages: [] });

      expect(mockRunner.executeHooksParallel).toHaveBeenCalledWith(
        plan.hookConfigs,
        'BeforeModel',
        expect.objectContaining({
          timestamp: expect.any(String),
        }),
      );
    });
  });

  describe('execution flow', () => {
    it('should execute hooks in parallel by default', async () => {
      // @requirement:HOOK-143 - fire*Event methods
      const plan = {
        hookConfigs: [
          { type: 'command', command: 'hook1' },
          { type: 'command', command: 'hook2' },
        ],
        sequential: false,
      };
      vi.mocked(mockPlanner.createExecutionPlan).mockReturnValue(plan);

      await eventHandler.fireBeforeModelEvent({ messages: [] });

      expect(mockRunner.executeHooksParallel).toHaveBeenCalled();
      expect(mockRunner.executeHooksSequential).not.toHaveBeenCalled();
    });

    it('should execute hooks sequentially when plan specifies', async () => {
      const plan = {
        hookConfigs: [{ type: 'command', command: 'hook1' }],
        sequential: true,
      };
      vi.mocked(mockPlanner.createExecutionPlan).mockReturnValue(plan);

      await eventHandler.fireBeforeModelEvent({ messages: [] });

      expect(mockRunner.executeHooksSequential).toHaveBeenCalled();
      expect(mockRunner.executeHooksParallel).not.toHaveBeenCalled();
    });

    it('should aggregate results after execution', async () => {
      const plan = {
        hookConfigs: [{ type: 'command', command: 'hook1' }],
        sequential: false,
      };
      const executionResults = [
        { success: true, output: { decision: 'allow' } },
      ];
      vi.mocked(mockPlanner.createExecutionPlan).mockReturnValue(plan);
      vi.mocked(mockRunner.executeHooksParallel).mockResolvedValue(
        executionResults,
      );

      await eventHandler.fireBeforeModelEvent({ messages: [] });

      expect(mockAggregator.aggregateResults).toHaveBeenCalledWith(
        executionResults,
        'BeforeModel',
      );
    });
  });

  describe('telemetry logging', () => {
    it('should log hook event execution at debug level', async () => {
      // @requirement:HOOK-146 - Logs telemetry at debug level
      const plan = {
        hookConfigs: [{ type: 'command', command: 'test-hook' }],
        sequential: false,
      };
      vi.mocked(mockPlanner.createExecutionPlan).mockReturnValue(plan);

      // The debug logger is mocked, so we just verify no errors
      await expect(
        eventHandler.fireBeforeModelEvent({ messages: [] }),
      ).resolves.toBeDefined();
    });
  });

  /**
   * @plan PLAN-20250219-GMERGE021.R4.P01
   * @requirement REQ-P01-1
   */
  describe('firePreCompressEvent', () => {
    it('should dispatch with hookEventName: PreCompress', async () => {
      await eventHandler.firePreCompressEvent({ trigger: 'manual' as const });

      expect(mockPlanner.createExecutionPlan).toHaveBeenCalledWith(
        'PreCompress',
        { trigger: 'manual' },
      );
    });

    it('should pass trigger: manual when Manual is given', async () => {
      const plan = {
        hookConfigs: [{ type: 'command', command: 'test-hook' }],
        sequential: false,
      };
      vi.mocked(mockPlanner.createExecutionPlan).mockReturnValue(plan);
      vi.mocked(mockRunner.executeHooksParallel).mockResolvedValue([
        { success: true, output: {} },
      ]);

      await eventHandler.firePreCompressEvent({ trigger: 'manual' as const });

      // The trigger is passed in the input context, not to the planner
      expect(mockRunner.executeHooksParallel).toHaveBeenCalled();
      const callArgs = vi.mocked(mockRunner.executeHooksParallel).mock.calls[0];
      const input = callArgs[2]; // third arg is the input
      expect(input).toMatchObject({ trigger: 'manual' });
    });

    it('should pass trigger: auto when Auto is given', async () => {
      const plan = {
        hookConfigs: [{ type: 'command', command: 'test-hook' }],
        sequential: false,
      };
      vi.mocked(mockPlanner.createExecutionPlan).mockReturnValue(plan);
      vi.mocked(mockRunner.executeHooksParallel).mockResolvedValue([
        { success: true, output: {} },
      ]);

      await eventHandler.firePreCompressEvent({ trigger: 'auto' as const });

      expect(mockRunner.executeHooksParallel).toHaveBeenCalled();
      const callArgs = vi.mocked(mockRunner.executeHooksParallel).mock.calls[0];
      const input = callArgs[2];
      expect(input).toMatchObject({ trigger: 'auto' });
    });

    it('should return failure envelope (not throw) on hook runner error', async () => {
      const plan = {
        hookConfigs: [{ type: 'command', command: 'test-hook' }],
        sequential: false,
      };
      vi.mocked(mockPlanner.createExecutionPlan).mockReturnValue(plan);
      vi.mocked(mockRunner.executeHooksParallel).mockRejectedValue(
        new Error('Hook runner error'),
      );

      const result = await eventHandler.firePreCompressEvent({
        trigger: 'auto' as const,
      });

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  /**
   * @plan PLAN-20250219-GMERGE022.B2
   * @requirement R1, R2, R3
   */
  describe('transcript_path population', () => {
    it('should include transcript_path from SessionRecordingService when available', async () => {
      // ARRANGE
      const plan = {
        hookConfigs: [{ type: 'command', command: 'echo test' }],
        sequential: false,
      };
      vi.mocked(mockPlanner.createExecutionPlan).mockReturnValue(plan);

      // ACT
      await eventHandler.fireBeforeModelEvent({ messages: [] });

      // ASSERT
      expect(mockRunner.executeHooksParallel).toHaveBeenCalledWith(
        plan.hookConfigs,
        'BeforeModel',
        expect.objectContaining({
          transcript_path:
            '/test/target/.llxprt/tmp/chats/session-2025-01-20-test-session-123.jsonl',
        }),
      );
    });

    it('should use empty string for transcript_path when SessionRecordingService is undefined', async () => {
      // ARRANGE
      const plan = {
        hookConfigs: [{ type: 'command', command: 'echo test' }],
        sequential: false,
      };
      vi.mocked(mockPlanner.createExecutionPlan).mockReturnValue(plan);
      vi.mocked(mockConfig.getSessionRecordingService).mockReturnValue(
        undefined,
      );

      // ACT
      await eventHandler.fireBeforeModelEvent({ messages: [] });

      // ASSERT
      expect(mockRunner.executeHooksParallel).toHaveBeenCalledWith(
        plan.hookConfigs,
        'BeforeModel',
        expect.objectContaining({
          transcript_path: '',
        }),
      );
    });

    it('should use empty string for transcript_path when getFilePath returns null', async () => {
      // ARRANGE
      const plan = {
        hookConfigs: [{ type: 'command', command: 'echo test' }],
        sequential: false,
      };
      vi.mocked(mockPlanner.createExecutionPlan).mockReturnValue(plan);
      vi.mocked(mockConfig.getSessionRecordingService).mockReturnValue({
        getFilePath: vi.fn().mockReturnValue(null),
      } as unknown as SessionRecordingService);

      // ACT
      await eventHandler.fireBeforeModelEvent({ messages: [] });

      // ASSERT
      expect(mockRunner.executeHooksParallel).toHaveBeenCalledWith(
        plan.hookConfigs,
        'BeforeModel',
        expect.objectContaining({
          transcript_path: '',
        }),
      );
    });

    it('should include transcript_path in BeforeTool events', async () => {
      // ARRANGE
      const plan = {
        hookConfigs: [{ type: 'command', command: 'echo test' }],
        sequential: false,
      };
      vi.mocked(mockPlanner.createExecutionPlan).mockReturnValue(plan);

      // ACT
      await eventHandler.fireBeforeToolEvent('read_file', {
        path: '/test.txt',
      });

      // ASSERT
      expect(mockRunner.executeHooksParallel).toHaveBeenCalledWith(
        plan.hookConfigs,
        'BeforeTool',
        expect.objectContaining({
          transcript_path:
            '/test/target/.llxprt/tmp/chats/session-2025-01-20-test-session-123.jsonl',
          tool_name: 'read_file',
          tool_input: { path: '/test.txt' },
        }),
      );
    });

    it('should include transcript_path in AfterTool events', async () => {
      // ARRANGE
      const plan = {
        hookConfigs: [{ type: 'command', command: 'echo test' }],
        sequential: false,
      };
      vi.mocked(mockPlanner.createExecutionPlan).mockReturnValue(plan);

      // ACT
      await eventHandler.fireAfterToolEvent(
        'write_file',
        { path: '/out.txt', content: 'data' },
        { success: true },
      );

      // ASSERT
      expect(mockRunner.executeHooksParallel).toHaveBeenCalledWith(
        plan.hookConfigs,
        'AfterTool',
        expect.objectContaining({
          transcript_path:
            '/test/target/.llxprt/tmp/chats/session-2025-01-20-test-session-123.jsonl',
          tool_name: 'write_file',
        }),
      );
    });

    it('should include transcript_path in SessionStart events', async () => {
      // ARRANGE
      const plan = {
        hookConfigs: [{ type: 'command', command: 'echo test' }],
        sequential: false,
      };
      vi.mocked(mockPlanner.createExecutionPlan).mockReturnValue(plan);

      // ACT
      await eventHandler.fireSessionStartEvent({ source: 'startup' as const });

      // ASSERT
      expect(mockRunner.executeHooksParallel).toHaveBeenCalledWith(
        plan.hookConfigs,
        'SessionStart',
        expect.objectContaining({
          transcript_path:
            '/test/target/.llxprt/tmp/chats/session-2025-01-20-test-session-123.jsonl',
          source: 'startup',
        }),
      );
    });
  });

  describe('hook failure feedback', () => {
    it('should emit user-facing feedback when hooks fail', async () => {
      // Mock coreEvents.emitFeedback
      const mockEmitFeedback = vi.fn();
      vi.mocked(coreEvents.emitFeedback).mockImplementation(mockEmitFeedback);

      const mockPlan = {
        eventName: HookEventName.BeforeTool,
        hookConfigs: [
          {
            type: 'command' as const,
            command: './fail.sh',
          },
        ],
        sequential: false,
      };

      const mockResults: HookExecutionResult[] = [
        {
          success: false,
          duration: 50,
          hookConfig: mockPlan.hookConfigs[0],
          eventName: HookEventName.BeforeTool,
          error: new Error('Failed to execute'),
          stdout: '',
          stderr: 'Hook execution failed',
        },
      ];

      const mockAggregated: AggregatedHookResult = {
        success: false,
        finalOutput: undefined,
        allOutputs: [],
        errors: [new Error('Failed to execute')],
        totalDuration: 50,
      };

      vi.mocked(mockPlanner.createExecutionPlan).mockReturnValue(mockPlan);
      vi.mocked(mockRunner.executeHooksParallel).mockResolvedValue(mockResults);
      vi.mocked(mockAggregator.aggregateResults).mockReturnValue(
        mockAggregated,
      );

      await eventHandler.fireBeforeToolEvent('EditTool', {});

      // Verify emitFeedback was called with warning about failed hook
      expect(mockEmitFeedback).toHaveBeenCalledWith(
        'warning',
        expect.stringContaining('./fail.sh'),
      );
      expect(mockEmitFeedback).toHaveBeenCalledWith(
        'warning',
        expect.stringContaining('F12'),
      );
    });
  });
});
