/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

export const text = (value: string): IContent => ({
  speaker: 'human',
  blocks: [{ type: 'text', text: value }],
});
export const aiText = (value: string): IContent => ({
  speaker: 'ai',
  blocks: [{ type: 'text', text: value }],
});
export const callRow = (...ids: string[]): IContent => ({
  speaker: 'ai',
  blocks: ids.map((id) => ({
    type: 'tool_call' as const,
    id,
    name: 'read_file',
    parameters: { id },
  })),
});
export const answerRow = (...ids: string[]): IContent => ({
  speaker: 'tool',
  blocks: ids.map((id) => ({
    type: 'tool_response' as const,
    callId: id,
    toolName: 'read_file',
    result: `result ${id}`,
  })),
});
export const thinkingOnly = (thought: string, model?: string): IContent => ({
  speaker: 'ai',
  blocks: [
    { type: 'thinking', thought, sourceField: 'thinking', signature: 'sig' },
  ],
  ...(model === undefined ? {} : { metadata: { model } }),
});
