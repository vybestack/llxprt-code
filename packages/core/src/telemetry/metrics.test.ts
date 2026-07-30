/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type {
  Counter,
  Meter,
  Attributes,
  Context,
  Histogram,
} from '@opentelemetry/api';
import type { Config } from '../config/config.js';

/**
 * vi.hoisted makes these mock instances available to the hoisted vi.mock()
 * factory in both Vitest (which hoists vi.mock above all declarations) and
 * Bun (where vi.hoisted is a pass-through). The mock functions and instances
 * are created here so the factory can reference them.
 */
const {
  mockCounterAddFn,
  mockHistogramRecordFn,
  mockCreateCounterFn,
  mockCreateHistogramFn,
  mockMeterInstance,
  mockGetMeterFn,
} = vi.hoisted(() => {
  const counterAdd: Mock<
    (value: number, attributes?: Attributes, context?: Context) => void
  > = vi.fn();
  const histogramRecord: Mock<
    (value: number, attributes?: Attributes, context?: Context) => void
  > = vi.fn();
  const createCounter: Mock<(name: string, options?: unknown) => Counter> =
    vi.fn();
  const createHistogram: Mock<(name: string, options?: unknown) => Histogram> =
    vi.fn();

  const counterInstance = {
    add: counterAdd,
  } as unknown as Counter;

  const histogramInstance = {
    record: histogramRecord,
  } as unknown as Histogram;

  const meterInstance = {
    createCounter: createCounter.mockReturnValue(counterInstance),
    createHistogram: createHistogram.mockReturnValue(histogramInstance),
  } as unknown as Meter;

  const getMeter = vi.fn().mockReturnValue(meterInstance);

  return {
    mockCounterAddFn: counterAdd,
    mockHistogramRecordFn: histogramRecord,
    mockCreateCounterFn: createCounter,
    mockCreateHistogramFn: createHistogram,
    mockMeterInstance: meterInstance,
    mockGetMeterFn: getMeter,
  };
});

vi.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: mockGetMeterFn,
  },
  ValueType: {
    INT: 1,
  },
}));

const {
  FileOperation,
  initializeMetrics,
  recordTokenUsageMetrics,
  recordFileOperationMetric,
  resetMetricsForTesting,
} = await import('./metrics.js');

/**
 * Resets all mock functions to their default state and re-establishes return
 * values that mockClear() wipes. Called from beforeEach so every test starts
 * from a clean mock state without re-declaring the mocks.
 */
function resetMockDefaults(): void {
  mockCounterAddFn.mockClear();
  mockCreateCounterFn.mockClear();
  mockCreateHistogramFn.mockClear();
  mockHistogramRecordFn.mockClear();
  mockGetMeterFn.mockClear();

  const mockCounterInstance = {
    add: mockCounterAddFn,
  } as unknown as Counter;
  const mockHistogramInstance = {
    record: mockHistogramRecordFn,
  } as unknown as Histogram;

  mockCreateCounterFn.mockReturnValue(mockCounterInstance);
  mockCreateHistogramFn.mockReturnValue(mockHistogramInstance);
  mockGetMeterFn.mockReturnValue(mockMeterInstance);
}

