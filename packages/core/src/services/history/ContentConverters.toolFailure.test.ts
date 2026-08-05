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
      expect(fr.response?.result).toEqual({ output: 'partial data', extra: 7 });
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
      expect(fr.response).toEqual({ found: true });
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
              },
            ],
          },
          undefined,
          undefined,
          'turn-1',
        ),
      );
      expect(block.error).toBe('boom');
      expect(block.result).toEqual({ output: 'partial data' });
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
      expect(objectBlock.result).toEqual({ output: 'all good' });

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
      expect(stringBlock.result).toEqual({ output: 'parsed' });
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

      const failed = blocks.find((b) => b.toolName === 'failingTool');
      const succeeded = blocks.find((b) => b.toolName === 'okTool');
      if (!failed || !succeeded) {
        throw new Error('expected both a failed and a succeeded block');
      }

      expect(failed.error).toBe('boom');
      expect(failed.result).toEqual({ output: 'partial data' });
      expect(failed.callId).toBe('hist_tool_fail1');
      expect(succeeded.error).toBeUndefined();
      expect(succeeded.result).toEqual({ found: true });
    });

    it('AC2.7 — an error envelope whose original result was undefined decodes to {} and still carries the failure marker', () => {
      const block = singleToolResponse(
        ContentConverters.toIContent(
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: 'failingTool',
                  id: 'hist_tool_fail2',
                  response: {
                    status: 'error',
                    error: 'no result at all',
                  },
                },
              },
            ],
          },
          undefined,
          undefined,
          'turn-1',
        ),
      );
      expect(block.error).toBe('no result at all');
      expect(block.result).toEqual({});
    });
  });
});
