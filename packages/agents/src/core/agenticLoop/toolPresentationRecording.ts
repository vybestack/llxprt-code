/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

export async function persistToolPresentations(
  tools: readonly CompletedToolCall[],
  history: Pick<HistoryService, 'appendDisplay'> | null,
  origin?: object,
): Promise<void> {
  for (const tool of tools) {
    const identity = tool.request.journalIdentity;
    const display = tool.response.resultDisplay;
    if (
      identity === undefined ||
      display === undefined ||
      tool.response.suppressDisplay === true
    )
      continue;
    if (history === null)
      throw new Error('Journal tool request has no history owner');
    await history.appendDisplay(
      {
        type: 'tool-result',
        attemptId: identity.attemptId,
        callId: tool.request.callId,
        format: typeof display === 'string' ? 'text' : 'json',
        status: tool.status,
        displayName: tool.tool?.displayName,
        description: tool.invocation?.getDescription(),
        renderOutputAsMarkdown: tool.tool?.isOutputMarkdown,
      },
      typeof display === 'string' ? display : JSON.stringify(display),
      origin,
    );
  }
}
