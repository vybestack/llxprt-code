/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AdmittedModelParameters } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import type { AgentChatRecordingExecution } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { StreamLivenessListener } from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import type { StructuredError } from '@vybestack/llxprt-code-core/core/turn.js';
import type { ChatSession, StreamEvent } from './chatSession.js';

/**
 * Open the provider response stream and return its async iterator. Shared by
 * both the bounded and unbounded first-response paths so the request shape is
 * defined in exactly one place.
 */
export async function openResponseStreamIterator(
  chat: ChatSession,
  promptId: string,
  recordingExecution: AgentChatRecordingExecution | undefined,
  req: string | object | readonly unknown[],
  timeoutSignal: AbortSignal,
  onProviderError: (error: StructuredError) => void,
  onStreamLiveness?: StreamLivenessListener,
  modelParameters?: AdmittedModelParameters,
  hookOwner?: AgentChatRecordingExecution['hookOwner'],
): Promise<AsyncIterator<StreamEvent>> {
  // Bridge: chatSession.sendMessageStream still expects Google-shaped
  // SendMessageParameters (until P21). The value is structurally compatible;
  // normalizeToolInteractionInput handles any shape at runtime.
  const responseStream = await chat.sendMessageStream(
    {
      message: req as Parameters<typeof chat.sendMessageStream>[0]['message'],
      modelParameters,
      hookOwner,
      config: {
        abortSignal: timeoutSignal,
        onProviderError,
        ...(onStreamLiveness !== undefined ? { onStreamLiveness } : {}),
      },
    },
    promptId,
    recordingExecution,
  );
  return responseStream[Symbol.asyncIterator]();
}
