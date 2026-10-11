/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  METRIC_TOKEN_USAGE,
  METRIC_FILE_OPERATION_COUNT,
  METRIC_SESSION_COUNT,
} from './constants.js';
import { RootTelemetry } from './root-telemetry.js';
import {
  FileOperation,
  initializeMetrics,
  recordTokenUsageMetrics,
  recordFileOperationMetric,
} from './metrics.js';
const metricRecord = z.object({
  scopeMetrics: z.array(
    z.object({
      metrics: z.array(
        z.object({
          descriptor: z.object({ name: z.string() }),
          dataPoints: z.array(
            z.object({ attributes: z.record(z.unknown()), value: z.number() }),
          ),
        }),
      ),
    }),
  ),
});
let selected: RootTelemetry;
let file: string;
async function points(): Promise<
  Array<{ attributes: Record<string, unknown>; value: number }>
> {
  await selected.flush();
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) =>
      metricRecord.parse(JSON.parse(line)).scopeMetrics.flatMap((scope) =>
        scope.metrics.flatMap((metric) => {
          const first = metric.dataPoints[0];
          let expectedMetric = METRIC_SESSION_COUNT;
          if (first.attributes.operation !== undefined)
            expectedMetric = METRIC_FILE_OPERATION_COUNT;
          else if (first.attributes.model !== undefined)
            expectedMetric = METRIC_TOKEN_USAGE;
          expect(metric.descriptor.name).toBe(expectedMetric);
          return metric.dataPoints;
        }),
      ),
    );
}

