/**
 * @fileoverview Semantic tests for processCommonHookOutputFields, emitPerHookLogs, emitBatchSummary
 *
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20250218-HOOKSYSTEM.P13
 * @requirement DELTA-HRUN-001, DELTA-HRUN-002, DELTA-HRUN-003, DELTA-HRUN-004,
 *              DELTA-HTEL-001, DELTA-HTEL-002, DELTA-HFAIL-001, DELTA-HAPP-001, DELTA-HAPP-002
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import type { AggregatedHookResult } from '../hookAggregator.js';
import type { HookOutput, HookExecutionResult, HookConfig } from '../types.js';
import { HookEventName, DefaultHookOutput } from '../types.js';
import { HookEventHandler, ProcessedHookResult } from '../hookEventHandler.js';
import { HookPlanner } from '../hookPlanner.js';
import { HookRunner } from '../hookRunner.js';
import { HookAggregator } from '../hookAggregator.js';
import { HookRegistry } from '../hookRegistry.js';
import type { Config } from '../../config/config.js';
import type { DebugLogger } from '../../logging/debug-logger.js';

// -----------------------------------------------------------------------------
// Test Helpers
// -----------------------------------------------------------------------------

interface HookResultShape {
  success: boolean;
  durationMs: number;
  output?: Partial<HookOutput>;
}

interface MockDebugLogger {
  log: (channel: string, record: unknown) => void;
  logRecords: Array<{ channel: string; record: unknown }>;
}

/**
 * Build an AggregatedHookResult from an array of partial HookOutput values.
 * Used to construct test fixtures for processCommonHookOutputFields.
 */
function buildAggregated(
  outputs: Array<Partial<HookOutput>>,
  options: { success?: boolean; totalDuration?: number } = {},
): AggregatedHookResult {
  const allOutputs: HookOutput[] = outputs.map(
    (o) =>
      new DefaultHookOutput({
        continue: o.continue,
        stopReason: o.stopReason,
        suppressOutput: o.suppressOutput,
        systemMessage: o.systemMessage,
        decision: o.decision,
        reason: o.reason,
        hookSpecificOutput: o.hookSpecificOutput,
      }),
  );

  return {
    success: options.success ?? true,
    finalOutput: allOutputs.length > 0 ? allOutputs[0] : undefined,
    allOutputs,
    errors: [],
    totalDuration: options.totalDuration ?? 100,
  };
}

/**
 * Build an array of HookExecutionResult for testing emitPerHookLogs and emitBatchSummary.
 */
function buildHookResults(shapes: HookResultShape[]): HookExecutionResult[] {
  return shapes.map((s, i) => ({
    hookConfig: {
      id: `hook-${i}`,
      name: `test-hook-${i}`,
      events: [HookEventName.BeforeTool],
    } as HookConfig,
    eventName: HookEventName.BeforeTool,
    success: s.success,
    output: s.output
      ? new DefaultHookOutput({
          continue: s.output.continue,
          stopReason: s.output.stopReason,
          suppressOutput: s.output.suppressOutput,
          systemMessage: s.output.systemMessage,
        })
      : undefined,
    duration: s.durationMs,
    error: s.success ? undefined : new Error(`Hook ${i} failed`),
  }));
}

/**
 * Create a mock Config with minimal required fields
 */
function createMockConfig(): Partial<Config> {
  return {
    getSessionId: vi.fn().mockReturnValue('test-session-id'),
    getTargetDir: vi.fn().mockReturnValue('/test/dir'),
  };
}

/**
 * Create a mock DebugLogger that captures log records
 */
function createMockDebugLogger(): MockDebugLogger {
  const logRecords: Array<{ channel: string; record: unknown }> = [];
  return {
    log: (channel: string, record: unknown) => {
      logRecords.push({ channel, record });
    },
    logRecords,
  };
}

// -----------------------------------------------------------------------------
// Test Group 1: processCommonHookOutputFields - Stop Semantics
// -----------------------------------------------------------------------------

