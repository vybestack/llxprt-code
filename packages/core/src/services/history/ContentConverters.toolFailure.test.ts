/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Issue #3076 — a failed tool call must survive the Gemini-shaped
 * ContentConverters round trip. These behavioural proofs drive the real
 * converter static methods with plain data fixtures and assert only on
 * observable output, never on implementation internals.
 *
 * Note: identifiers deliberately avoid any provider-prefixed naming so this
 * file stays inside the repository's provider-neutral naming boundary.
 */

import { describe, it, expect } from 'bun:test';
import { ContentConverters } from './ContentConverters.js';
import type { IContent, ToolResponseBlock } from './IContent.js';

type ConvertedContent = ReturnType<typeof ContentConverters.toGeminiContent>;

function toolResponseContent(block: ToolResponseBlock): IContent {
  return { speaker: 'tool', blocks: [block] };
}

/** Read the single functionResponse part from a converted content object. */
function functionResponseOf(content: ConvertedContent): {
  name?: string;
  id?: string;
  response?: Record<string, unknown>;
} {
  const fr = content.parts?.[0]?.functionResponse;
  if (!fr) {
    throw new Error('expected a functionResponse part');
  }
  return fr;
}

/** Narrow a converted IContent to its single tool_response block. */
function singleToolResponse(content: IContent): ToolResponseBlock {
  const block = content.blocks[0];
  if (block.type !== 'tool_response') {
    throw new Error('expected a tool_response block');
  }
  return block;
}

function responseBlocksByToolName(blocks: readonly ToolResponseBlock[]): {
  readonly failed: ToolResponseBlock;
  readonly succeeded: ToolResponseBlock;
} {
  const failed = blocks.find((block) => block.toolName === 'failingTool');
  const succeeded = blocks.find((block) => block.toolName === 'okTool');
  if (!failed || !succeeded) {
    throw new Error('expected both a failed and a succeeded block');
  }
  return { failed, succeeded };
}

function responseBlocksByCallId(blocks: readonly ToolResponseBlock[]): {
  readonly failed: ToolResponseBlock;
  readonly succeeded: ToolResponseBlock;
} {
  const failed = blocks.find((block) => block.callId === 'hist_tool_fail5');
  const succeeded = blocks.find((block) => block.callId === 'hist_tool_ok4');
  if (!failed || !succeeded) {
    throw new Error('expected both a failed and a succeeded block');
  }
  return { failed, succeeded };
}

