/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi, type Mock } from 'bun:test';
import type {
  Counter,
  Meter,
  Attributes,
  Context,
  Histogram,
} from '@opentelemetry/api';
import type { TelemetryConfig } from '../internal/interfaces.js';
import {
  FileOperation,
  initializeMetrics,
  recordFileOperationMetric,
  recordTokenUsageMetrics,
  resetMetricsForTesting,
} from './metrics.js';

const mockCounterAddFn: Mock<
  (value: number, attributes?: Attributes, context?: Context) => void
> = vi.fn();
const mockHistogramRecordFn: Mock<
  (value: number, attributes?: Attributes, context?: Context) => void
> = vi.fn();

const mockCreateCounterFn: Mock<(name: string, options?: unknown) => Counter> =
  vi.fn();
const mockCreateHistogramFn: Mock<
  (name: string, options?: unknown) => Histogram
> = vi.fn();

const mockCounterInstance = {
  add: mockCounterAddFn,
} as unknown as Counter;

const mockHistogramInstance = {
  record: mockHistogramRecordFn,
} as unknown as Histogram;

const mockMeterInstance = {
  createCounter: mockCreateCounterFn.mockReturnValue(mockCounterInstance),
  createHistogram: mockCreateHistogramFn.mockReturnValue(mockHistogramInstance),
} as unknown as Meter;

describe('Telemetry Metrics', () => {
  beforeEach(() => {
    mockCounterAddFn.mockClear();
    mockCreateCounterFn.mockClear();
    mockCreateHistogramFn.mockClear();
    mockHistogramRecordFn.mockClear();
    mockCreateCounterFn.mockReturnValue(mockCounterInstance);
    mockCreateHistogramFn.mockReturnValue(mockHistogramInstance);
    resetMetricsForTesting(mockMeterInstance);
  });

  describe('recordTokenUsageMetrics', () => {
    const mockConfig = {
      getSessionId: () => 'test-session-id',
    } as unknown as TelemetryConfig;

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
    } as unknown as TelemetryConfig;

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
