/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  normalizeToHistoryToolId,
  normalizeToOpenAIToolId,
} from '@vybestack/llxprt-code-tools/toolIdNormalization.js';
import { StreamTruncatedError } from '../streamProtocolErrors.js';
import type { StreamingState } from './vercelStreamTypes.js';

export interface ToolInputPart {
  readonly type: string;
  readonly id?: string;
  readonly delta?: string;
  readonly toolName?: string;
}

export function toolInputArrival(
  part: ToolInputPart,
  state: StreamingState,
): IContent[] {
  if (
    part.type === 'tool-input-start' &&
    part.id !== undefined &&
    part.toolName !== undefined
  ) {
    state.collectedToolCalls.push({
      toolCallId: part.id,
      toolName: part.toolName,
      input: undefined,
      argumentsStarted: true,
    });
    return [];
  }
  if (
    part.type !== 'tool-input-delta' ||
    part.id === undefined ||
    part.delta === undefined
  )
    return [];
  const call = state.collectedToolCalls.find(
    (candidate) => candidate.toolCallId === part.id,
  );
  if (call === undefined)
    throw new Error('Tool argument delta has no tool-input-start');
  return [
    {
      speaker: 'ai',
      blocks: [],
      toolArgumentDelta: {
        sourceId: call.toolCallId,
        id: normalizeToHistoryToolId(normalizeToOpenAIToolId(call.toolCallId)),
        name: call.toolName,
        arguments: part.delta,
      },
    },
  ];
}

export function assertToolInputComplete(state: StreamingState): void {
  if (
    state.collectedToolCalls.some(
      (call) =>
        call.argumentsStarted === true && call.argumentsComplete !== true,
    )
  )
    throw new StreamTruncatedError(
      'Vercel tool arguments ended without a completed tool call',
    );
}
