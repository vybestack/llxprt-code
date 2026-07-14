/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for toModelStreamChunk AFC boundary extraction (P13).
 *
 * Verifies that `toModelStreamChunk` (the provider/core conversion boundary)
 * extracts `automaticFunctionCallingHistory` from provider metadata and
 * populates the first-class `ModelStreamChunk.afcHistory` field, AND strips
 * the raw AFC key from `providerMetadata` so agents never see it.
 *
 * Also verifies that `extractAfcHistory` and `stripAfcFromProviderMetadata`
 * work correctly as standalone boundary functions.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P13
 * @requirement:REQ-001.4
 */

import { describe, it, expect } from 'vitest';
import {
  toModelStreamChunk,
  extractAfcHistory,
  stripAfcFromProviderMetadata,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

describe('toModelStreamChunk — AFC boundary extraction', () => {
  it('populates afcHistory from well-formed provider metadata AFC', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'done' }],
      metadata: {
        stopReason: 'stop',
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
          ],
        },
      },
    };
    const chunk = toModelStreamChunk(content);
    expect(chunk.afcHistory).toBeDefined();
    expect(chunk.afcHistory).toHaveLength(2);
    expect(chunk.afcHistory?.[0].blocks[0]).toMatchObject({
      type: 'tool_call',
      name: 'read_file',
    });
  });

  it('strips automaticFunctionCallingHistory from providerMetadata', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'done' }],
      metadata: {
        stopReason: 'stop',
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
          ],
          otherKey: 'preserved',
        },
      },
    };
    const chunk = toModelStreamChunk(content);
    // AFC must NOT be in providerMetadata
    expect(
      chunk.providerMetadata?.['automaticFunctionCallingHistory'],
    ).toBeUndefined();
    // Other keys must be preserved
    expect(chunk.providerMetadata?.['otherKey']).toBe('preserved');
    // AFC must be in the first-class field
    expect(chunk.afcHistory).toBeDefined();
  });

  it('strips automaticFunctionCallingHistory from embedded content.metadata.providerMetadata', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'done' }],
      metadata: {
        stopReason: 'stop',
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
          ],
          otherKey: 'preserved',
        },
      },
    };
    const chunk = toModelStreamChunk(content);
    // AFC must NOT be in the embedded content metadata
    expect(
      chunk.content.metadata?.providerMetadata?.[
        'automaticFunctionCallingHistory'
      ],
    ).toBeUndefined();
    // Other keys in embedded content metadata must be preserved
    expect(chunk.content.metadata?.providerMetadata?.['otherKey']).toBe(
      'preserved',
    );
    // AFC must be in the first-class field
    expect(chunk.afcHistory).toBeDefined();
  });

  it('does not mutate the original IContent when stripping AFC', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'done' }],
      metadata: {
        stopReason: 'stop',
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
          ],
        },
      },
    };
    const snapshot = JSON.parse(JSON.stringify(content));
    toModelStreamChunk(content);
    // The original content must be unchanged
    expect(JSON.parse(JSON.stringify(content))).toStrictEqual(snapshot);
  });

  it('does not populate afcHistory when no AFC metadata exists', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'plain response' }],
      metadata: { stopReason: 'stop' },
    };
    const chunk = toModelStreamChunk(content);
    expect(chunk.afcHistory).toBeUndefined();
  });

  it('does not populate afcHistory when AFC is malformed (not an array)', () => {
    const content = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'bad' }],
      metadata: {
        stopReason: 'stop',
        providerMetadata: {
          automaticFunctionCallingHistory: 'not-an-array',
        },
      },
    } as unknown as IContent;
    const chunk = toModelStreamChunk(content);
    expect(chunk.afcHistory).toBeUndefined();
  });

  it('structurally preserves an orphaned tool call in afcHistory', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'orphan' }],
      metadata: {
        stopReason: 'stop',
        providerMetadata: {
          automaticFunctionCallingHistory: [
            {
              speaker: 'ai',
              blocks: [
                {
                  type: 'tool_call',
                  id: 'orphan',
                  name: 'read_file',
                  parameters: {},
                },
              ],
            },
          ],
        },
      },
    };
    const chunk = toModelStreamChunk(content);
    // Structural preservation (neutral contract): a well-formed entry
    // (valid speaker + non-empty blocks + valid tool_call block) survives
    // into the first-class afcHistory field even when its tool call has no
    // paired response. Call/response pairing is NOT enforced at this boundary.
    expect(chunk.afcHistory).toBeDefined();
    expect(chunk.afcHistory).toHaveLength(1);
    expect(chunk.afcHistory?.[0].blocks[0]).toMatchObject({
      type: 'tool_call',
      id: 'orphan',
      name: 'read_file',
    });
    // The raw provider wire key is still stripped from providerMetadata so
    // agents consume ONLY the neutral afcHistory field.
    expect(
      chunk.providerMetadata?.['automaticFunctionCallingHistory'],
    ).toBeUndefined();
  });

  it('preserves other metadata fields when extracting AFC', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'done' }],
      metadata: {
        stopReason: 'stop',
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
        providerMetadata: {
          automaticFunctionCallingHistory: [
            {
              speaker: 'ai',
              blocks: [
                {
                  type: 'tool_call',
                  id: 'c1',
                  name: 'search',
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
                  toolName: 'search',
                  result: 'ok',
                },
              ],
            },
          ],
        },
      },
    };
    const chunk = toModelStreamChunk(content);
    expect(chunk.afcHistory).toBeDefined();
    expect(chunk.usage).toStrictEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
    expect(chunk.finishReason).toBe('stop');
  });

  it.each([
    {
      name: 'tool call parameters',
      block: { type: 'tool_call', id: 'c1', name: 'search' },
    },
    {
      name: 'tool response result',
      block: {
        type: 'tool_response',
        callId: 'c1',
        toolName: 'search',
      },
    },
  ])('rejects AFC missing required $name', ({ block }) => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'done' }],
      metadata: {
        providerMetadata: {
          automaticFunctionCallingHistory: [{ speaker: 'ai', blocks: [block] }],
        },
      },
    };

    expect(extractAfcHistory(content)).toBeUndefined();
  });
});

describe('extractAfcHistory — standalone boundary function', () => {
  it('returns undefined when no provider metadata', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
    };
    expect(extractAfcHistory(content)).toBeUndefined();
  });

  it('returns undefined when AFC is missing', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: { providerMetadata: { other: 'data' } },
    };
    expect(extractAfcHistory(content)).toBeUndefined();
  });

  it('returns validated entries for well-formed AFC', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: {
        providerMetadata: {
          automaticFunctionCallingHistory: [
            { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] },
          ],
        },
      },
    };
    expect(extractAfcHistory(content)).toHaveLength(1);
  });
});

describe('stripAfcFromProviderMetadata — standalone boundary function', () => {
  it('returns undefined for undefined input', () => {
    expect(stripAfcFromProviderMetadata(undefined)).toBeUndefined();
  });

  it('removes AFC key when present', () => {
    const result = stripAfcFromProviderMetadata({
      automaticFunctionCallingHistory: [],
      other: 'kept',
    });
    expect(result).toStrictEqual({ other: 'kept' });
  });

  it('returns input unchanged when AFC key is absent', () => {
    const result = stripAfcFromProviderMetadata({ other: 'data' });
    expect(result).toStrictEqual({ other: 'data' });
  });
});
