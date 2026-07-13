/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ContractPart,
  ServerAgentStreamEvent,
  ToolErrorType,
} from '@vybestack/llxprt-code-core';

export function createCompletedToolCallResponse(params: {
  callId: string;
  responseParts?: ContractPart[];
  resultDisplay?: unknown;
  error?: Error;
  errorType?: ToolErrorType;
  agentId?: string;
  suppressDisplay?: boolean;
}) {
  return {
    status: params.error ? ('error' as const) : ('success' as const),
    request: {
      callId: params.callId,
      name: 'mock_tool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'mock-prompt',
      agentId: params.agentId ?? 'primary',
    },
    response: {
      callId: params.callId,
      responseParts: params.responseParts ?? [],
      resultDisplay: params.resultDisplay,
      error: params.error,
      errorType: params.errorType,
      agentId: params.agentId ?? 'primary',
      suppressDisplay: params.suppressDisplay,
    },
  };
}

export async function* createStreamFromEvents(
  events: ServerAgentStreamEvent[],
): AsyncGenerator<ServerAgentStreamEvent> {
  for (const event of events) {
    yield event;
  }
}
