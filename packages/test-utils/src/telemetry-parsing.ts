/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DiagnosticsSink } from './diagnostics.js';
import type { ParsedLog } from './types.js';

/**
 * Split the raw telemetry log content into individual JSON object strings.
 * Entries are separated by "}{" boundaries.
 */
export function splitTelemetryObjects(content: string): string[] {
  return content
    .split(/}\n{/)
    .map((obj, index, array) => {
      // Re-add the braces removed during split.
      let entry = obj;
      if (index > 0) {
        entry = '{' + entry;
      }
      if (index < array.length - 1) {
        entry = entry + '}';
      }
      return entry.trim();
    })
    .filter((obj) => obj.length > 0);
}

/**
 * Read and parse the telemetry.log file for a test directory.
 */
export function readAndParseTelemetryLog(
  testDir: string,
  diagnostics: DiagnosticsSink,
): ParsedLog[] {
  const logFilePath = join(testDir, 'telemetry.log');

  if (!existsSync(logFilePath)) {
    return [];
  }

  let content: string;
  try {
    content = readFileSync(logFilePath, 'utf-8');
  } catch {
    return [];
  }

  const jsonObjects = splitTelemetryObjects(content);
  const logs: ParsedLog[] = [];

  for (const jsonStr of jsonObjects) {
    try {
      const logData = JSON.parse(jsonStr) as ParsedLog;
      logs.push(logData);
    } catch (e) {
      diagnostics.error('Failed to parse telemetry object:', e);
    }
  }

  return logs;
}

/**
 * Extract tool-call entries from parsed telemetry logs.
 */
export function extractToolLogsFromTelemetry(
  parsedLogs: readonly ParsedLog[],
): Array<{
  toolRequest: {
    name: string;
    args: string;
    success: boolean;
    duration_ms: number;
  };
}> {
  const logs: Array<{
    toolRequest: {
      name: string;
      args: string;
      success: boolean;
      duration_ms: number;
    };
  }> = [];

  for (const logData of parsedLogs) {
    const attributes = logData.attributes;
    if (
      attributes !== undefined &&
      attributes['event.name'] === 'llxprt_code.tool_call'
    ) {
      const toolName = attributes.function_name ?? '<unknown>';
      logs.push({
        toolRequest: {
          name: toolName,
          args: attributes.function_args ?? '{}',
          success: attributes.success ?? false,
          duration_ms: attributes.duration_ms ?? 0,
        },
      });
    }
  }

  return logs;
}

/**
 * Extract API request entries from parsed telemetry logs.
 */
export function extractApiRequests(
  parsedLogs: readonly ParsedLog[],
): ParsedLog[] {
  return parsedLogs.filter(
    (logData) =>
      logData.attributes !== undefined &&
      logData.attributes['event.name'] === 'llxprt_code.api_request',
  );
}

/**
 * Search parsed logs for a metric with the given full name.
 */
export function findMetric(
  parsedLogs: readonly ParsedLog[],
  fullName: string,
): Record<string, unknown> | null {
  for (const logData of parsedLogs) {
    const found = findMetricInLog(logData, fullName);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/**
 * Search a single parsed log entry for a metric with the given name.
 */
function findMetricInLog(
  logData: ParsedLog,
  fullName: string,
): Record<string, unknown> | null {
  if (logData.scopeMetrics === undefined) {
    return null;
  }
  for (const scopeMetric of logData.scopeMetrics) {
    for (const metric of scopeMetric.metrics) {
      if (metric.descriptor.name === fullName) {
        return metric as unknown as Record<string, unknown>;
      }
    }
  }
  return null;
}
