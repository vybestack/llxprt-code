/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for shared AFC history structural validation.
 * Verifies that extractAfcHistory rejects malformed/legacy entries
 * while accepting well-formed IContent[] from provider metadata.
 *
 * Also covers the enhanced validator: full speaker narrowing and all
 * ContentBlock variant validation.
 *
 * Neutral contract (structural-only): validation is per-entry structural —
 * a valid speaker, a non-empty blocks array, and well-formed block shapes.
 * Cross-entry tool call/response pairing, ordering, ID uniqueness, and
 * name matching are NOT enforced at this boundary. Structurally valid
 * entries are preserved verbatim even when calls/responses are orphaned,
 * out of order, duplicated, or name-mismatched.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P11
 * @requirement:REQ-003.2
 */

import { describe, it, expect } from 'vitest';
import { extractAfcHistory } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { filterAfcByHookRestrictions } from '../hookToolRestrictions.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

describe('extractAfcHistory — structural validation', () => {
  it('returns undefined when no AFC history metadata exists', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
    };
    expect(extractAfcHistory(content)).toBeUndefined();
  });

  it('returns validated IContent[] for well-formed AFC entries', () => {
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
          ],
        },
      },
    };
    const result = extractAfcHistory(content);
    expect(result).toBeDefined();
    expect(result).toHaveLength(2);
  });

  it('rejects ENTIRE payload when any entry lacks a blocks array (fail-closed)', () => {
    const content = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: {
        providerMetadata: {
          automaticFunctionCallingHistory: [
            { role: 'model', parts: [{ text: 'legacy' }] },
            null,
            'string-entry',
            { speaker: 'ai', blocks: [{ type: 'text', text: 'valid' }] },
          ],
        },
      },
    } as unknown as IContent;
    // Fail-closed: any invalid entry rejects the whole payload, never partial.
    expect(extractAfcHistory(content)).toBeUndefined();
  });

  it('returns undefined when ALL entries are malformed', () => {
    const content = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: {
        providerMetadata: {
          automaticFunctionCallingHistory: [
            { role: 'model', parts: [] },
            null,
            42,
          ],
        },
      },
    } as unknown as IContent;
    expect(extractAfcHistory(content)).toBeUndefined();
  });

  it('returns undefined when AFC metadata is not an array', () => {
    const content = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: {
        providerMetadata: {
          automaticFunctionCallingHistory: 'not-an-array',
        },
      },
    } as unknown as IContent;
    expect(extractAfcHistory(content)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Enhanced validator — speaker narrowing, block validation, pairing
// ---------------------------------------------------------------------------

describe('extractAfcHistory — speaker and block narrowing', () => {
  it('rejects ENTIRE payload when any entry has invalid speaker (fail-closed)', () => {
    const content = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: {
        providerMetadata: {
          automaticFunctionCallingHistory: [
            { speaker: 'model', blocks: [{ type: 'text', text: 'x' }] },
            { speaker: 'function', blocks: [{ type: 'text', text: 'y' }] },
            { speaker: 'human', blocks: [{ type: 'text', text: 'ok' }] },
          ],
        },
      },
    } as unknown as IContent;
    // Fail-closed: any invalid speaker rejects the whole payload.
    expect(extractAfcHistory(content)).toBeUndefined();
  });

  it('rejects ENTIRE payload when any entry has missing speaker (fail-closed)', () => {
    const content = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: {
        providerMetadata: {
          automaticFunctionCallingHistory: [
            { blocks: [{ type: 'text', text: 'no-speaker' }] },
            { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] },
          ],
        },
      },
    } as unknown as IContent;
    // Fail-closed: any entry missing speaker rejects the whole payload.
    expect(extractAfcHistory(content)).toBeUndefined();
  });

  it('rejects ENTIRE payload when any entry has empty blocks array (fail-closed)', () => {
    const content = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: {
        providerMetadata: {
          automaticFunctionCallingHistory: [
            { speaker: 'ai', blocks: [] },
            { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] },
          ],
        },
      },
    } as unknown as IContent;
    // Fail-closed: any entry with empty blocks rejects the whole payload.
    expect(extractAfcHistory(content)).toBeUndefined();
  });

  it('rejects ENTIRE payload when any entry has invalid block shapes (fail-closed)', () => {
    const content = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: {
        providerMetadata: {
          automaticFunctionCallingHistory: [
            {
              speaker: 'ai',
              blocks: [{ type: 'unknown_type', text: 'bad' }],
            },
            {
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'good' }, { notABlock: true }],
            },
            {
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'fully-valid' }],
            },
          ],
        },
      },
    } as unknown as IContent;
    // Fail-closed: any entry with an invalid block rejects the whole payload.
    expect(extractAfcHistory(content)).toBeUndefined();
  });

  it('rejects tool_call block missing required id field', () => {
    const content = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: {
        providerMetadata: {
          automaticFunctionCallingHistory: [
            {
              speaker: 'ai',
              blocks: [{ type: 'tool_call', name: 'read', parameters: {} }],
            },
          ],
        },
      },
    } as unknown as IContent;
    expect(extractAfcHistory(content)).toBeUndefined();
  });

  it('rejects tool_call block missing required name field', () => {
    const content = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: {
        providerMetadata: {
          automaticFunctionCallingHistory: [
            {
              speaker: 'ai',
              blocks: [{ type: 'tool_call', id: 'c1', parameters: {} }],
            },
          ],
        },
      },
    } as unknown as IContent;
    expect(extractAfcHistory(content)).toBeUndefined();
  });

  it('rejects tool_response block missing required callId field', () => {
    const content = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: {
        providerMetadata: {
          automaticFunctionCallingHistory: [
            {
              speaker: 'tool',
              blocks: [
                { type: 'tool_response', toolName: 'read', result: 'ok' },
              ],
            },
          ],
        },
      },
    } as unknown as IContent;
    expect(extractAfcHistory(content)).toBeUndefined();
  });

  it('rejects tool_response block missing required toolName field', () => {
    const content = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: {
        providerMetadata: {
          automaticFunctionCallingHistory: [
            {
              speaker: 'tool',
              blocks: [{ type: 'tool_response', callId: 'c1', result: 'ok' }],
            },
          ],
        },
      },
    } as unknown as IContent;
    expect(extractAfcHistory(content)).toBeUndefined();
  });
});

