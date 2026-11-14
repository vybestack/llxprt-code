/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { JournalResponsePlan } from '@vybestack/llxprt-code-core/services/history/journal-response-plan.js';
import { ROW_BLOCK_TYPE } from '@vybestack/llxprt-code-core/journal/rowRecord.js';
import {
  nativeDumpLiteral,
  type NativeDumpPiece,
} from '../utils/native-dump-body.js';

export function isTextResponsePlan(plan: JournalResponsePlan): boolean {
  if (plan.header.speaker !== 'human' && plan.header.speaker !== 'ai')
    return false;
  return plan.blocks.every((ref) => {
    const ids = plan.sourceIds?.(ref.at.label);
    return (
      ref.kind === 'source' &&
      ids?.header.blocks[ref.at.block]?.type === ROW_BLOCK_TYPE.text
    );
  });
}

async function* textParts(plan: JournalResponsePlan): AsyncGenerator<string> {
  let separator = '';
  for await (const block of plan.openBlocks()) {
    if (block.type !== 'text')
      throw new Error('Text plan contains another block type');
    yield separator;
    yield block.text;
    separator = plan.header.speaker === 'human' ? '\n' : '';
  }
}

/** Escape one bounded slice while preserving surrogate pairs across block boundaries. */
async function* escapedText(plan: JournalResponsePlan): AsyncGenerator<string> {
  let carry = '';
  for await (const value of textParts(plan)) {
    for (let at = 0; at < value.length; at += 8192) {
      let piece = carry + value.slice(at, at + 8192);
      carry = '';
      const last = piece.charCodeAt(piece.length - 1);
      if (last >= 0xd800 && last <= 0xdbff) {
        carry = piece.slice(-1);
        piece = piece.slice(0, -1);
      }
      if (piece !== '') yield JSON.stringify(piece).slice(1, -1);
    }
  }
  if (carry !== '') yield JSON.stringify(carry).slice(1, -1);
}

/** Native text transport borrows one block, rather than reopening the decoded row stream. */
export async function* nativeTextResponsePieces(
  plan: JournalResponsePlan,
  separator: string,
): AsyncGenerator<NativeDumpPiece> {
  let opened = false;
  for await (const escaped of escapedText(plan)) {
    if (!opened) {
      const role = plan.header.speaker === 'human' ? 'user' : 'assistant';
      yield nativeDumpLiteral(`${separator}{"role":"${role}","content":"`);
      opened = true;
    }
    yield nativeDumpLiteral(escaped);
  }
  if (opened) yield nativeDumpLiteral('"}');
}
