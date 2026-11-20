/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DiagnosticsSink } from './diagnostics.js';
import type { ParsedLog, TelemetryAttributes } from './types.js';

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

const API_REQUEST_CHUNK_EVENT = 'llxprt_code.api_request_chunk';
const API_REQUEST_COMPLETE_EVENT = 'llxprt_code.api_request_complete';

function eventAttributes(
  parsedLogs: readonly ParsedLog[],
  eventName: string,
): TelemetryAttributes[] {
  const matches: TelemetryAttributes[] = [];
  for (const logData of parsedLogs) {
    const attributes = logData.attributes;
    if (attributes?.['event.name'] === eventName) matches.push(attributes);
  }
  return matches;
}

function requireField<T>(value: T | undefined, field: string, id: string): T {
  if (value === undefined) {
    throw new Error(`Request artifact ${id} is missing ${field}`);
  }
  return value;
}

function decodeArtifact(
  complete: TelemetryAttributes,
  chunks: readonly TelemetryAttributes[],
): string {
  const id = requireField(complete.artifact_id, 'artifact_id', 'unknown');
  const expectedCount = requireField(complete.chunk_count, 'chunk_count', id);
  const ordered = [...chunks].sort(
    (left, right) => (left.chunk_index ?? 0) - (right.chunk_index ?? 0),
  );
  if (ordered.length !== expectedCount) {
    throw new Error(
      `Request artifact ${id} has ${ordered.length} chunks, expected ${expectedCount}`,
    );
  }
  let offset = 0;
  const buffers = ordered.map((chunk, index) => {
    if (chunk.chunk_index !== index || chunk.chunk_byte_offset !== offset) {
      throw new Error(`Request artifact ${id} has a gap before chunk ${index}`);
    }
    const bytes = Buffer.from(
      requireField(chunk.chunk_data, 'chunk_data', id),
      'base64',
    );
    offset += bytes.length;
    return bytes;
  });
  const content = Buffer.concat(buffers);
  if (content.length !== complete.content_bytes) {
    throw new Error(
      `Request artifact ${id} has ${content.length} bytes, expected ${complete.content_bytes}`,
    );
  }
  const digest = createHash('sha256').update(content).digest('hex');
  if (digest !== complete.content_sha256) {
    throw new Error(`Request artifact ${id} failed its sha256 check`);
  }
  return content.toString('utf-8');
}

/**
 * Reassemble the request bodies exported as chunked artifacts. Each completed
 * artifact is verified against its recorded chunk count, byte length and
 * sha256; any mismatch throws so a truncated export cannot pass as evidence.
 * Results are in completion order.
 */
export function extractApiRequestArtifactTexts(
  parsedLogs: readonly ParsedLog[],
): string[] {
  const chunks = eventAttributes(parsedLogs, API_REQUEST_CHUNK_EVENT);
  return eventAttributes(parsedLogs, API_REQUEST_COMPLETE_EVENT).map(
    (complete) => {
      if (complete.content_complete !== true) {
        throw new Error(
          `Request artifact ${complete.artifact_id ?? 'unknown'} is not complete`,
        );
      }
      return decodeArtifact(
        complete,
        chunks.filter((chunk) => chunk.artifact_id === complete.artifact_id),
      );
    },
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
