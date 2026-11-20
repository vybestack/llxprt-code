/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ToolCall } from '@vybestack/llxprt-code-core';

export function retainUiToolCalls(
  calls: ToolCall[],
  journalControls: boolean,
): ToolCall[] {
  if (!journalControls) return calls;
  return calls.flatMap((call) => {
    if (call.request.journalIdentity === undefined) return [call];
    if (
      call.status === 'success' ||
      call.status === 'error' ||
      call.status === 'cancelled'
    )
      return [];
    return [
      call.status === 'executing' ? { ...call, liveOutput: undefined } : call,
    ];
  });
}