describe('processCommonHookOutputFields @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
  let eventHandler: HookEventHandler;
  let mockPlanner: HookPlanner;
  let mockRunner: HookRunner;
  let mockAggregator: HookAggregator;
  let mockRegistry: HookRegistry;
  let mockConfig: Partial<Config>;

  beforeEach(() => {
    mockConfig = createMockConfig();
    mockRegistry = new HookRegistry();
    mockPlanner = new HookPlanner(mockRegistry);
    mockRunner = new HookRunner(mockConfig as Config);
    mockAggregator = new HookAggregator();

    eventHandler = new HookEventHandler(
      mockConfig as Config,
      mockRegistry,
      mockPlanner,
      mockRunner,
      mockAggregator,
      undefined, // messageBus
      undefined, // debugLogger
    );
  });

  describe('stop semantics (DELTA-HRUN-002, DELTA-HAPP-001/002)', () => {
    /**
     * @plan PLAN-20250218-HOOKSYSTEM.P13
     * @requirement DELTA-HRUN-002, DELTA-HAPP-001
     * @scenario First hook signals stop
     * @given aggregated result with hookOutput that has stopReason
     * @when processCommonHookOutputFields called
     * @then shouldStop=true, stopReason matches the value
     */
    it('surfaces stop intent from first hook @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
      // Use the event handler to exercise the full path
      // Since processCommonHookOutputFields is private, we test it indirectly
      // by providing hook outputs with stopReason and verifying the result
      const aggregated = buildAggregated([
        { stopReason: 'token limit', continue: false },
        { continue: true },
      ]);

      // Access private method via reflection for direct testing
      const processMethod = (
        eventHandler as unknown as {
          processCommonHookOutputFields: (
            agg: AggregatedHookResult,
          ) => ProcessedHookResult;
        }
      ).processCommonHookOutputFields.bind(eventHandler);
      const result: ProcessedHookResult = processMethod(aggregated);

      // The stub returns shouldStop=false - this test expects real behavior (shouldStop=true)
      expect(result.shouldStop).toBe(true);
      expect(result.stopReason).toBe('token limit');
    });

    /**
     * @plan PLAN-20250218-HOOKSYSTEM.P13
     * @requirement DELTA-HRUN-002
     * @scenario Multiple hooks signal stop - first wins
     */
    it('first stop intent wins when multiple hooks signal stop @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
      const aggregated = buildAggregated([
        { stopReason: 'first reason', continue: false },
        { stopReason: 'second reason', continue: false },
      ]);

      const processMethod = (
        eventHandler as unknown as {
          processCommonHookOutputFields: (
            agg: AggregatedHookResult,
          ) => ProcessedHookResult;
        }
      ).processCommonHookOutputFields.bind(eventHandler);
      const result: ProcessedHookResult = processMethod(aggregated);

      expect(result.shouldStop).toBe(true);
      expect(result.stopReason).toBe('first reason');
    });

    /**
     * @plan PLAN-20250218-HOOKSYSTEM.P13
     * @requirement DELTA-HRUN-002
     * @scenario No hooks signal stop
     */
    it('no stop when no hooks signal stop @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
      const aggregated = buildAggregated([
        { continue: true },
        { continue: true },
      ]);

      const processMethod = (
        eventHandler as unknown as {
          processCommonHookOutputFields: (
            agg: AggregatedHookResult,
          ) => ProcessedHookResult;
        }
      ).processCommonHookOutputFields.bind(eventHandler);
      const result: ProcessedHookResult = processMethod(aggregated);

      expect(result.shouldStop).toBe(false);
      expect(result.stopReason).toBeUndefined();
    });
  });

  describe('systemMessage and suppressOutput (DELTA-HRUN-003)', () => {
    /**
     * @plan PLAN-20250218-HOOKSYSTEM.P13
     * @requirement DELTA-HRUN-003
     * @scenario Hook provides systemMessage
     */
    it('extracts systemMessage from hook output @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
      const aggregated = buildAggregated([
        { systemMessage: 'info: rate limited' },
      ]);

      const processMethod = (
        eventHandler as unknown as {
          processCommonHookOutputFields: (
            agg: AggregatedHookResult,
          ) => ProcessedHookResult;
        }
      ).processCommonHookOutputFields.bind(eventHandler);
      const result: ProcessedHookResult = processMethod(aggregated);

      // Stub returns undefined - test expects real value extraction
      expect(result.systemMessage).toBe('info: rate limited');
    });

    /**
     * @plan PLAN-20250218-HOOKSYSTEM.P13
     * @requirement DELTA-HRUN-003
     * @scenario Hook specifies suppressOutput
     */
    it('sets suppressOutput when hook output specifies it @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
      const aggregated = buildAggregated([
        { systemMessage: 'msg', suppressOutput: true },
      ]);

      const processMethod = (
        eventHandler as unknown as {
          processCommonHookOutputFields: (
            agg: AggregatedHookResult,
          ) => ProcessedHookResult;
        }
      ).processCommonHookOutputFields.bind(eventHandler);
      const result: ProcessedHookResult = processMethod(aggregated);

      // Stub returns false - test expects true when hook output sets it
      expect(result.suppressOutput).toBe(true);
    });
  });

  describe('empty batch defaults (DELTA-HRUN-004)', () => {
    /**
     * @plan PLAN-20250218-HOOKSYSTEM.P13
     * @requirement DELTA-HRUN-004
     * @scenario No hook outputs (empty batch)
     */
    it('returns safe defaults for empty allOutputs @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
      const aggregated = buildAggregated([]);

      const processMethod = (
        eventHandler as unknown as {
          processCommonHookOutputFields: (
            agg: AggregatedHookResult,
          ) => ProcessedHookResult;
        }
      ).processCommonHookOutputFields.bind(eventHandler);
      const result: ProcessedHookResult = processMethod(aggregated);

      expect(result.shouldStop).toBe(false);
      expect(result.stopReason).toBeUndefined();
      expect(result.systemMessage).toBeUndefined();
      expect(result.suppressOutput).toBe(false);
    });
  });

  describe('stopReason normalization', () => {
    /**
     * @plan PLAN-20250218-HOOKSYSTEM.P13
     * @requirement DELTA-HRUN-002
     * @scenario stopReason has leading/trailing whitespace
     */
    it('trims whitespace from stopReason @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
      const aggregated = buildAggregated([
        { stopReason: '  whitespace  ', continue: false },
      ]);

      const processMethod = (
        eventHandler as unknown as {
          processCommonHookOutputFields: (
            agg: AggregatedHookResult,
          ) => ProcessedHookResult;
        }
      ).processCommonHookOutputFields.bind(eventHandler);
      const result: ProcessedHookResult = processMethod(aggregated);

      // Stub returns undefined - test expects trimmed value
      expect(result.shouldStop).toBe(true);
      expect(result.stopReason).toBe('whitespace');
    });

    /**
     * @plan PLAN-20250218-HOOKSYSTEM.P13
     * @requirement DELTA-HRUN-002
     * @scenario continue=false with no stopReason uses fallback reason
     */
    it('continue=false with no reason uses fallback stopReason @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
      const aggregated = buildAggregated([
        { stopReason: undefined, reason: undefined, continue: false },
      ]);

      const processMethod = (
        eventHandler as unknown as {
          processCommonHookOutputFields: (
            agg: AggregatedHookResult,
          ) => ProcessedHookResult;
        }
      ).processCommonHookOutputFields.bind(eventHandler);
      const result: ProcessedHookResult = processMethod(aggregated);

      // continue=false triggers shouldStop even without explicit stopReason
      expect(result.shouldStop).toBe(true);
      expect(result.stopReason).toBe('Hook requested stop');
    });
  });
});

