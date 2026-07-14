/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for shared AFC history structural validation —
 * structural-preservation slice.
 *
 * Sibling to afcHistoryValidation.test.ts (split to stay under the
 * file-level max-lines limit without any per-file disable). This file
 * covers the "structural preservation regardless of ordering, uniqueness,
 * and names" contract: structurally valid entries are preserved verbatim
 * even when calls/responses are orphaned, out of order, duplicated, or
 * name-mismatched. Cross-entry pairing/ordering/uniqueness/name matching
 * is NOT enforced at this boundary.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P11
 * @requirement:REQ-003.2
 */

import { describe, it, expect } from 'vitest';
import { extractAfcHistory } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

describe('extractAfcHistory — structural preservation regardless of ordering, uniqueness, and names', () => {
  it('preserves response-before-call ordering verbatim (ordering not enforced)', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: {
        providerMetadata: {
          automaticFunctionCallingHistory: [
            {
              speaker: 'tool',
              blocks: [
                {
                  type: 'tool_response',
                  callId: 'c1',
                  toolName: 'read_file',
                  result: 'ok',
                },
              ],
            },
            {
              speaker: 'ai',
              blocks: [
                {
                  type: 'tool_call',
                  id: 'c1',
                  name: 'read_file',
                  parameters: {},
                },
              ],
            },
          ],
        },
      },
    };
    // Structural-only contract: entry order is preserved as-is even when the
    // response precedes the call.
    const result = extractAfcHistory(content);
    expect(result).toHaveLength(2);
    expect(result?.[0].blocks[0]).toMatchObject({ type: 'tool_response' });
    expect(result?.[1].blocks[0]).toMatchObject({ type: 'tool_call' });
  });

  it('preserves duplicate tool_call IDs (uniqueness not enforced)', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: {
        providerMetadata: {
          automaticFunctionCallingHistory: [
            {
              speaker: 'ai',
              blocks: [
                {
                  type: 'tool_call',
                  id: 'dup',
                  name: 'read_file',
                  parameters: {},
                },
              ],
            },
            {
              speaker: 'ai',
              blocks: [
                {
                  type: 'tool_call',
                  id: 'dup',
                  name: 'read_file',
                  parameters: {},
                },
              ],
            },
            {
              speaker: 'tool',
              blocks: [
                {
                  type: 'tool_response',
                  callId: 'dup',
                  toolName: 'read_file',
                  result: 'ok',
                },
              ],
            },
          ],
        },
      },
    };
    // Structural-only contract: duplicate IDs are preserved verbatim.
    const result = extractAfcHistory(content);
    expect(result).toHaveLength(3);
    expect(result?.[0].blocks[0]).toMatchObject({ id: 'dup' });
    expect(result?.[1].blocks[0]).toMatchObject({ id: 'dup' });
  });

  it('preserves duplicate tool_response callIds (uniqueness not enforced)', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: {
        providerMetadata: {
          automaticFunctionCallingHistory: [
            {
              speaker: 'ai',
              blocks: [
                {
                  type: 'tool_call',
                  id: 'c1',
                  name: 'read_file',
                  parameters: {},
                },
              ],
            },
            {
              speaker: 'tool',
              blocks: [
                {
                  type: 'tool_response',
                  callId: 'c1',
                  toolName: 'read_file',
                  result: 'ok',
                },
              ],
            },
            {
              speaker: 'tool',
              blocks: [
                {
                  type: 'tool_response',
                  callId: 'c1',
                  toolName: 'read_file',
                  result: 'dup',
                },
              ],
            },
          ],
        },
      },
    };
    // Structural-only contract: duplicate callIds are preserved verbatim.
    const result = extractAfcHistory(content);
    expect(result).toHaveLength(3);
    expect(result?.[1].blocks[0]).toMatchObject({ callId: 'c1', result: 'ok' });
    expect(result?.[2].blocks[0]).toMatchObject({
      callId: 'c1',
      result: 'dup',
    });
  });

  it('preserves a name mismatch between paired tool_call and tool_response (name match not enforced)', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: {
        providerMetadata: {
          automaticFunctionCallingHistory: [
            {
              speaker: 'ai',
              blocks: [
                {
                  type: 'tool_call',
                  id: 'c1',
                  name: 'read_file',
                  parameters: {},
                },
              ],
            },
            {
              speaker: 'tool',
              blocks: [
                {
                  type: 'tool_response',
                  callId: 'c1',
                  toolName: 'write_file',
                  result: 'ok',
                },
              ],
            },
          ],
        },
      },
    };
    // Structural-only contract: the call name and response toolName may
    // differ; both entries are preserved verbatim.
    const result = extractAfcHistory(content);
    expect(result).toHaveLength(2);
    expect(result?.[0].blocks[0]).toMatchObject({ name: 'read_file' });
    expect(result?.[1].blocks[0]).toMatchObject({ toolName: 'write_file' });
  });

  it('preserves an orphan tool_response with no matching call (pairing not enforced)', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: {
        providerMetadata: {
          automaticFunctionCallingHistory: [
            {
              speaker: 'tool',
              blocks: [
                {
                  type: 'tool_response',
                  callId: 'orphan-resp',
                  toolName: 'read_file',
                  result: 'ok',
                },
              ],
            },
          ],
        },
      },
    };
    // Structural-only contract: a well-formed orphan tool_response is kept.
    const result = extractAfcHistory(content);
    expect(result).toHaveLength(1);
    expect(result?.[0].blocks[0]).toMatchObject({
      type: 'tool_response',
      callId: 'orphan-resp',
    });
  });

  it('accepts multiple correctly paired calls/responses with unique IDs and matching names', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: {
        providerMetadata: {
          automaticFunctionCallingHistory: [
            {
              speaker: 'ai',
              blocks: [
                {
                  type: 'tool_call',
                  id: 'c1',
                  name: 'read_file',
                  parameters: {},
                },
              ],
            },
            {
              speaker: 'tool',
              blocks: [
                {
                  type: 'tool_response',
                  callId: 'c1',
                  toolName: 'read_file',
                  result: 'ok1',
                },
              ],
            },
            {
              speaker: 'ai',
              blocks: [
                {
                  type: 'tool_call',
                  id: 'c2',
                  name: 'write_file',
                  parameters: {},
                },
              ],
            },
            {
              speaker: 'tool',
              blocks: [
                {
                  type: 'tool_response',
                  callId: 'c2',
                  toolName: 'write_file',
                  result: 'ok2',
                },
              ],
            },
          ],
        },
      },
    };
    expect(extractAfcHistory(content)).toHaveLength(4);
  });

  it('accepts interleaved calls and responses (call before response for each pair)', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: {
        providerMetadata: {
          automaticFunctionCallingHistory: [
            {
              speaker: 'ai',
              blocks: [
                {
                  type: 'tool_call',
                  id: 'c1',
                  name: 'read',
                  parameters: {},
                },
              ],
            },
            {
              speaker: 'ai',
              blocks: [
                {
                  type: 'tool_call',
                  id: 'c2',
                  name: 'write',
                  parameters: {},
                },
              ],
            },
            {
              speaker: 'tool',
              blocks: [
                {
                  type: 'tool_response',
                  callId: 'c1',
                  toolName: 'read',
                  result: 'r1',
                },
              ],
            },
            {
              speaker: 'tool',
              blocks: [
                {
                  type: 'tool_response',
                  callId: 'c2',
                  toolName: 'write',
                  result: 'r2',
                },
              ],
            },
          ],
        },
      },
    };
    expect(extractAfcHistory(content)).toHaveLength(4);
  });
});
