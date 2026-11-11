/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SubagentTerminateMode } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { ToolCallBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { convertToFunctionResponse } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
import { describe, expect, it } from 'bun:test';
import {
  processFunctionCalls,
  type ProcessFunctionCallsContext,
} from './subagentToolProcessing.js';

describe('processFunctionCalls image batch admission (issue 3984)', () => {
  function imageContext(
    budgetBytes: number,
    encodedLengths: Readonly<Record<string, number>>,
  ): ProcessFunctionCallsContext {
    return {
      output: {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.ERROR,
      },
      subagentId: 'image-agent',
      logger: new DebugLogger('issue3984-test'),
      imagePayloadBudgetBytes: budgetBytes,
      // The tool executor is the only substituted boundary; it returns the
      // response shape the scheduler produces via convertToFunctionResponse.
      executeToolCall: async (request) => ({
        status: 'success',
        response: {
          callId: request.callId,
          responseParts: convertToFunctionResponse(
            request.name,
            request.callId,
            [
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: 'A'.repeat(encodedLengths[request.callId] ?? 0),
                },
              },
            ],
          ),
          resultDisplay: undefined,
          error: undefined,
          errorType: undefined,
        },
      }),
    };
  }

  function readFile(id: string): ToolCallBlock {
    return { type: 'tool_call', id, name: 'read_file', parameters: {} };
  }

  async function run(
    ctx: ProcessFunctionCallsContext,
    ids: readonly string[],
  ): Promise<Awaited<ReturnType<typeof processFunctionCalls>>> {
    return processFunctionCalls(
      ids.map(readFile),
      new AbortController(),
      'prompt-3984',
      ctx,
    );
  }

  it('answers every call and advises fewer images when the batch overflows', async () => {
    const ctx = imageContext(6000, { a: 4000, b: 4000, c: 4000 });

    const content = await run(ctx, ['a', 'b', 'c']);

    const blocks = content.flatMap((c) => c.blocks);
    const answered = blocks.flatMap((b) =>
      b.type === 'tool_response' ? [b.callId] : [],
    );
    expect(answered).toStrictEqual(['a', 'b', 'c']);
    expect(blocks.filter((b) => b.type === 'media')).toHaveLength(1);
    const feedback = blocks
      .flatMap((b) => (b.type === 'text' ? [b.text] : []))
      .join('\n')
      .toLowerCase();
    expect(feedback).toContain('6000');
    expect(feedback).toContain('fewer');
    expect(feedback).toContain('call b');
    expect(feedback).toContain('call c');
  });

  it('says an image larger than the whole budget cannot fit alone', async () => {
    const ctx = imageContext(6000, { huge: 9000 });

    const content = await run(ctx, ['huge']);

    const feedback = content
      .flatMap((c) => c.blocks)
      .flatMap((b) => (b.type === 'text' ? [b.text] : []))
      .join('\n')
      .toLowerCase();
    expect(feedback).toContain('call huge');
    expect(feedback).toContain('cannot fit alone');
    expect(feedback).not.toContain('fewer');
  });
});
