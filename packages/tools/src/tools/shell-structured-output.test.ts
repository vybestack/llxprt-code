/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { ShellExecutionResult } from '../interfaces/IShellToolHost.js';
import { withShellStructuredOutput } from './shell-structured-output.js';
import type { ToolResult } from './tools.js';

function execution(
  overrides: Partial<ShellExecutionResult>,
): ShellExecutionResult {
  return {
    output: 'combined',
    exitCode: 0,
    signal: null,
    error: null,
    aborted: false,
    pid: 1,
    ...overrides,
  };
}

const modelResult: ToolResult = {
  llmContent: 'model text',
  returnDisplay: 'display',
};

describe('withShellStructuredOutput', () => {
  it('reports separate streams and the exit code from the execution, not the model text', () => {
    const result = withShellStructuredOutput(
      modelResult,
      execution({
        exitCode: 2,
        streams: { stdout: 'out\n', stderr: 'err\n' },
      }),
      {},
    );

    expect(result.llmContent).toBe('model text');
    expect(result.structuredOutput).toStrictEqual({
      stdout: 'out\n',
      stderr: 'err\n',
      exitCode: 2,
      streamsMerged: false,
    });
    expect(result.completeness).toBe('complete');
  });

  it('reports PTY output as merged stdout instead of claiming an empty stderr', () => {
    const result = withShellStructuredOutput(
      modelResult,
      execution({ output: 'both streams' }),
      {},
    );

    expect(result.structuredOutput).toStrictEqual({
      stdout: 'both streams',
      stderr: '',
      exitCode: 0,
      streamsMerged: true,
    });
  });

  it('is partial when acquisition truncated the output', () => {
    const result = withShellStructuredOutput(
      modelResult,
      execution({
        streams: { stdout: 'kept', stderr: '' },
        outputTruncation: {
          truncated: true,
        } as ShellExecutionResult['outputTruncation'],
      }),
      {},
    );

    expect(result.completeness).toBe('partial');
  });

  it('applies the requested output filters to each stream', () => {
    const result = withShellStructuredOutput(
      modelResult,
      execution({
        streams: { stdout: 'a\nb\nc', stderr: 'x\ny' },
      }),
      { head_lines: 1 },
    );

    expect(result.structuredOutput).toMatchObject({ stdout: 'a', stderr: 'x' });
  });
});