describe('extractAfcHistory — tool call/response pairing', () => {
  it('accepts well-formed paired tool call and response', () => {
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
                  id: 'call-1',
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
                  callId: 'call-1',
                  toolName: 'read_file',
                  result: 'ok',
                },
              ],
            },
          ],
        },
      },
    };
    expect(extractAfcHistory(content)).toHaveLength(2);
  });

  it('preserves a tool_call entry with no matching tool_response (pairing not enforced)', () => {
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
                  id: 'orphan-call',
                  name: 'read_file',
                  parameters: {},
                },
              ],
            },
          ],
        },
      },
    };
    // Structural-only contract: a well-formed tool_call entry is preserved
    // verbatim even without a paired tool_response.
    const result = extractAfcHistory(content);
    expect(result).toHaveLength(1);
    expect(result?.[0].blocks[0]).toMatchObject({
      type: 'tool_call',
      id: 'orphan-call',
      name: 'read_file',
    });
  });

  it('preserves a tool_response entry with no matching tool_call (pairing not enforced)', () => {
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
                  callId: 'orphan-response',
                  toolName: 'read_file',
                  result: 'ok',
                },
              ],
            },
          ],
        },
      },
    };
    // Structural-only contract: a well-formed tool_response entry is
    // preserved verbatim even without a paired tool_call.
    const result = extractAfcHistory(content);
    expect(result).toHaveLength(1);
    expect(result?.[0].blocks[0]).toMatchObject({
      type: 'tool_response',
      callId: 'orphan-response',
      toolName: 'read_file',
    });
  });

  it('preserves entries whose tool_call id and tool_response callId do not match (pairing not enforced)', () => {
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
                  id: 'call-A',
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
                  callId: 'call-B',
                  toolName: 'read_file',
                  result: 'ok',
                },
              ],
            },
          ],
        },
      },
    };
    // Structural-only contract: both entries are well-formed, so both are
    // preserved even though the call id and response callId do not match.
    const result = extractAfcHistory(content);
    expect(result).toHaveLength(2);
    expect(result?.[0].blocks[0]).toMatchObject({
      type: 'tool_call',
      id: 'call-A',
    });
    expect(result?.[1].blocks[0]).toMatchObject({
      type: 'tool_response',
      callId: 'call-B',
    });
  });

  it('accepts text-only entries alongside paired tool entries', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: {
        providerMetadata: {
          automaticFunctionCallingHistory: [
            { speaker: 'ai', blocks: [{ type: 'text', text: 'calling...' }] },
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
                  result: 'found',
                },
              ],
            },
          ],
        },
      },
    };
    expect(extractAfcHistory(content)).toHaveLength(3);
  });
});

describe('extractAfcHistory — never crashes on restrictions', () => {
  it('handles null metadata gracefully', () => {
    const content = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: null,
    } as unknown as IContent;
    expect(extractAfcHistory(content)).toBeUndefined();
  });

  it('handles null providerMetadata gracefully', () => {
    const content = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: { providerMetadata: null },
    } as unknown as IContent;
    expect(extractAfcHistory(content)).toBeUndefined();
  });

  it('handles entries with null blocks', () => {
    const content = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: {
        providerMetadata: {
          automaticFunctionCallingHistory: [{ speaker: 'ai', blocks: null }],
        },
      },
    } as unknown as IContent;
    expect(extractAfcHistory(content)).toBeUndefined();
  });

  it('handles null entries in the array', () => {
    const content = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: {
        providerMetadata: {
          automaticFunctionCallingHistory: [null, undefined, 42, 'bad'],
        },
      },
    } as unknown as IContent;
    expect(extractAfcHistory(content)).toBeUndefined();
  });

  it('handles non-object entries', () => {
    const content = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hi' }],
      metadata: {
        providerMetadata: {
          automaticFunctionCallingHistory: [123, 'string', true],
        },
      },
    } as unknown as IContent;
    expect(extractAfcHistory(content)).toBeUndefined();
  });
});

describe('filterAfcByHookRestrictions — operates on validated AFC', () => {
  it('filters out disallowed tool calls from AFC entries', () => {
    const afc: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          { type: 'tool_call', id: 'c1', name: 'allowed_tool', parameters: {} },
          { type: 'tool_call', id: 'c2', name: 'blocked_tool', parameters: {} },
        ],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'result' }],
      },
    ];
    const result = filterAfcByHookRestrictions(afc, ['allowed_tool']);
    expect(result).toHaveLength(2);
    expect(result[0].blocks).toHaveLength(1);
    expect(result[0].blocks[0]).toMatchObject({ name: 'allowed_tool' });
  });

  it('passes through all entries when allowedTools is undefined', () => {
    const afc: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          { type: 'tool_call', id: 'c1', name: 'any_tool', parameters: {} },
        ],
      },
    ];
    const result = filterAfcByHookRestrictions(afc, undefined);
    expect(result).toHaveLength(1);
    expect(result[0].blocks).toHaveLength(1);
  });
});