describe('Telemetry Metrics', () => {
  beforeEach(() => {
    const directory = join(tmpdir(), 'llxprt-telemetry-listener');
    mkdirSync(directory, { recursive: true });
    file = join(
      mkdtempSync(join(directory, 'native-metrics-')),
      'metrics.jsonl',
    );
    selected = RootTelemetry.prepare({
      enabled: false,
      sessionId: 'test-session-id',
      outfile: file,
      maxBytes: 1048576,
      maxFiles: 2,
    });
  });
  afterEach(async () => {
    await selected.close();
  });

  describe('recordTokenUsageMetrics', () => {
    it('should not record metrics if not initialized', async () => {
      recordTokenUsageMetrics(selected, 'gemini-pro', 100, 'input');
      expect(existsSync(file)).toBe(false);
    });

    it('should record token usage with the correct attributes', async () => {
      await initializeMetrics(selected);
      recordTokenUsageMetrics(selected, 'gemini-pro', 100, 'input');
      expect(await points()).toHaveLength(2);
      expect(await points()).toContainEqual({
        value: 1,
        attributes: {
          'session.id': 'test-session-id',
        },
      });
      expect(await points()).toContainEqual({
        value: 100,
        attributes: {
          'session.id': 'test-session-id',
          model: 'gemini-pro',
          type: 'input',
        },
      });
    });

    it('should record token usage for different types', async () => {
      await initializeMetrics(selected);

      recordTokenUsageMetrics(selected, 'gemini-pro', 50, 'output');
      expect(await points()).toContainEqual({
        value: 50,
        attributes: {
          'session.id': 'test-session-id',
          model: 'gemini-pro',
          type: 'output',
        },
      });

      recordTokenUsageMetrics(selected, 'gemini-pro', 25, 'thought');
      expect(await points()).toContainEqual({
        value: 25,
        attributes: {
          'session.id': 'test-session-id',
          model: 'gemini-pro',
          type: 'thought',
        },
      });

      recordTokenUsageMetrics(selected, 'gemini-pro', 75, 'cache');
      expect(await points()).toContainEqual({
        value: 75,
        attributes: {
          'session.id': 'test-session-id',
          model: 'gemini-pro',
          type: 'cache',
        },
      });

      recordTokenUsageMetrics(selected, 'gemini-pro', 125, 'tool');
      expect(await points()).toContainEqual({
        value: 125,
        attributes: {
          'session.id': 'test-session-id',
          model: 'gemini-pro',
          type: 'tool',
        },
      });
    });

    it('should handle different models', async () => {
      await initializeMetrics(selected);

      recordTokenUsageMetrics(selected, 'gemini-ultra', 200, 'input');
      expect(await points()).toContainEqual({
        value: 200,
        attributes: {
          'session.id': 'test-session-id',
          model: 'gemini-ultra',
          type: 'input',
        },
      });
    });
  });

  describe('recordFileOperationMetric', () => {
    it('should not record metrics if not initialized', async () => {
      recordFileOperationMetric(
        selected,
        FileOperation.CREATE,
        10,
        'text/plain',
        'txt',
      );
      expect(existsSync(file)).toBe(false);
    });

    it('should record file creation with all attributes', async () => {
      await initializeMetrics(selected);
      recordFileOperationMetric(
        selected,
        FileOperation.CREATE,
        10,
        'text/plain',
        'txt',
      );

      expect(await points()).toHaveLength(2);
      expect(await points()).toContainEqual({
        value: 1,
        attributes: {
          'session.id': 'test-session-id',
        },
      });
      expect(await points()).toContainEqual({
        value: 1,
        attributes: {
          'session.id': 'test-session-id',
          operation: FileOperation.CREATE,
          lines: 10,
          mimetype: 'text/plain',
          extension: 'txt',
        },
      });
    });

    it('should record file read with minimal attributes', async () => {
      await initializeMetrics(selected);

      recordFileOperationMetric(selected, FileOperation.READ);
      expect(await points()).toContainEqual({
        value: 1,
        attributes: {
          'session.id': 'test-session-id',
          operation: FileOperation.READ,
        },
      });
    });

    it('should record file update with some attributes', async () => {
      await initializeMetrics(selected);

      recordFileOperationMetric(
        selected,
        FileOperation.UPDATE,
        undefined,
        'application/javascript',
      );
      expect(await points()).toContainEqual({
        value: 1,
        attributes: {
          'session.id': 'test-session-id',
          operation: FileOperation.UPDATE,
          mimetype: 'application/javascript',
        },
      });
    });

    it('should include diffStat when provided', async () => {
      await initializeMetrics(selected);

      const diffStat = {
        ai_added_lines: 5,
        ai_removed_lines: 2,
        user_added_lines: 3,
        user_removed_lines: 1,
      };

      recordFileOperationMetric(
        selected,
        FileOperation.UPDATE,
        undefined,
        undefined,
        undefined,
        diffStat,
      );

      expect(await points()).toContainEqual({
        value: 1,
        attributes: {
          'session.id': 'test-session-id',
          operation: FileOperation.UPDATE,
          ai_added_lines: 5,
          ai_removed_lines: 2,
          user_added_lines: 3,
          user_removed_lines: 1,
        },
      });
    });

    it('should not include diffStat attributes when diffStat is not provided', async () => {
      await initializeMetrics(selected);

      recordFileOperationMetric(
        selected,
        FileOperation.UPDATE,
        10,
        'text/plain',
        'txt',
        undefined,
      );

      expect(await points()).toContainEqual({
        value: 1,
        attributes: {
          'session.id': 'test-session-id',
          operation: FileOperation.UPDATE,
          lines: 10,
          mimetype: 'text/plain',
          extension: 'txt',
        },
      });
    });

    it('should handle diffStat with all zero values', async () => {
      await initializeMetrics(selected);

      const diffStat = {
        ai_added_lines: 0,
        ai_removed_lines: 0,
        user_added_lines: 0,
        user_removed_lines: 0,
      };

      recordFileOperationMetric(
        selected,
        FileOperation.UPDATE,
        undefined,
        undefined,
        undefined,
        diffStat,
      );

      expect(await points()).toContainEqual({
        value: 1,
        attributes: {
          'session.id': 'test-session-id',
          operation: FileOperation.UPDATE,
          ai_added_lines: 0,
          ai_removed_lines: 0,
          user_added_lines: 0,
          user_removed_lines: 0,
        },
      });
    });
  });
});
