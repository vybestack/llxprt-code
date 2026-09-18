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
 * Issue #3076 — a failed tool call must survive the inbound decode of the
 * Gemini-shaped failure envelope. These behavioural proofs drive the real
 * converter static methods with plain data fixtures and assert only on
 * observable output, never on implementation internals.
 *
 * The outbound encoder (toGeminiContent/toGeminiContents) was deleted with
 * the obsolete Gemini-request direction (#2628); the fixtures below
 * hand-craft the exact Gemini-shaped parts that encoder produced, so the
 * decoder-side guarantees keep their coverage unchanged.
 *
 * Note: identifiers deliberately avoid any provider-prefixed naming so this
 * file stays inside the repository's provider-neutral naming boundary.
 */

import { describe, it, expect } from 'bun:test';
import { ContentConverters } from './ContentConverters.js';
import type { IContent, ToolResponseBlock } from './IContent.js';

/**
 * Build the flagged functionResponse part the failure encoder produced.
 * The fixture is a plain structural literal (no GeminiContent import): the
 * parse direction accepts any structurally-compatible Content shape.
 */
function failurePart(
  callId: string,
  toolName: string,
  response: Record<string, unknown>,
) {
  return [
    {
      functionResponse: {
        name: toolName,
        id: callId,
        response,
      },
      llxprtToolFailure: true,
    },
  ];
}

/** Narrow an IContent to its single tool_response block. */
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

describe('ContentConverters tool-failure decode (issue #3076)', () => {
  describe('toIContent — inbound', () => {
    it('AC2.4 — an error envelope reconstructs a block with error set and the original result', () => {
      const block = singleToolResponse(
        ContentConverters.toIContent(
          {
            role: 'user',
            parts: failurePart('hist_tool_fail1', 'failingTool', {
              status: 'error',
              error: 'boom',
              result: { output: 'partial data' },
            }),
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

  describe('decode of the encoded envelope shapes (toIContents)', () => {
    it('AC2.6 — preserves failure marker, result, toolName and callId for a failure; preserves the absence of a marker for a success', () => {
      // hist_tool_ prefixed ids are canonical and therefore idempotent through
      // canonicalizeToolResponseId, so callId survives the decode verbatim.
      const stored = [
        {
          role: 'user',
          parts: failurePart('hist_tool_fail1', 'failingTool', {
            status: 'error',
            error: 'boom',
            result: { output: 'partial data' },
          }),
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'okTool',
                id: 'hist_tool_ok1',
                response: { found: true },
              },
            },
          ],
        },
      ];

      const back = ContentConverters.toIContents(stored);
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

    it('AC2.7 — an envelope with the result key omitted decodes: result coerces to {} and the marker survives', () => {
      // The encoder omitted an original `result` of `undefined` entirely;
      // the decoder must restore it as {} (not fabricate a different value).
      const stored = [
        {
          role: 'user',
          parts: failurePart('hist_tool_fail2', 'failingTool', {
            status: 'error',
            error: 'no result at all',
          }),
        },
      ];
      const back = ContentConverters.toIContents(stored);
      const block = singleToolResponse(back[0]);
      expect(block.error).toBe('no result at all');
      expect(block.result).toStrictEqual({});
      expect(block.callId).toBe('hist_tool_fail2');
    });

    it('AC2.8 — an envelope with result null decodes: null is preserved verbatim and the marker survives', () => {
      // historyToolPairing/historyToolNormalization produce result:null on a
      // failed block. The decoder returns it verbatim (NOT coerced to {}).
      const stored = [
        {
          role: 'user',
          parts: failurePart('hist_tool_fail3', 'failingTool', {
            status: 'error',
            error: 'boom',
            result: null,
          }),
        },
      ];
      const back = ContentConverters.toIContents(stored);
      const block = singleToolResponse(back[0]);
      expect(block.error).toBe('boom');
      expect(block.result).toBeNull();
      expect(block.callId).toBe('hist_tool_fail3');
    });

    it('AC2.9 — a SUCCESSFUL tool whose result is shaped like a failure envelope decodes intact (F2 regression guard)', () => {
      // Without the part-level llxprtToolFailure discriminant this would be
      // misdecoded into a spurious failure with its payload destroyed, because
      // the inbound decoder used to fire on any { status:'error', error } shape.
      const original = {
        status: 'error',
        error: 'fake failure',
        payload: 'preserved data',
      };
      const stored = [
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'okTool',
                id: 'hist_tool_ok3',
                response: original,
              },
            },
          ],
        },
      ];
      const back = ContentConverters.toIContents(stored);
      const block = singleToolResponse(back[0]);
      expect(block.error).toBeUndefined();
      expect(block.result).toStrictEqual(original);
    });

    it('AC2.10 — an envelope with a non-object result decodes the result verbatim', () => {
      const results: unknown[] = ['hello', [1, 2, 3]];
      for (const result of results) {
        const stored = [
          {
            role: 'user',
            parts: failurePart('hist_tool_fail4', 'failingTool', {
              status: 'error',
              error: 'boom',
              result,
            }),
          },
        ];
        const back = ContentConverters.toIContents(stored);
        const block = singleToolResponse(back[0]);
        expect(block.error).toBe('boom');
        expect(block.result).toStrictEqual(result);
      }
    });

    it('AC2.11 — one Content with multiple tool_response parts decodes each marker independently', () => {
      const stored = [
        {
          role: 'user',
          parts: [
            ...failurePart('hist_tool_fail5', 'failingTool', {
              status: 'error',
              error: 'boom',
              result: { output: 'partial data' },
            }),
            {
              functionResponse: {
                name: 'okTool',
                id: 'hist_tool_ok4',
                response: { found: true },
              },
            },
          ],
        },
      ];
      const back = ContentConverters.toIContents(stored);
      const blocks = back.flatMap((c) => c.blocks) as ToolResponseBlock[];

      const { failed, succeeded } = responseBlocksByCallId(blocks);
      expect(failed.error).toBe('boom');
      expect(failed.result).toStrictEqual({ output: 'partial data' });
      expect(succeeded.error).toBeUndefined();
      expect(succeeded.result).toStrictEqual({ found: true });
    });
  });
});
