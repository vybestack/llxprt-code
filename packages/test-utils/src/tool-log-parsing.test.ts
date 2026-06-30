/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  extractHookLogs,
  parseToolLogsFromStdout,
} from './tool-log-parsing.js';
import type { ParsedLog } from './types.js';

describe('tool and hook log parsing helpers', () => {
  it('parses body-marker tool logs from CRLF stdout', () => {
    const stdout = [
      "function_name: 'write_file'",
      'function_args: \'{"path":"file.txt"}\'',
      "body: 'Tool call: write_file. Success: true. Duration: 17ms'",
    ].join('\r\n');

    const logs = parseToolLogsFromStdout(stdout);

    expect(logs).toHaveLength(1);
    expect(logs[0]?.toolRequest).toStrictEqual({
      name: 'write_file',
      args: '{"path":"file.txt"}',
      success: true,
      duration_ms: 17,
    });
  });

  it('parses fallback JSON tool logs while ignoring braces inside strings', () => {
    const stdout = JSON.stringify(
      {
        timestamp: 123,
        body: 'Tool call: read_file. Message with { braces } inside text',
        attributes: {
          function_args: '{"path":"file.txt"}',
          success: true,
          duration_ms: 5,
        },
      },
      null,
      2,
    );

    const logs = parseToolLogsFromStdout(stdout);

    expect(logs).toHaveLength(1);
    expect(logs[0]?.timestamp).toBe(123);
    expect(logs[0]?.toolRequest).toStrictEqual({
      name: 'read_file',
      args: '{"path":"file.txt"}',
      success: true,
      duration_ms: 5,
    });
  });

  it('extracts normalized hook-call logs from telemetry entries', () => {
    const parsedLogs: ParsedLog[] = [
      {
        attributes: {
          'event.name': 'llxprt_code.hook_call',
          hook_event_name: 'BeforeTool',
          hook_name: 'node hook.cjs',
          hook_input: { tool: 'write_file' },
          hook_output: { decision: 'allow' },
          exit_code: 0,
          stdout: 'hook output',
          stderr: '',
          duration_ms: 10,
          success: true,
          error: '',
        },
      },
    ];

    expect(extractHookLogs(parsedLogs)).toStrictEqual([
      {
        hookCall: {
          hook_event_name: 'BeforeTool',
          hook_name: 'node hook.cjs',
          hook_input: { tool: 'write_file' },
          hook_output: { decision: 'allow' },
          exit_code: 0,
          stdout: 'hook output',
          stderr: '',
          duration_ms: 10,
          success: true,
          error: '',
        },
      },
    ]);
  });
});