// -----------------------------------------------------------------------------
// Test Group 2: Logging (DELTA-HTEL-001, DELTA-HTEL-002)
// -----------------------------------------------------------------------------

describe('emitPerHookLogs and emitBatchSummary @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
  let eventHandler: HookEventHandler;
  let mockPlanner: HookPlanner;
  let mockRunner: HookRunner;
  let mockAggregator: HookAggregator;
  let mockRegistry: HookRegistry;
  let mockConfig: Partial<Config>;
  let mockDebugLogger: MockDebugLogger;

  beforeEach(() => {
    mockConfig = createMockConfig();
    mockDebugLogger = createMockDebugLogger();
    mockRegistry = new HookRegistry();
    mockPlanner = new HookPlanner(mockRegistry);
    mockRunner = new HookRunner(mockConfig as Config);
    mockAggregator = new HookAggregator();

    eventHandler = new HookEventHandler(
      mockConfig as Config,
      mockRegistry,
      mockPlanner,
      mockRunner,
      mockAggregator,
      undefined, // messageBus
      mockDebugLogger as unknown as DebugLogger,
    );
  });

  describe('per-hook logging (DELTA-HTEL-001)', () => {
    /**
     * @plan PLAN-20250218-HOOKSYSTEM.P13
     * @requirement DELTA-HTEL-001
     * @scenario Logger injected, hooks executed
     */
    it('emits one log record per hook result when logger injected @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
      const hookResults = buildHookResults([
        { success: true, durationMs: 50 },
        { success: true, durationMs: 75 },
      ]);

      const emitMethod = (
        eventHandler as unknown as {
          emitPerHookLogs: (
            eventName: HookEventName,
            results: HookExecutionResult[],
          ) => void;
        }
      ).emitPerHookLogs.bind(eventHandler);
      emitMethod(HookEventName.BeforeTool, hookResults);

      // Stub is no-op - test expects log records
      const hookLogs = mockDebugLogger.logRecords.filter(
        (r) => r.channel === 'hook:result',
      );
      expect(hookLogs.length).toBe(2);
    });

    /**
     * @plan PLAN-20250218-HOOKSYSTEM.P13
     * @requirement DELTA-HTEL-001
     * @scenario Failed hooks get additional diagnostic
     */
    it('emits failure diagnostic for failed hooks @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
      const hookResults = buildHookResults([
        { success: true, durationMs: 50 },
        { success: false, durationMs: 100 },
      ]);

      const emitMethod = (
        eventHandler as unknown as {
          emitPerHookLogs: (
            eventName: HookEventName,
            results: HookExecutionResult[],
          ) => void;
        }
      ).emitPerHookLogs.bind(eventHandler);
      emitMethod(HookEventName.BeforeTool, hookResults);

      // Stub is no-op - test expects failure diagnostic
      const failureLogs = mockDebugLogger.logRecords.filter(
        (r) => r.channel === 'hook:failure_diagnostic',
      );
      expect(failureLogs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('batch summary (DELTA-HTEL-002)', () => {
    /**
     * @plan PLAN-20250218-HOOKSYSTEM.P13
     * @requirement DELTA-HTEL-002
     * @scenario Logger injected, batch executed
     */
    it('emits one batch_summary record per event @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
      const hookResults = buildHookResults([
        { success: true, durationMs: 50 },
        { success: false, durationMs: 100 },
      ]);

      const emitMethod = (
        eventHandler as unknown as {
          emitBatchSummary: (
            eventName: HookEventName,
            results: HookExecutionResult[],
            totalDuration: number,
          ) => void;
        }
      ).emitBatchSummary.bind(eventHandler);
      emitMethod(HookEventName.BeforeTool, hookResults, 150);

      // Stub is no-op - test expects batch summary
      const summaryLogs = mockDebugLogger.logRecords.filter(
        (r) => r.channel === 'hook:batch_summary',
      );
      expect(summaryLogs.length).toBe(1);
    });

    /**
     * @plan PLAN-20250218-HOOKSYSTEM.P13
     * @requirement DELTA-HTEL-002
     * @scenario Batch summary has correct counts
     */
    it('batch summary has correct hookCount, successCount, failureCount @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
      const hookResults = buildHookResults([
        { success: true, durationMs: 50 },
        { success: false, durationMs: 100 },
        { success: true, durationMs: 25 },
      ]);

      const emitMethod = (
        eventHandler as unknown as {
          emitBatchSummary: (
            eventName: HookEventName,
            results: HookExecutionResult[],
            totalDuration: number,
          ) => void;
        }
      ).emitBatchSummary.bind(eventHandler);
      emitMethod(HookEventName.BeforeTool, hookResults, 175);

      // Stub is no-op - test expects specific counts
      const summaryLogs = mockDebugLogger.logRecords.filter(
        (r) => r.channel === 'hook:batch_summary',
      );
      expect(summaryLogs.length).toBe(1);
      const summary = summaryLogs[0].record as {
        hookCount: number;
        successCount: number;
        failureCount: number;
        totalDurationMs: number;
      };
      expect(summary.hookCount).toBe(3);
      expect(summary.successCount).toBe(2);
      expect(summary.failureCount).toBe(1);
      expect(summary.totalDurationMs).toBe(175);
    });
  });

  describe('no logger (graceful no-op)', () => {
    /**
     * @plan PLAN-20250218-HOOKSYSTEM.P13
     * @requirement DELTA-HTEL-001, DELTA-HTEL-002
     * @scenario No debugLogger injected
     */
    it('no log records when debugLogger absent @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
      // Create handler without debugLogger
      const handlerNoLogger = new HookEventHandler(
        mockConfig as Config,
        mockRegistry,
        mockPlanner,
        mockRunner,
        mockAggregator,
        undefined, // messageBus
        undefined, // debugLogger
      );

      const hookResults = buildHookResults([{ success: true, durationMs: 50 }]);

      // Should not throw
      const emitPerHook = (
        handlerNoLogger as unknown as {
          emitPerHookLogs: (
            eventName: HookEventName,
            results: HookExecutionResult[],
          ) => void;
        }
      ).emitPerHookLogs.bind(handlerNoLogger);
      const emitBatch = (
        handlerNoLogger as unknown as {
          emitBatchSummary: (
            eventName: HookEventName,
            results: HookExecutionResult[],
            totalDuration: number,
          ) => void;
        }
      ).emitBatchSummary.bind(handlerNoLogger);

      expect(() =>
        emitPerHook(HookEventName.BeforeTool, hookResults),
      ).not.toThrow();
      expect(() =>
        emitBatch(HookEventName.BeforeTool, hookResults, 50),
      ).not.toThrow();
    });
  });
});

