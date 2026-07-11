/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Defensive-mapping tests for mapHistoryToSessionUpdates against MALFORMED
 * persisted history (issue #1604 FINDINGS D1/D2/D3/D4). Recorded IContent read
 * back from disk is UNTRUSTED — a truncated/corrupt JSONL line can yield a null
 * item, an item missing its blocks, a text block whose `text` is not a string,
 * or a tool block missing its id/name. None of these may throw and abort the
 * WHOLE load; the mapper skips the unusable item/block and replays the rest.
 *
 * Split out of zed-session-replay.test.ts (which asserts the happy-path wire
 * shapes) to keep each file within the max-lines budget. The `as unknown as
 * IContent` / block casts here are type-honest ONLY for modelling corrupted
 * persisted data in tests — a real disk file carries no compile-time guarantee,
 * which the finding explicitly sanctions.
 */

import { describe, expect, it } from 'vitest';
import type {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core';

import { mapHistoryToSessionUpdates } from './zed-session-replay.js';

describe('mapHistoryToSessionUpdates — malformed persisted history (issue #1604 D1/D2/D3/D4)', () => {
  it('returns [] for an empty history (boundary, FINDING D3)', () => {
    expect(mapHistoryToSessionUpdates([])).toStrictEqual([]);
  });

  it('skips a null item without throwing (FINDING D1/D3)', () => {
    const history = [null as unknown as IContent];
    expect(mapHistoryToSessionUpdates(history)).toStrictEqual([]);
  });

  it('skips an undefined item without throwing (FINDING D1/D3)', () => {
    const history = [undefined as unknown as IContent];
    expect(mapHistoryToSessionUpdates(history)).toStrictEqual([]);
  });

  it('skips an item with no blocks array without throwing (FINDING D1/D3)', () => {
    const history = [{ speaker: 'human' } as unknown as IContent];
    expect(mapHistoryToSessionUpdates(history)).toStrictEqual([]);
  });

  it('skips an item whose blocks is a non-array without throwing (FINDING D1/D3)', () => {
    const history = [
      { speaker: 'ai', blocks: 'not-an-array' } as unknown as IContent,
    ];
    expect(mapHistoryToSessionUpdates(history)).toStrictEqual([]);
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['a number', 42],
    ['an unknown string', 'narrator'],
  ])(
    'skips an item whose speaker is %s (not human/ai/tool) instead of mapping it (FINDING D1)',
    (_label, badSpeaker) => {
      const history = [
        {
          speaker: badSpeaker,
          blocks: [{ type: 'text', text: 'should not be replayed' }],
        } as unknown as IContent,
      ];
      expect(mapHistoryToSessionUpdates(history)).toStrictEqual([]);
    },
  );

  it('continues replaying VALID items after skipping a malformed one (FINDING D1)', () => {
    const validItem: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'survived' }],
    };
    const history: readonly IContent[] = [
      null as unknown as IContent,
      validItem,
    ];
    expect(mapHistoryToSessionUpdates(history)).toStrictEqual([
      {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'survived' },
      },
    ]);
  });

  it('skips a text block whose text is not a string without throwing (FINDING D2/D3)', () => {
    const history = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 42 as unknown as string }],
      } as unknown as IContent,
    ];
    expect(mapHistoryToSessionUpdates(history)).toStrictEqual([]);
  });
  // ─── FINDING D1 (block level): malformed ELEMENTS inside a narrowed blocks ──
  // The item-level narrowing only proves `blocks` is an array; each ELEMENT is
  // still untrusted. A null/undefined/primitive element, or an object with no
  // string `type`, must be SKIPPED silently (no throw on `block.type`) so one
  // corrupt element cannot abort the whole replay.

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a string', 'x'],
    ['an object without a type', {}],
    ['an object whose type is not a string', { type: 42 }],
  ])(
    'skips a block that is %s without throwing (FINDING D1 block level)',
    (_label, badBlock) => {
      const history = [
        {
          speaker: 'ai',
          blocks: [badBlock],
        } as unknown as IContent,
      ];
      expect(mapHistoryToSessionUpdates(history)).toStrictEqual([]);
    },
  );

  it('replays a VALID block that FOLLOWS a malformed one in the SAME item (FINDING D1 block level)', () => {
    const history = [
      {
        speaker: 'ai',
        blocks: [null, 42, { type: 'text', text: 'after malformed' }],
      } as unknown as IContent,
    ];
    // The two malformed leading elements are skipped; the trailing valid text
    // block still maps to its agent_message_chunk.
    expect(mapHistoryToSessionUpdates(history)).toStrictEqual([
      {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'after malformed' },
      },
    ]);
  });

  it('replays a VALID item that FOLLOWS an item with malformed blocks (FINDING D1 block level)', () => {
    const history = [
      {
        speaker: 'ai',
        blocks: [null, { type: 42 }, 'x'],
      } as unknown as IContent,
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'next item survives' }],
      } as unknown as IContent,
    ];
    // Every element of the first item is malformed (skipped), and the whole
    // second item still replays.
    expect(mapHistoryToSessionUpdates(history)).toStrictEqual([
      {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'next item survives' },
      },
    ]);
  });

  // ─── FINDING D4: tool blocks missing a string id/name ─────────────────────

  it('drops an ai tool_call block that has no string id (no update with an undefined id, FINDING D4)', () => {
    const history = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            name: 'read_file',
            parameters: { absolute_path: '/a' },
          } as unknown as ToolCallBlock,
        ],
      } as unknown as IContent,
    ];
    // No id → the call cannot be tracked/paired → nothing is emitted (and no
    // trailing synthetic failure, since it was never added to pending).
    expect(mapHistoryToSessionUpdates(history)).toStrictEqual([]);
  });

  it('drops a tool_response block that has no string callId (cannot pair, FINDING D4)', () => {
    const history = [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            toolName: 'read_file',
            result: { output: 'orphan' },
          } as unknown as ToolResponseBlock,
        ],
      } as unknown as IContent,
    ];
    expect(mapHistoryToSessionUpdates(history)).toStrictEqual([]);
  });

  it('falls back the tool_call title to the id when name is missing but keeps the (valid) id (FINDING D4)', () => {
    const history = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-noname',
            parameters: { foo: 'bar' },
          } as unknown as ToolCallBlock,
        ],
      } as unknown as IContent,
    ];
    const [start, synthetic] = mapHistoryToSessionUpdates(history);
    // The start carries the id as toolCallId AND as the title fallback; kind is
    // omitted for the unknown (non-string) name.
    expect(start).toStrictEqual({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-noname',
      title: 'call-noname',
      status: 'in_progress',
      content: [],
      locations: [],
      rawInput: { foo: 'bar' },
    });
    expect('kind' in start).toBe(false);
    // Still pending at end-of-history → the usual synthetic failed terminal.
    expect(synthetic).toStrictEqual({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-noname',
      status: 'failed',
      content: [],
    });
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['a number', 42],
    ['an array', ['not', 'a', 'record']],
  ])(
    'sends rawInput as {} when the recorded parameters are %s — matching the live start path, which ALWAYS includes rawInput',
    (_label, badParameters) => {
      const history = [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call-badparams',
              name: 'read_file',
              parameters: badParameters,
            } as unknown as ToolCallBlock,
          ],
        } as unknown as IContent,
      ];
      const [start] = mapHistoryToSessionUpdates(history);
      // Live tool starts (zed-tool-handler emitToolCallStart) always carry
      // rawInput; replay must stay wire-identical, so malformed/missing
      // parameters degrade to an EMPTY object rather than omitting the field.
      expect(start).toStrictEqual({
        sessionUpdate: 'tool_call',
        toolCallId: 'call-badparams',
        title: 'read_file',
        status: 'in_progress',
        content: [],
        locations: [],
        kind: 'read',
        rawInput: {},
      });
    },
  );
});
