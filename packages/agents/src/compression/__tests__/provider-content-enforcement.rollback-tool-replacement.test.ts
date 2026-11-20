import { readHistory } from './retirement-source-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4000 CodeRabbit round 3 (R4): another send on the same conversation
 * can truncate a tool response (`replaceToolResponseBlock`) while a guarded
 * compression runs; concurrent sends are intended behavior. Rolling back the
 * failed compression restores the snapshot and keeps that replacement.
 *
 * Real LocalMediaStore, HistoryService (its real mutation queue),
 * ProviderContentEnforcer, production send seam and AnthropicProvider
 * projection; only HTTP is stubbed.
 */

import { describe, expect, it } from 'bun:test';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  IContent,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { ContextOverflowError } from '../contextOverflowError.js';
import { createTruncationStub } from '../toolResultTruncator.js';
import { aiTurn, rejection } from './image-retirement-harness.js';
import {
  historyTexts,
  textTurn,
  useReliefConversation,
} from './media-relief-fixtures.js';

const PARTIAL = 'PARTIAL SUMMARY FROM FAILED COMPRESSION';
const CRASH = 'summarizer crashed after rewriting history';
const ORIGINAL = 'ORIGINAL LARGE TOOL RESULT';
/** Larger than anything the enforcer's own truncation would report. */
const OTHER_SEND_TOKENS = 12_345;

const toolCall: IContent = {
  speaker: 'ai',
  blocks: [
    { type: 'tool_call', id: 'call-1', name: 'read_file', parameters: {} },
  ],
};
const responseBlock: ToolResponseBlock = {
  type: 'tool_response',
  callId: 'call-1',
  toolName: 'read_file',
  result: ORIGINAL,
};
const toolResponse: IContent = { speaker: 'tool', blocks: [responseBlock] };
/**
 * What another send's last-resort truncation leaves behind. It carries the
 * truncation marker, so this conversation's own truncation leaves it alone and
 * a surviving stub is told apart from one the enforcer writes itself.
 */
const STUB = createTruncationStub(responseBlock, OTHER_SEND_TOKENS);

/** Every tool response result in the raw history, in order. */
async function toolResults(history: HistoryService): Promise<unknown[]> {
  return (await readHistory(history)).flatMap((content) =>
    content.blocks.flatMap((block) =>
      block.type === 'tool_response' ? [block.result] : [],
    ),
  );
}

async function truncateToolResult(history: HistoryService): Promise<void> {
  const changed = { replaced: false };
  await history.detachedValues.transform(async (source, sink) => {
    let ordinal = 0;
    for await (const row of source.streamRows()) {
      const matches = row.blocks.some(
        (block) =>
          block.type === 'tool_response' && block.callId === STUB.callId,
      );
      if (matches) {
        await sink.appendReplacement(ordinal, {
          ...row,
          blocks: row.blocks.map((block) =>
            block.type === 'tool_response' && block.callId === STUB.callId
              ? STUB
              : block,
          ),
        });
        changed.replaced = true;
      } else await sink.appendDerived(ordinal, row);
      ordinal++;
    }
  });
  if (!changed.replaced) throw new Error('the tool response was not replaced');
}

describe('rollback of a failed compression keeps a concurrent tool-response truncation (issue #4000 CodeRabbit round 3 R4)', () => {
  const conversation = useReliefConversation('llxprt-issue4000-cr3-r4-');

  it('keeps the truncation the failed rewrite removed and drops the partial summary', async () => {
    const session = conversation.session();
    await conversation.seedImages(3);
    session.history.add(toolCall);
    session.history.add(toolResponse);
    conversation.seedBigText();
    const before = await historyTexts(session.history);
    let runs = 0;
    session.useCompression(async (history) => {
      runs += 1;
      if (runs === 1) await truncateToolResult(history);
      await history.replaceAll([aiTurn(PARTIAL)]);
      throw new Error(CRASH);
    });

    const error = await rejection(session.send([textTurn('next question')]));

    expect({
      contextOverflow: error instanceof ContextOverflowError,
      texts: await historyTexts(session.history),
      toolResults: await toolResults(session.history),
    }).toStrictEqual({
      contextOverflow: true,
      texts: before,
      toolResults: [STUB.result],
    });
  });

  it('keeps the truncation when the failed compression changed nothing else', async () => {
    const session = conversation.session();
    await conversation.seedImages(3);
    session.history.add(toolCall);
    session.history.add(toolResponse);
    conversation.seedBigText();
    const before = await historyTexts(session.history);
    let runs = 0;
    session.useCompression(async (history) => {
      runs += 1;
      if (runs === 1) await truncateToolResult(history);
      throw new Error(CRASH);
    });

    const error = await rejection(session.send([textTurn('next question')]));

    expect({
      contextOverflow: error instanceof ContextOverflowError,
      texts: await historyTexts(session.history),
      toolResults: await toolResults(session.history),
    }).toStrictEqual({
      contextOverflow: true,
      texts: before,
      toolResults: [STUB.result],
    });
  });
});