describe('ContentConverters tool-failure round trip (issue #3076)', () => {
  describe('toGeminiContent — outbound', () => {
    it('AC2.1 — a failed tool_response produces a functionResponse with status:error and the error string', () => {
      const converted = ContentConverters.toGeminiContent(
        toolResponseContent({
          type: 'tool_response',
          callId: 'hist_tool_fail1',
          toolName: 'failingTool',
          result: { output: 'partial data' },
          error: 'boom',
        }),
      );
      const fr = functionResponseOf(converted);
      expect(fr.response?.status).toBe('error');
      expect(fr.response?.error).toBe('boom');
    });

    it('AC2.2 — the failure envelope carries the original result verbatim under result', () => {
      const converted = ContentConverters.toGeminiContent(
        toolResponseContent({
          type: 'tool_response',
          callId: 'hist_tool_fail1',
          toolName: 'failingTool',
          result: { output: 'partial data', extra: 7 },
          error: 'boom',
        }),
      );
      const fr = functionResponseOf(converted);
      expect(fr.response?.result).toStrictEqual({
        output: 'partial data',
        extra: 7,
      });
    });

    it('AC2.3 — a successful tool_response is unchanged (raw result, no status, no error)', () => {
      const converted = ContentConverters.toGeminiContent(
        toolResponseContent({
          type: 'tool_response',
          callId: 'hist_tool_ok1',
          toolName: 'okTool',
          result: { found: true },
        }),
      );
      const fr = functionResponseOf(converted);
      expect(fr.response).toStrictEqual({ found: true });
      expect(fr.response).not.toHaveProperty('status');
      expect(fr.response).not.toHaveProperty('error');
    });
  });

  describe('toIContent — inbound', () => {
    it('AC2.4 — an error envelope reconstructs a block with error set and the original result', () => {
      const block = singleToolResponse(
        ContentConverters.toIContent(
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: 'failingTool',
                  id: 'hist_tool_fail1',
                  response: {
                    status: 'error',
                    error: 'boom',
                    result: { output: 'partial data' },
                  },
                },
                // The part-level discriminant (F2): the decoder only fires on
                // a part carrying the flag, so the hand-crafted shape must too.
                llxprtToolFailure: true,
              },
            ],
          },
          undefined,
          undefined,
          'turn-1',
        ),
      );
      expect(block.error).toBe('boom');
      expect(block.result).toStrictEqual({ output: 'partial data' });
    });

    it('AC2.5 — an ordinary functionResponse is unchanged (existing string/JSON coercion still applies)', () => {
      const objectBlock = singleToolResponse(
        ContentConverters.toIContent(
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: 'okTool',
                  id: 'hist_tool_ok1',
                  response: { output: 'all good' },
                },
              },
            ],
          },
          undefined,
          undefined,
          'turn-1',
        ),
      );
      expect(objectBlock.error).toBeUndefined();
      expect(objectBlock.result).toStrictEqual({ output: 'all good' });

      // A JSON-string response is still coerced via the existing path.
      const stringBlock = singleToolResponse(
        ContentConverters.toIContent(
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: 'okTool',
                  id: 'hist_tool_ok2',
                  response: '{"output":"parsed"}',
                },
              },
            ],
          },
          undefined,
          undefined,
          'turn-1',
        ),
      );
      expect(stringBlock.error).toBeUndefined();
      expect(stringBlock.result).toStrictEqual({ output: 'parsed' });
    });
  });

  describe('full round trip toGeminiContents -> toIContents', () => {
    it('AC2.6 — preserves failure marker, result, toolName and callId for a failure; preserves the absence of a marker for a success', () => {
      // hist_tool_ prefixed ids are canonical and therefore idempotent through
      // canonicalizeToolResponseId, so callId survives the round trip verbatim.
      const contents: IContent[] = [
        toolResponseContent({
          type: 'tool_response',
          callId: 'hist_tool_fail1',
          toolName: 'failingTool',
          result: { output: 'partial data' },
          error: 'boom',
        }),
        toolResponseContent({
          type: 'tool_response',
          callId: 'hist_tool_ok1',
          toolName: 'okTool',
          result: { found: true },
        }),
      ];

      const converted = ContentConverters.toGeminiContents(contents);
      const back = ContentConverters.toIContents(converted);
      const blocks = back.flatMap((c) => c.blocks) as ToolResponseBlock[];

      const { failed, succeeded } = responseBlocksByToolName(blocks);

      expect(failed.error).toBe('boom');
      expect(failed.result).toStrictEqual({ output: 'partial data' });
      expect(failed.callId).toBe('hist_tool_fail1');
      expect(failed.toolName).toBe('failingTool');
      expect(succeeded.error).toBeUndefined();
      expect(succeeded.result).toStrictEqual({ found: true });
      expect(succeeded.toolName).toBe('okTool');
    });

    it('AC2.7 — a failed block with result undefined round-trips: result coerces to {} and the marker survives', () => {
      // Full round trip through the encoder then decoder (not a hand-crafted
      // inbound shape) so the `result: undefined` -> key-omission branch is
      // actually driven: undefined is omitted outbound, then decoded to {}.
      const contents: IContent[] = [
        toolResponseContent({
          type: 'tool_response',
          callId: 'hist_tool_fail2',
          toolName: 'failingTool',
          result: undefined,
          error: 'no result at all',
        }),
      ];
      const converted = ContentConverters.toGeminiContents(contents);
      const back = ContentConverters.toIContents(converted);
      const block = singleToolResponse(back[0]);
      expect(block.error).toBe('no result at all');
      expect(block.result).toStrictEqual({});
      expect(block.callId).toBe('hist_tool_fail2');
    });

    it('AC2.8 — a failed block with result null round-trips: null is preserved verbatim and the marker survives', () => {
      // historyToolPairing/historyToolNormalization produce result:null on a
      // failed block. The encoder writes null through and the decoder returns
      // it verbatim (NOT coerced to {}).
      const contents: IContent[] = [
        toolResponseContent({
          type: 'tool_response',
          callId: 'hist_tool_fail3',
          toolName: 'failingTool',
          result: null,
          error: 'boom',
        }),
      ];
      const converted = ContentConverters.toGeminiContents(contents);
      const back = ContentConverters.toIContents(converted);
      const block = singleToolResponse(back[0]);
      expect(block.error).toBe('boom');
      expect(block.result).toBeNull();
      expect(block.callId).toBe('hist_tool_fail3');
    });

    it('AC2.9 — a SUCCESSFUL tool whose result is shaped like a failure envelope round-trips intact (F2 regression guard)', () => {
      // Without the part-level llxprtToolFailure discriminant this would be
      // misdecoded into a spurious failure with its payload destroyed, because
      // the inbound decoder used to fire on any { status:'error', error } shape.
      const original = {
        status: 'error',
        error: 'fake failure',
        payload: 'preserved data',
      };
      const contents: IContent[] = [
        toolResponseContent({
          type: 'tool_response',
          callId: 'hist_tool_ok3',
          toolName: 'okTool',
          result: original,
        }),
      ];
      const converted = ContentConverters.toGeminiContents(contents);
      const back = ContentConverters.toIContents(converted);
      const block = singleToolResponse(back[0]);
      expect(block.error).toBeUndefined();
      expect(block.result).toStrictEqual(original);
    });

    it('AC2.10 — a failed block with a non-object result round-trips the result verbatim', () => {
      const results: unknown[] = ['hello', [1, 2, 3]];
      for (const result of results) {
        const contents: IContent[] = [
          toolResponseContent({
            type: 'tool_response',
            callId: 'hist_tool_fail4',
            toolName: 'failingTool',
            result,
            error: 'boom',
          }),
        ];
        const converted = ContentConverters.toGeminiContents(contents);
        const back = ContentConverters.toIContents(converted);
        const block = singleToolResponse(back[0]);
        expect(block.error).toBe('boom');
        expect(block.result).toStrictEqual(result);
      }
    });

    it('AC2.11 — one IContent with multiple tool_response blocks round-trips each marker independently', () => {
      const contents: IContent[] = [
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_fail5',
              toolName: 'failingTool',
              result: { output: 'partial data' },
              error: 'boom',
            },
            {
              type: 'tool_response',
              callId: 'hist_tool_ok4',
              toolName: 'okTool',
              result: { found: true },
            },
          ],
        },
      ];
      const converted = ContentConverters.toGeminiContents(contents);
      const back = ContentConverters.toIContents(converted);
      const blocks = back.flatMap((c) => c.blocks) as ToolResponseBlock[];

      const { failed, succeeded } = responseBlocksByCallId(blocks);
      expect(failed.error).toBe('boom');
      expect(failed.result).toStrictEqual({ output: 'partial data' });
      expect(succeeded.error).toBeUndefined();
      expect(succeeded.result).toStrictEqual({ found: true });
    });
  });
});
