/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  encodeRowDraft,
  entryForNewRow,
  entryForRewrittenRow,
  type DraftBlock,
  type RowDraft,
} from './rowDraft.js';
import { entryAggregate } from './rowAlgebra.js';
import {
  CHRONOLOGY_SEQ_NONE,
  ROW_BLOCK_TYPE,
  ROW_SPEAKER,
} from './rowRecord.js';

const BYTES = new Uint8Array([1, 2, 3]);

function block(type: number): DraftBlock {
  return { type, bytes: BYTES };
}

function draft(overrides: Partial<RowDraft>): RowDraft {
  return {
    owner: 0,
    speaker: ROW_SPEAKER.human,
    flags: 0,
    chronologySeq: 5n,
    chronologyUserTurn: 1,
    chronologyStep: 1,
    chronologyRecordedAt: 1,
    parentEndpoint: 0n,
    ids: [],
    meta: BYTES,
    blocks: [],
    ...overrides,
  };
}

function entryOf(label: bigint, row: RowDraft) {
  return entryForNewRow(encodeRowDraft(label, row), 4096);
}

describe('statistics counters of a row entry (design 2.5)', () => {
  it('counts tool call and tool response blocks from the block directory', () => {
    const entry = entryOf(
      3n,
      draft({
        speaker: ROW_SPEAKER.ai,
        blocks: [
          block(ROW_BLOCK_TYPE.text),
          block(ROW_BLOCK_TYPE.tool_call),
          block(ROW_BLOCK_TYPE.tool_call),
          block(ROW_BLOCK_TYPE.tool_response),
        ],
      }),
    );

    expect(entry.toolCallBlocks).toBe(2);
    expect(entry.responseBlocks).toBe(1);
    const aggregate = entryAggregate(entry);
    expect(aggregate.toolCallBlocks).toBe(2);
    expect(aggregate.responseBlocks).toBe(1);
  });

  it('recounts the blocks of a rewritten row and does not carry the previous counts', () => {
    const previous = entryOf(
      3n,
      draft({ blocks: [block(ROW_BLOCK_TYPE.tool_call)] }),
    );

    const rewritten = entryForRewrittenRow(
      encodeRowDraft(3n, draft({ blocks: [block(ROW_BLOCK_TYPE.text)] })),
      8192,
      previous,
    );

    expect(rewritten.toolCallBlocks).toBe(0);
    expect(rewritten.responseBlocks).toBe(0);
  });

  it('gives a human row its speaker count and last label, and no other speaker one', () => {
    const aggregate = entryAggregate(
      entryOf(7n, draft({ speaker: ROW_SPEAKER.human })),
    );

    expect([aggregate.humanRows, aggregate.aiRows]).toStrictEqual([1, 0]);
    expect([
      aggregate.lastHuman,
      aggregate.lastAi,
      aggregate.lastTool,
    ]).toStrictEqual([7n, 0n, 0n]);
  });

  it('gives an ai row and a tool row their own last label', () => {
    const ai = entryAggregate(entryOf(8n, draft({ speaker: ROW_SPEAKER.ai })));
    const tool = entryAggregate(
      entryOf(9n, draft({ speaker: ROW_SPEAKER.tool })),
    );

    expect([ai.aiRows, ai.lastAi, ai.lastHuman, ai.lastTool]).toStrictEqual([
      1,
      8n,
      0n,
      0n,
    ]);
    expect([tool.humanRows + tool.aiRows, tool.lastTool]).toStrictEqual([
      0,
      9n,
    ]);
  });

  it('keeps the chronology seq of the row as first and last, and counts a row without one', () => {
    const stamped = entryAggregate(entryOf(1n, draft({ chronologySeq: 42n })));
    const bare = entryAggregate(
      entryOf(2n, draft({ chronologySeq: CHRONOLOGY_SEQ_NONE })),
    );

    expect([
      stamped.firstSeq,
      stamped.lastSeq,
      stamped.noChronologyRows,
    ]).toStrictEqual([42n, 42n, 0]);
    expect([bare.firstSeq, bare.lastSeq, bare.noChronologyRows]).toStrictEqual([
      CHRONOLOGY_SEQ_NONE,
      CHRONOLOGY_SEQ_NONE,
      1,
    ]);
  });
});
