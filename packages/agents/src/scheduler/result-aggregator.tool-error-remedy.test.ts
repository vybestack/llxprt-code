/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3037 — end-to-end evidence (T3) that a real tool's remedial
 * llmContent survives the ResultAggregator boundary and reaches the model.
 *
 * The test drives a real InsertAtLineTool over a real temp directory to
 * produce a genuine ToolResult (no hand-rolled strings), then feeds that
 * result through a real ResultAggregator and asserts the ToolCallResponseInfo
 * handed to setError carries the remedy.
 */

import { describe, it, expect } from '../testApi.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ResultAggregator } from './result-aggregator.js';
import type { ResultPublishCallbacks } from './result-aggregator.js';
import type { ScheduledToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import type { ToolCallResponseInfo } from '../core/turn.js';
import {
  InsertAtLineTool,
  type IToolHost,
  type ToolResult,
} from '@vybestack/llxprt-code-tools';
import { DEFAULT_MAX_TOKENS } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import type { ToolOutputSettingsProvider } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/**
 * Narrows a tool_response ContentBlock and reads its `result.error` string
 * via real type guards (not a cast), failing the test with a clear message if
 * the block shape does not match expectations.
 */
function toolResponseErrorText(block: ContentBlock): string {
  if (block.type !== 'tool_response') {
    throw new Error(
      `expected a tool_response block but got ${String(block.type)}`,
    );
  }
  const result = block.result;
  if (typeof result !== 'object' || result === null || !('error' in result)) {
    throw new Error(
      'tool_response block result is not an object with an error property',
    );
  }
  if (typeof result.error !== 'string') {
    throw new Error('tool_response block result.error is not a string');
  }
  return result.error;
}

/**
 * Minimal structural IToolHost over a temp directory, mirroring
 * `_createFakeFileHost` in packages/tools/src/__tests__/filesystem-tools.test.ts
 * but trimmed to the surface the InsertAtLineTool path touches.
 */
function createFakeFileHost(targetDir: string): IToolHost {
  return {
    getTargetDir: () => targetDir,
    getWorkspaceRoots: () => [targetDir],
    getApprovalMode: () => 'auto',
    setApprovalMode: () => {},
    isInteractive: () => false,
    hasFeatureFlag: () => false,
    getFileService: () => ({
      shouldGitIgnoreFile: () => false,
      shouldLlxprtIgnoreFile: () => false,
      shouldIgnoreFile: () => false,
      filterFiles: (paths) => paths,
    }),
    getFileFilteringOptions: () => ({
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    }),
    getFileExclusions: () => [],
    getReadManyFilesExclusions: () => [],
    getFileFilteringRespectLlxprtIgnore: () => true,
    getLlxprtIgnoreFilePath: () => null,
    recordFileRead: () => {},
    getLlxprtIgnorePatterns: () => [],
    getEphemeralSettings: () => ({
      'tool-output-max-tokens': DEFAULT_MAX_TOKENS,
    }),
    getDebugMode: () => false,
  };
}

function makeScheduledCall(callId: string, name: string): ScheduledToolCall {
  return {
    status: 'scheduled',
    request: { callId, name, args: {} },
    // tool/invocation are required by ScheduledToolCall but never touched by
    // this test, so placeholder casts match the convention in
    // result-aggregator.test.ts makeScheduledCall.
    tool: {} as ScheduledToolCall['tool'],
    invocation: {} as ScheduledToolCall['invocation'],
  };
}

function makeCallbacks(): {
  callbacks: ResultPublishCallbacks;
  lastError: () => ToolCallResponseInfo | undefined;
} {
  let captured: ToolCallResponseInfo | undefined;
  const callbacks: ResultPublishCallbacks = {
    setSuccess: () => {},
    setError: (_callId: string, response: ToolCallResponseInfo) => {
      captured = response;
    },
    getFallbackOutputConfig: () =>
      ({
        getEphemeralSettings: () => ({
          'tool-output-max-tokens': DEFAULT_MAX_TOKENS,
        }),
      }) satisfies ToolOutputSettingsProvider,
  };
  return { callbacks, lastError: () => captured };
}

describe('ResultAggregator — real tool error remedy (issue #3037, AC6)', () => {
  it('delivers the real InsertAtLineTool out-of-range remedy to the model', async () => {
    const tempDir = join(
      tmpdir(),
      `llxprt-3037-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });
    try {
      // 8-line file (no trailing newline → exactly 8 lines on split).
      const targetPath = join(tempDir, 'target.txt');
      writeFileSync(targetPath, '1\n2\n3\n4\n5\n6\n7\n8');

      const tool = new InsertAtLineTool(createFakeFileHost(tempDir));
      const realResult: ToolResult = await tool.execute(
        {
          absolute_path: targetPath,
          line_number: 999,
          content: 'new line',
        },
        new AbortController().signal,
      );

      // Sanity: the real tool produced the expected remedial llmContent.
      expect(realResult.error).toBeDefined();
      expect(realResult.llmContent).toContain(
        'Use line_number <= 9 to append.',
      );
      expect(realResult.error?.message).toBe(
        'line_number 999 exceeds file length (8)',
      );

      const { callbacks, lastError } = makeCallbacks();
      const agg = new ResultAggregator(callbacks);
      const call = makeScheduledCall('call-real', 'insert_at_line');
      agg.beginBatch(1);
      agg.bufferResult('call-real', 'insert_at_line', call, realResult, 0);

      await agg.publishBufferedResults(new AbortController().signal);

      const response = lastError();
      expect(response).toBeDefined();
      expect(toolResponseErrorText(response!.responseParts[0])).toContain(
        'Use line_number <= 9 to append.',
      );
      expect(response!.error?.message).toBe(
        'line_number 999 exceeds file length (8)',
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
