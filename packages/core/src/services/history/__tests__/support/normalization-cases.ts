/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
} from '../../IContent.js';

export const UNIT_CASE_COUNT = 5000;

export interface UnitCase {
  readonly id: string;
  readonly rows: readonly IContent[];
  readonly tail: readonly IContent[];
}

export function call(id: string, name = 'inspect'): ToolCallBlock {
  return { type: 'tool_call', id, name, parameters: { value: id } };
}

export function response(id: string, complete = true): ToolResponseBlock {
  return {
    type: 'tool_response',
    callId: id,
    toolName: 'inspect',
    result: complete ? 'done' : null,
    isComplete: complete,
  };
}

export function unitCase(seed: number): UnitCase {
  const id = ['a', '', 'call_x', 'toolu_x', 'hist_tool_x'][seed % 5];
  const human: IContent = {
    speaker: 'human',
    blocks: [{ type: 'text', text: `q-${seed}` }],
  };
  const ai: IContent = { speaker: 'ai', blocks: [call(id)] };
  const tool: IContent = {
    speaker: 'tool',
    blocks: [response(id)],
    metadata: { model: `source-${seed}` },
  };
  const variants: ReadonlyArray<readonly IContent[]> = [
    [human],
    [human, ai],
    [{ ...human, blocks: [...human.blocks, call(id)] }, ai],
    [human, ai, tool],
    [human, tool, ai],
    [human, ai, { ...human, blocks: [response(id)] }],
    [human, { ...ai, blocks: [call(id), call(id, 'second')] }, tool],
    [human, ai, { ...tool, blocks: [response(id, false)] }, tool],
    [human, { ...tool, blocks: [response(id), call(id)] }],
    [
      human,
      ai,
      {
        ...tool,
        blocks: [
          response(id),
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'YWJj',
            encoding: 'base64',
          },
        ],
      },
    ],
    [human, { speaker: 'ai', blocks: [] }, ai],
    [
      human,
      { ...ai, blocks: [call('call_x'), call('hist_tool_x'), call('toolu_x')] },
      tool,
    ],
  ];
  const rows = variants[Math.floor(seed / 5) % variants.length];
  const pending = seed % 7 === 0;
  return {
    id: `unit-${seed}`,
    rows: pending ? rows.slice(0, -1) : rows,
    tail: pending ? rows.slice(-1) : [],
  };
}
