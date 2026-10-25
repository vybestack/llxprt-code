/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  ToolCallBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';

export function findKeyParamForCallId(
  history: readonly IContent[],
  callId: string,
): string | undefined {
  for (const entry of history) {
    if (entry.speaker !== 'ai') continue;
    const matching = entry.blocks.find(
      (block): block is ToolCallBlock =>
        block.type === 'tool_call' && block.id === callId,
    );
    if (matching) return keyParam(matching);
  }
  return undefined;
}

function keyParam(call: ToolCallBlock): string | undefined {
  const params = call.parameters;
  if (typeof params !== 'object' || params === null) return undefined;
  const candidate =
    Reflect.get(params, 'file_path') ??
    Reflect.get(params, 'absolute_path') ??
    Reflect.get(params, 'path');
  return typeof candidate === 'string' && candidate.length > 0
    ? candidate
    : undefined;
}

export function indexKeyParamsByCallId(
  history: readonly IContent[],
): ReadonlyMap<string, string | undefined> {
  const result = new Map<string, string | undefined>();
  for (const entry of history) {
    if (entry.speaker !== 'ai') continue;
    for (const block of entry.blocks) {
      if (block.type === 'tool_call' && !result.has(block.id))
        result.set(block.id, keyParam(block));
    }
  }
  return result;
}
