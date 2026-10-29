/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { PrepareProviderInvocation } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';

import type { RuntimeGenerateChatOptions as GenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/toolDeclaration.js';
import {
  LOGICAL_REQUEST_ID_KEY,
  RAW_TOKEN_DELTA_SINK_KEY,
} from '@vybestack/llxprt-code-providers';
import type { ChatSessionConfig, SendMessageParams } from './chatSession.js';
import type { RawTokenDeltaBridge } from './streamTelemetryLogger.js';
import { extractSystemInstructionText } from './streamRequestHelpers.js';

export function buildStreamChatOptions(
  prepareInvocation: PrepareProviderInvocation,
  providerName: string,
  promptId: string,
  requestPayload: {
    contents: Iterable<IContent> | AsyncIterable<IContent>;
    tools: ToolDeclaration[] | undefined;
  },
  metadata: Readonly<Record<string, unknown>> | undefined,
  params: SendMessageParams,
  generationConfig: ChatSessionConfig,
  rawTokenDeltaBridge: RawTokenDeltaBridge | null,
): GenerateChatOptions {
  return {
    // Estimation and transport each receive a fresh pass over the request rows.
    contents: {
      async *[Symbol.asyncIterator]() {
        for await (const content of requestPayload.contents) {
          yield content;
        }
      },
    },
    invocation: prepareInvocation(
      params.modelParameters?.providerName ?? providerName,
      params.modelParameters,
      params.config?.abortSignal,
    ),
    modelParameters: params.modelParameters,
    ...(params.modelParameters?.route?.provider.name !== 'load-balancer' &&
    params.modelParameters?.route
      ? {
          resolved: {
            model: params.modelParameters.route.model,
            ...(params.modelParameters.route.baseURL
              ? { baseURL: params.modelParameters.route.baseURL }
              : {}),
          },
        }
      : {}),
    tools: requestPayload.tools,
    onProviderError: params.config?.onProviderError,
    onStreamLiveness: params.config?.onStreamLiveness,
    metadata: {
      ...metadata,
      abortSignal: params.config?.abortSignal,
      _retryRequestContext: params.config?.providerRequestContext,
      [LOGICAL_REQUEST_ID_KEY]: promptId,
      [RAW_TOKEN_DELTA_SINK_KEY]: rawTokenDeltaBridge?.notify,
    },
    systemInstruction: extractSystemInstructionText(
      generationConfig.systemInstruction,
    ),
    systemPromptAssembler: generationConfig.systemPromptAssembler,
  };
}
