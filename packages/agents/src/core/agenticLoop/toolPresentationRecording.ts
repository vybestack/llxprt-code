/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

function presentationContent(
  display: CompletedToolCall['response']['resultDisplay'],
): { format: 'text' | 'json' | 'none'; source: string } {
  if (display === undefined) return { format: 'none', source: '' };
  if (typeof display === 'string') return { format: 'text', source: display };
  return { format: 'json', source: JSON.stringify(display) };
}

export async function persistToolPresentations(
  tools: readonly CompletedToolCall[],
  history: Pick<HistoryService, 'appendDisplay'> | null,
  origin?: object,
): Promise<void> {
  for (const tool of tools) {
    const identity = tool.request.journalIdentity;
    const display = tool.response.resultDisplay;
    if (identity === undefined || tool.response.suppressDisplay === true)
      continue;
    if (history === null)
      throw new Error('Journal tool request has no history owner');
    const content = presentationContent(display);
    await history.appendDisplay(
      {
        type: 'tool-result',
        attemptId: identity.attemptId,
        callId: tool.request.callId,
        format: content.format,
        status: tool.status,
        displayName: tool.tool?.displayName,
        description: tool.invocation?.getDescription(),
        renderOutputAsMarkdown: tool.tool?.isOutputMarkdown,
      },
      content.source,
      origin,
    );
  }
}
