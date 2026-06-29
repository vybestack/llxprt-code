/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticsSink } from './diagnostics.js';
import {
  extractApiRequests,
  extractToolLogsFromTelemetry,
  findMetric,
  readAndParseTelemetryLog,
  splitTelemetryObjects,
} from './telemetry-parsing.js';
import type { ParsedLog } from './types.js';

function createSilentDiagnostics(): DiagnosticsSink {
  return {
    verbose: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    dump: vi.fn(),
  };
}

describe('telemetry parsing helpers', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('splits adjacent telemetry JSON objects without dropping braces', () => {
    const objects = splitTelemetryObjects('{"a":1}\n{"b":2}\n');

    expect(objects).toStrictEqual(['{"a":1}', '{"b":2}']);
  });

  it('reads telemetry logs and reports malformed objects', () => {
    const testDir = mkdtempSync(join(tmpdir(), 'test-utils-telemetry-'));
    tempDirs.push(testDir);
    writeFileSync(
      join(testDir, 'telemetry.log'),
      '{"attributes":{"event.name":"llxprt_code.api_request"}}\n{bad json}\n',
    );
    const diagnostics = createSilentDiagnostics();

    const logs = readAndParseTelemetryLog(testDir, diagnostics);

    expect(logs).toHaveLength(1);
    expect(logs[0]?.attributes?.['event.name']).toBe('llxprt_code.api_request');
    expect(diagnostics.error).toHaveBeenCalledOnce();
  });

  it('extracts tool calls, API requests, and metrics from parsed telemetry', () => {
    const parsedLogs: ParsedLog[] = [
      {
        attributes: {
          'event.name': 'llxprt_code.tool_call',
          function_name: 'write_file',
          function_args: '{"path":"file.txt"}',
          success: true,
          duration_ms: 42,
        },
      },
      {
        attributes: {
          'event.name': 'llxprt_code.api_request',
          request_text: 'hello',
        },
      },
      {
        scopeMetrics: [
          {
            metrics: [
              {
                descriptor: { name: 'llxprt.requests' },
              },
            ],
          },
        ],
      },
    ];

    expect(extractToolLogsFromTelemetry(parsedLogs)).toStrictEqual([
      {
        toolRequest: {
          name: 'write_file',
          args: '{"path":"file.txt"}',
          success: true,
          duration_ms: 42,
        },
      },
    ]);
    expect(extractApiRequests(parsedLogs)).toHaveLength(1);
    expect(findMetric(parsedLogs, 'llxprt.requests')).toMatchObject({
      descriptor: { name: 'llxprt.requests' },
    });
  });
});
