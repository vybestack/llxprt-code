/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  createInMemoryToolIdStore,
  getToolIdStrategy,
} from '@vybestack/llxprt-code-tools';
import type { IdOccurrence } from '../../idFactUpdate.js';
import { OCCURRENCE_KIND } from '../../idKeys.js';
import { ROW_SPEAKER, decodeIdPiece, encodeIdPiece } from '../../rowRecord.js';

/** A history reduced to what the Mistral mapper looks at: calls in AI rows and responses in tool rows. */
export interface MistralRow {
  readonly speaker: 'ai' | 'tool';
  readonly id: string;
}

export const pair = (id: string): MistralRow[] => [
  { speaker: 'ai', id },
  { speaker: 'tool', id },
];

/** The real mapper of the tools package: observe every row, then resolve in conversion order. */
export function realMapping(rows: readonly MistralRow[]): Map<string, string> {
  const store = createInMemoryToolIdStore();
  const mapper = getToolIdStrategy('mistral').createStreamingMapper(store);
  for (const row of rows) {
    mapper.observe({
      blocks:
        row.speaker === 'ai'
          ? [{ type: 'tool_call', id: row.id, name: 'n' }]
          : [{ type: 'tool_response', callId: row.id, toolName: 'n' }],
    });
  }
  const mapped = new Map<string, string>();
  for (const row of rows) {
    mapped.set(
      row.id,
      row.speaker === 'ai'
        ? mapper.resolveToolCallId({
            type: 'tool_call',
            id: row.id,
            name: 'n',
            parameters: {},
          })
        : mapper.resolveToolResponseId({ callId: row.id, toolName: 'n' }),
    );
  }
  return mapped;
}

/** What a rebuild has: the raw id strings of the surviving rows, through the row id piece. */
export function idsFromIdPiece(rows: readonly MistralRow[]): MistralRow[] {
  const piece = encodeIdPiece(rows.map((row) => row.id));
  const ids = decodeIdPiece(piece, rows.length);
  return rows.map((row, at) => ({ speaker: row.speaker, id: ids[at] }));
}

export function occurrencesFor(rows: readonly MistralRow[]): IdOccurrence[] {
  return rows.map((row, at) => {
    const label = BigInt(at + 1) * 1000n;
    const speaker = row.speaker === 'ai' ? ROW_SPEAKER.ai : ROW_SPEAKER.tool;
    return {
      rawId: row.id,
      kind:
        row.speaker === 'ai' ? OCCURRENCE_KIND.call : OCCURRENCE_KIND.response,
      at: { label, part: 0, block: 0 },
      partSpeaker: speaker,
      unit: {
        position: { label, part: 0, unit: 0 },
        speaker,
        leadingTool: false,
      },
      score: 1,
      nameLen: 1,
      reconstructed: false,
    };
  });
}
