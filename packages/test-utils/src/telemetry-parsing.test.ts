/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import type { DiagnosticsSink } from './diagnostics.js';
import {
  extractApiRequestArtifactTexts,
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
    expect(diagnostics.error).toHaveBeenCalledTimes(1);
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

describe('extractApiRequestArtifactTexts', () => {
  const body = Buffer.from('[{"speaker":"human","text":"protocol droid 雪"}]');

  function artifactLogs(
    parts: readonly Buffer[],
    overrides: { sha256?: string; bytes?: number } = {},
  ): ParsedLog[] {
    let offset = 0;
    const chunks = parts.map((part, index): ParsedLog => {
      const log: ParsedLog = {
        attributes: {
          'event.name': 'llxprt_code.api_request_chunk',
          artifact_id: 'artifact-1',
          chunk_index: index,
          chunk_byte_offset: offset,
          chunk_data: part.toString('base64'),
        },
      };
      offset += part.length;
      return log;
    });
    const complete: ParsedLog = {
      attributes: {
        'event.name': 'llxprt_code.api_request_complete',
        artifact_id: 'artifact-1',
        chunk_count: parts.length,
        content_bytes: overrides.bytes ?? body.length,
        content_sha256:
          overrides.sha256 ??
          createHash('sha256').update(Buffer.concat(parts)).digest('hex'),
        content_complete: true,
      },
    };
    return [...chunks, complete];
  }

  it('reassembles chunks split inside a multibyte character', () => {
    const split = body.indexOf(Buffer.from('雪')) + 1;
    const logs = artifactLogs([body.subarray(0, split), body.subarray(split)]);
    expect(extractApiRequestArtifactTexts(logs)).toStrictEqual([
      body.toString('utf-8'),
    ]);
  });

  it('ignores inline api_request markers without an artifact', () => {
    expect(
      extractApiRequestArtifactTexts([
        { attributes: { 'event.name': 'llxprt_code.api_request' } },
      ]),
    ).toStrictEqual([]);
  });

  it('throws when the recorded hash does not match the chunks', () => {
    expect(() =>
      extractApiRequestArtifactTexts(artifactLogs([body], { sha256: '0' })),
    ).toThrow('failed its sha256 check');
  });

  it('throws when a chunk is missing', () => {
    const logs = artifactLogs([body.subarray(0, 4), body.subarray(4)]);
    const withoutFirst = logs.filter(
      (log) => log.attributes?.chunk_index !== 0,
    );
    expect(() => extractApiRequestArtifactTexts(withoutFirst)).toThrow(
      'has 1 chunks, expected 2',
    );
  });

  it('throws when the artifact never completed', () => {
    const logs = artifactLogs([body]);
    const incomplete = logs.map((log) =>
      log.attributes?.['event.name'] === 'llxprt_code.api_request_complete'
        ? { attributes: { ...log.attributes, content_complete: false } }
        : log,
    );
    expect(() => extractApiRequestArtifactTexts(incomplete)).toThrow(
      'is not complete',
    );
  });
});