// -----------------------------------------------------------------------------
// Test Group 3: Property-Based Tests (30%+ of test count)
// -----------------------------------------------------------------------------

describe('Property-based tests @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
  let eventHandler: HookEventHandler;

  beforeEach(() => {
    const mockConfig = createMockConfig();
    const mockRegistry = new HookRegistry();
    const mockPlanner = new HookPlanner(mockRegistry);
    const mockRunner = new HookRunner(mockConfig as Config);
    const mockAggregator = new HookAggregator();

    eventHandler = new HookEventHandler(
      mockConfig as Config,
      mockRegistry,
      mockPlanner,
      mockRunner,
      mockAggregator,
      undefined, // messageBus
      undefined, // debugLogger
    );
  });

  /**
   * METAMORPHIC INVARIANT 1: shouldStop is exactly the existential OR of all hook stop signals
   * Domain: non-empty arrays of hook output records with defined stop fields
   * Stop is triggered by continue === false (upstream parity)
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P13
   * @requirement DELTA-HRUN-002, DELTA-HAPP-001
   */
  test.prop([
    fc.array(
      fc.record({
        hasStopReason: fc.boolean(),
        stopReason: fc.string({ minLength: 1, maxLength: 50 }),
        continueIsFalse: fc.boolean(),
      }),
      { minLength: 1, maxLength: 8 },
    ),
  ])(
    'METAMORPHIC: shouldStop=true iff at least one hook has continue===false @plan:PLAN-20250218-HOOKSYSTEM.P13',
    (outputShapes) => {
      const outputs = outputShapes.map((s) => ({
        stopReason: s.hasStopReason ? s.stopReason : undefined,
        continue: s.continueIsFalse ? false : true,
      }));

      const aggregated = buildAggregated(outputs);
      const processMethod = (
        eventHandler as unknown as {
          processCommonHookOutputFields: (
            agg: AggregatedHookResult,
          ) => ProcessedHookResult;
        }
      ).processCommonHookOutputFields.bind(eventHandler);
      const result: ProcessedHookResult = processMethod(aggregated);

      // Invariant: shouldStop === outputs.some(o => o.continue === false)
      const expectedStop = outputs.some((o) => o.continue === false);
      // eslint-disable-next-line vitest/no-standalone-expect
      expect(result.shouldStop).toBe(expectedStop);
    },
  );

  /**
   * METAMORPHIC INVARIANT 2: normalizeStopReason is trim-idempotent
   * Domain: strings with realistic whitespace patterns
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P13
   * @requirement DELTA-HRUN-002
   */
  test.prop([
    fc.oneof(
      fc.string({ minLength: 1, maxLength: 100 }),
      fc.string({ minLength: 1, maxLength: 50 }).map((s) => `  ${s}  `),
      fc.string({ minLength: 1, maxLength: 50 }).map((s) => `\t${s}\n`),
    ),
  ])(
    'METAMORPHIC: stopReason output is trim-idempotent @plan:PLAN-20250218-HOOKSYSTEM.P13',
    (reason) => {
      const aggregated = buildAggregated([
        { stopReason: reason, continue: false },
      ]);

      const processMethod = (
        eventHandler as unknown as {
          processCommonHookOutputFields: (
            agg: AggregatedHookResult,
          ) => ProcessedHookResult;
        }
      ).processCommonHookOutputFields.bind(eventHandler);
      const result: ProcessedHookResult = processMethod(aggregated);

      // Invariant: if stopReason is present, it should already be trimmed
      if (result.stopReason !== undefined) {
        // eslint-disable-next-line vitest/no-standalone-expect
        expect(result.stopReason).toBe(result.stopReason.trim());
      }
    },
  );

  /**
   * METAMORPHIC INVARIANT 3: log record count >= hook count
   * Domain: bounded arrays of success flags with realistic hook durations
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P13
   * @requirement DELTA-HTEL-001
   */
  test.prop([
    fc.array(
      fc.record({
        success: fc.boolean(),
        durationMs: fc.integer({ min: 0, max: 5000 }),
      }),
      { minLength: 1, maxLength: 8 },
    ),
  ])(
    'METAMORPHIC: emitPerHookLogs emits at least one record per hook result @plan:PLAN-20250218-HOOKSYSTEM.P13',
    (hookResultShapes) => {
      const mockDebugLogger = createMockDebugLogger();
      const mockConfig = createMockConfig();
      const mockRegistry = new HookRegistry();
      const mockPlanner = new HookPlanner(mockRegistry);
      const mockRunner = new HookRunner(mockConfig as Config);
      const mockAggregator = new HookAggregator();

      const handler = new HookEventHandler(
        mockConfig as Config,
        mockRegistry,
        mockPlanner,
        mockRunner,
        mockAggregator,
        undefined, // messageBus
        mockDebugLogger as unknown as DebugLogger,
      );

      const hookResults = buildHookResults(hookResultShapes);
      const emitMethod = (
        handler as unknown as {
          emitPerHookLogs: (
            eventName: HookEventName,
            results: HookExecutionResult[],
          ) => void;
        }
      ).emitPerHookLogs.bind(handler);
      emitMethod(HookEventName.BeforeTool, hookResults);

      // Invariant: each hook gets at least one record
      // eslint-disable-next-line vitest/no-standalone-expect
      expect(mockDebugLogger.logRecords.length).toBeGreaterThanOrEqual(
        hookResultShapes.length,
      );
    },
  );

  /**
   * METAMORPHIC INVARIANT 4: batch summary counts are consistent
   * Domain: arrays with mixed success/failure
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P13
   * @requirement DELTA-HTEL-002
   */
  test.prop([
    fc.array(
      fc.record({
        success: fc.boolean(),
        durationMs: fc.integer({ min: 0, max: 5000 }),
      }),
      { minLength: 1, maxLength: 10 },
    ),
  ])(
    'METAMORPHIC: batch summary successCount + failureCount === hookCount @plan:PLAN-20250218-HOOKSYSTEM.P13',
    (hookResultShapes) => {
      const mockDebugLogger = createMockDebugLogger();
      const mockConfig = createMockConfig();
      const mockRegistry = new HookRegistry();
      const mockPlanner = new HookPlanner(mockRegistry);
      const mockRunner = new HookRunner(mockConfig as Config);
      const mockAggregator = new HookAggregator();

      const handler = new HookEventHandler(
        mockConfig as Config,
        mockRegistry,
        mockPlanner,
        mockRunner,
        mockAggregator,
        undefined, // messageBus
        mockDebugLogger as unknown as DebugLogger,
      );

      const hookResults = buildHookResults(hookResultShapes);
      const totalDuration = hookResultShapes.reduce(
        (sum, r) => sum + r.durationMs,
        0,
      );
      const emitMethod = (
        handler as unknown as {
          emitBatchSummary: (
            eventName: HookEventName,
            results: HookExecutionResult[],
            totalDuration: number,
          ) => void;
        }
      ).emitBatchSummary.bind(handler);
      emitMethod(HookEventName.BeforeTool, hookResults, totalDuration);

      const summaryLogs = mockDebugLogger.logRecords.filter(
        (r) => r.channel === 'hook:batch_summary',
      );

      // Stub is no-op - but when implemented:
      // Invariant: successCount + failureCount === hookCount
      if (summaryLogs.length > 0) {
        const summary = summaryLogs[0].record as {
          hookCount: number;
          successCount: number;
          failureCount: number;
        };
        // eslint-disable-next-line vitest/no-standalone-expect
        expect(summary.successCount + summary.failureCount).toBe(
          summary.hookCount,
        );
      }
    },
  );

  /**
   * METAMORPHIC INVARIANT 5: first systemMessage wins
   * Domain: arrays with optional systemMessage
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P13
   * @requirement DELTA-HRUN-003
   */
  test.prop([
    fc.array(
      fc.record({
        hasSystemMessage: fc.boolean(),
        systemMessage: fc.string({ minLength: 1, maxLength: 100 }),
      }),
      { minLength: 1, maxLength: 5 },
    ),
  ])(
    'METAMORPHIC: first systemMessage in allOutputs is surfaced @plan:PLAN-20250218-HOOKSYSTEM.P13',
    (outputShapes) => {
      const outputs = outputShapes.map((s) => ({
        systemMessage: s.hasSystemMessage ? s.systemMessage : undefined,
      }));

      const aggregated = buildAggregated(outputs);
      const processMethod = (
        eventHandler as unknown as {
          processCommonHookOutputFields: (
            agg: AggregatedHookResult,
          ) => ProcessedHookResult;
        }
      ).processCommonHookOutputFields.bind(eventHandler);
      const result: ProcessedHookResult = processMethod(aggregated);

      // Find first non-undefined systemMessage in outputs
      const firstSystemMessage = outputs.find(
        (o) => o.systemMessage !== undefined,
      )?.systemMessage;

      // Invariant: result.systemMessage === first systemMessage in outputs
      // eslint-disable-next-line vitest/no-standalone-expect
      expect(result.systemMessage).toBe(firstSystemMessage);
    },
  );
});
