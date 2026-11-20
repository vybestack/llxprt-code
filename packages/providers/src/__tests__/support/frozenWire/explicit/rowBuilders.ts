/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/** Small row builders shared by the counterexample modules. */

import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';

export const human = (...blocks: ContentBlock[]): IContent => ({
  speaker: 'human',
  blocks,
});

export const ai = (...blocks: ContentBlock[]): IContent => ({
  speaker: 'ai',
  blocks,
});

export const tool = (...blocks: ContentBlock[]): IContent => ({
  speaker: 'tool',
  blocks,
});

export const textBlock = (value: string): ContentBlock => ({
  type: 'text',
  text: value,
});

export const callBlock = (id: string, name = 'read_file'): ContentBlock => ({
  type: 'tool_call',
  id,
  name,
  parameters: { id },
});

export const responseBlock = (
  callId: string,
  result: string = `result ${callId}`,
): ContentBlock => ({
  type: 'tool_response',
  callId,
  toolName: 'read_file',
  result,
});

export const imageBlock = (data: string): ContentBlock => ({
  type: 'media',
  mimeType: 'image/png',
  encoding: 'base64',
  data,
});
