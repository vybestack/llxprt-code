/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { appendFileSync } from 'node:fs';
import { expect } from 'bun:test';
import { batchRow } from './addbatch-stream-test-helpers.js';
import type { IContent, ToolResponseBlock } from './IContent.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';

export function repairRow(index: number, size: number): IContent {
  const row = batchRow(index, 256);
  if (index === 0 || index === size - 1 || index === Math.floor(size / 2))
    return {
      ...row,
      speaker: 'ai',
      blocks: [
        ...row.blocks,
        { type: 'tool_call', id: `missing-${index}`, name: '', parameters: {} },
        {
          type: 'tool_call',
          id: `missing-${index}`,
          name: 'duplicate',
          parameters: {},
        },
        { type: 'tool_call', id: 'repeated', name: 'repeat', parameters: {} },
      ],
    };
  return row;
}

export function replacementFor(index: number): ToolResponseBlock {
  return {
    type: 'tool_response',
    callId: `call-${index}`,
    toolName: 'inspect',
    result: { shortened: index },
  };
}

function repeatedResponse(first: boolean): ToolResponseBlock[] {
  return first
    ? [
        {
          type: 'tool_response',
          callId: 'repeated',
          toolName: 'repeat',
          result: null,
          error: 'Tool call interrupted or cancelled',
          isComplete: true,
        },
      ]
    : [];
}

export function assertRepairedPair(
  row: IContent,
  sourceIndex: number,
  first: boolean,
  size: number,
): void {
  expect(row.metadata?.chronology?.seq).toBeGreaterThan(size);
  expect(row.speaker).toBe('tool');
  expect(row.metadata?.synthetic).toBe(true);
  expect(row.blocks).toStrictEqual([
    {
      type: 'tool_response',
      callId: `missing-${sourceIndex}`,
      toolName: 'unknown_tool',
      result: null,
      error: 'Tool call interrupted or cancelled',
      isComplete: true,
    },
    {
      type: 'tool_response',
      callId: `missing-${sourceIndex}`,
      toolName: 'duplicate',
      result: null,
      error: 'Tool call interrupted or cancelled',
      isComplete: true,
    },
    ...repeatedResponse(first),
  ]);
}

export function assertRetainedRepairRow(
  row: IContent,
  index: number,
  size: number,
): void {
  const input = repairRow(index, size);
  const expected = [0, size - 1].includes(index)
    ? {
        ...input,
        blocks: input.blocks.map((block, position) =>
          position === 2 ? replacementFor(index) : block,
        ),
      }
    : input;
  expect(row).toStrictEqual(expected);
}

export function recordRepairOwners(
  phase: string,
  size: number,
  owners: RowOwnership,
): void {
  const output = process.env.TOOL_REPAIR_OWNER_OUTPUT;
  if (output !== undefined)
    appendFileSync(
      output,
      `${JSON.stringify({ phase, size, ...owners.snapshot() })}\n`,
    );
}
