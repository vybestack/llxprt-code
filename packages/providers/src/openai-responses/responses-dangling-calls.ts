/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { normalizeToHistoryToolId } from '@vybestack/llxprt-code-tools/toolIdNormalization.js';

export interface DanglingCalls {
  /** Index of the last assistant row carrying tool calls; -1 when none. */
  readonly lastCallRow: number;
  /** History ids of calls that never receive a response, in call order. */
  readonly missing: ReadonlyMap<string, string | undefined>;
}

function settleResponses(open: Set<string>, row: IContent): void {
  if (row.speaker !== 'tool') return;
  for (const block of row.blocks) {
    if (block.type === 'tool_response')
      open.delete(normalizeToHistoryToolId(block.callId));
  }
}

/**
 * Finds unanswered tool calls the way the array route's synthetic-response
 * patching does, holding only the currently open calls and the last call row's
 * names. Calls answered before they appear (rare) are settled by a second scan.
 */
export async function findDanglingCalls(
  rows: () => AsyncIterable<IContent>,
  signal?: AbortSignal,
): Promise<DanglingCalls> {
  const open = new Set<string>();
  let names = new Map<string, string>();
  let lastCallRow = -1;
  let index = 0;
  for await (const row of rows()) {
    signal?.throwIfAborted();
    const calls =
      row.speaker === 'ai'
        ? row.blocks.filter((block) => block.type === 'tool_call')
        : [];
    if (calls.length > 0) {
      lastCallRow = index;
      names = new Map();
    }
    for (const call of calls) {
      if (!call.id) continue;
      const id = normalizeToHistoryToolId(call.id);
      open.add(id);
      if (call.name) names.set(id, call.name);
    }
    settleResponses(open, row);
    index++;
  }
  if (open.size > 0) {
    for await (const row of rows()) {
      signal?.throwIfAborted();
      settleResponses(open, row);
    }
  }
  return {
    lastCallRow,
    missing: new Map([...open].map((id) => [id, names.get(id)])),
  };
}
