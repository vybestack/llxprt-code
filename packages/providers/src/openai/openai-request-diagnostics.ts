/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type OpenAI from 'openai';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';

export function logOpenAIChatTools(
  options: Pick<NormalizedGenerateChatOptions, 'tools'>,
  runtimeKey: string,
  logger: DebugLogger,
): void {
  if (!logger.enabled) return;
  const { tools } = options;
  logger.debug(
    () => '[OpenAIProvider] generateChatCompletion received tools:',
    {
      hasTools: !!tools,
      toolsLength: tools?.length,
      toolsType: typeof tools,
      isArray: Array.isArray(tools),
      firstToolName: tools?.[0]?.name,
      toolsStructure: tools ? 'available' : 'undefined',
      runtimeKey,
    },
  );
}

export function logOpenAIRequestDiagnostics(
  providerName: string,
  options: Pick<
    NormalizedGenerateChatOptions,
    'metadata' | 'resolved' | 'contents' | 'tools'
  >,
  requestContext: {
    model: string;
    detectedFormat: string;
    formattedTools: unknown[] | undefined;
    streamingEnabled: boolean;
    requestBody: OpenAI.Chat.ChatCompletionCreateParams;
    messagesWithSystem: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  },
  resolveBaseURL: () => string | undefined,
  logger: DebugLogger,
): void {
  if (!logger.enabled) return;
  const { metadata } = options;
  const resolved = options.resolved;
  logger.debug(() => `[OpenAIProvider] Resolved request context`, {
    provider: providerName,
    model: requestContext.model,
    resolvedModel: resolved.model,
    resolvedBaseUrl: resolved.baseURL,
    authTokenPresent: Boolean(resolved.authToken),
    messageCount: options.contents.length,
    toolCount: options.tools?.length ?? 0,
    metadataKeys: Object.keys(metadata),
  });
  logger.debug(() => `[OpenAIProvider] Sending chat request`, {
    model: requestContext.model,
    baseURL: resolveBaseURL(),
    streamingEnabled: requestContext.streamingEnabled,
    toolCount: requestContext.formattedTools?.length ?? 0,
    hasAuthToken: Boolean(resolved.authToken),
    messageCount: requestContext.messagesWithSystem.length,
  });
  if ('tools' in requestContext.requestBody) {
    logger.debug(() => `[OpenAIProvider] Exact tools being sent to API:`, {
      toolCount: requestContext.requestBody.tools?.length,
      toolNames: requestContext.requestBody.tools?.map((t) =>
        'function' in t ? t.function.name : undefined,
      ),
      firstTool: requestContext.requestBody.tools?.[0],
    });
  }
}