describe('Telemetry Metrics', () => {
  beforeEach(() => {
    resetMetricsForTesting();
    resetMockDefaults();
  });

  describe('recordTokenUsageMetrics', () => {
    const mockConfig = {
      getSessionId: () => 'test-session-id',
    } as unknown as Config;

    it('should not record metrics if not initialized', () => {
      recordTokenUsageMetrics(mockConfig, 'gemini-pro', 100, 'input');
      expect(mockCounterAddFn).not.toHaveBeenCalled();
    });

    it('should record token usage with the correct attributes', () => {
      initializeMetrics(mockConfig);
      recordTokenUsageMetrics(mockConfig, 'gemini-pro', 100, 'input');
      expect(mockCounterAddFn).toHaveBeenCalledTimes(2);
      expect(mockCounterAddFn).toHaveBeenNthCalledWith(1, 1, {
        'session.id': 'test-session-id',
      });
      expect(mockCounterAddFn).toHaveBeenNthCalledWith(2, 100, {
        'session.id': 'test-session-id',
        model: 'gemini-pro',
        type: 'input',
      });
    });

    it('should record token usage for different types', () => {
      initializeMetrics(mockConfig);
      mockCounterAddFn.mockClear();

      recordTokenUsageMetrics(mockConfig, 'gemini-pro', 50, 'output');
      expect(mockCounterAddFn).toHaveBeenCalledWith(50, {
        'session.id': 'test-session-id',
        model: 'gemini-pro',
        type: 'output',
      });

      recordTokenUsageMetrics(mockConfig, 'gemini-pro', 25, 'thought');
      expect(mockCounterAddFn).toHaveBeenCalledWith(25, {
        'session.id': 'test-session-id',
        model: 'gemini-pro',
        type: 'thought',
      });

      recordTokenUsageMetrics(mockConfig, 'gemini-pro', 75, 'cache');
      expect(mockCounterAddFn).toHaveBeenCalledWith(75, {
        'session.id': 'test-session-id',
        model: 'gemini-pro',
        type: 'cache',
      });

      recordTokenUsageMetrics(mockConfig, 'gemini-pro', 125, 'tool');
      expect(mockCounterAddFn).toHaveBeenCalledWith(125, {
        'session.id': 'test-session-id',
        model: 'gemini-pro',
        type: 'tool',
      });
    });

    it('should handle different models', () => {
      initializeMetrics(mockConfig);
      mockCounterAddFn.mockClear();

      recordTokenUsageMetrics(mockConfig, 'gemini-ultra', 200, 'input');
      expect(mockCounterAddFn).toHaveBeenCalledWith(200, {
        'session.id': 'test-session-id',
        model: 'gemini-ultra',
        type: 'input',
      });
    });
  });

  describe('recordFileOperationMetric', () => {
    const mockConfig = {
      getSessionId: () => 'test-session-id',
    } as unknown as Config;

    it('should not record metrics if not initialized', () => {
      recordFileOperationMetric(
        mockConfig,
        FileOperation.CREATE,
        10,
        'text/plain',
        'txt',
      );
      expect(mockCounterAddFn).not.toHaveBeenCalled();
    });

    it('should record file creation with all attributes', () => {
      initializeMetrics(mockConfig);
      recordFileOperationMetric(
        mockConfig,
        FileOperation.CREATE,
        10,
        'text/plain',
        'txt',
      );

      expect(mockCounterAddFn).toHaveBeenCalledTimes(2);
      expect(mockCounterAddFn).toHaveBeenNthCalledWith(1, 1, {
        'session.id': 'test-session-id',
      });
      expect(mockCounterAddFn).toHaveBeenNthCalledWith(2, 1, {
        'session.id': 'test-session-id',
        operation: FileOperation.CREATE,
        lines: 10,
        mimetype: 'text/plain',
        extension: 'txt',
      });
    });

    it('should record file read with minimal attributes', () => {
      initializeMetrics(mockConfig);
      mockCounterAddFn.mockClear();

      recordFileOperationMetric(mockConfig, FileOperation.READ);
      expect(mockCounterAddFn).toHaveBeenCalledWith(1, {
        'session.id': 'test-session-id',
        operation: FileOperation.READ,
      });
    });

    it('should record file update with some attributes', () => {
      initializeMetrics(mockConfig);
      mockCounterAddFn.mockClear();

      recordFileOperationMetric(
        mockConfig,
        FileOperation.UPDATE,
        undefined,
        'application/javascript',
      );
      expect(mockCounterAddFn).toHaveBeenCalledWith(1, {
        'session.id': 'test-session-id',
        operation: FileOperation.UPDATE,
        mimetype: 'application/javascript',
      });
    });

    it('should include diffStat when provided', () => {
      initializeMetrics(mockConfig);
      mockCounterAddFn.mockClear();

      const diffStat = {
        ai_added_lines: 5,
        ai_removed_lines: 2,
        user_added_lines: 3,
        user_removed_lines: 1,
      };

      recordFileOperationMetric(
        mockConfig,
        FileOperation.UPDATE,
        undefined,
        undefined,
        undefined,
        diffStat,
      );

      expect(mockCounterAddFn).toHaveBeenCalledWith(1, {
        'session.id': 'test-session-id',
        operation: FileOperation.UPDATE,
        ai_added_lines: 5,
        ai_removed_lines: 2,
        user_added_lines: 3,
        user_removed_lines: 1,
      });
    });

    it('should not include diffStat attributes when diffStat is not provided', () => {
      initializeMetrics(mockConfig);
      mockCounterAddFn.mockClear();

      recordFileOperationMetric(
        mockConfig,
        FileOperation.UPDATE,
        10,
        'text/plain',
        'txt',
        undefined,
      );

      expect(mockCounterAddFn).toHaveBeenCalledWith(1, {
        'session.id': 'test-session-id',
        operation: FileOperation.UPDATE,
        lines: 10,
        mimetype: 'text/plain',
        extension: 'txt',
      });
    });

    it('should handle diffStat with all zero values', () => {
      initializeMetrics(mockConfig);
      mockCounterAddFn.mockClear();

      const diffStat = {
        ai_added_lines: 0,
        ai_removed_lines: 0,
        user_added_lines: 0,
        user_removed_lines: 0,
      };

      recordFileOperationMetric(
        mockConfig,
        FileOperation.UPDATE,
        undefined,
        undefined,
        undefined,
        diffStat,
      );

      expect(mockCounterAddFn).toHaveBeenCalledWith(1, {
        'session.id': 'test-session-id',
        operation: FileOperation.UPDATE,
        ai_added_lines: 0,
        ai_removed_lines: 0,
        user_added_lines: 0,
        user_removed_lines: 0,
      });
    });
  });
});
