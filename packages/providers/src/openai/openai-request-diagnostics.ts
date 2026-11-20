/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { OpenAITool } from './schemaConverter.js';

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
    'metadata' | 'resolved' | 'contents' | 'contentCount' | 'tools'
  >,
  requestContext: {
    model: string;
    detectedFormat: string;
    formattedTools: OpenAITool[] | undefined;
    streamingEnabled: boolean;
    messageCount: number;
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
    messageCount: options.contentCount ?? options.contents.length,
    toolCount: options.tools?.length ?? 0,
    metadataKeys: Object.keys(metadata),
  });
  logger.debug(() => `[OpenAIProvider] Sending chat request`, {
    model: requestContext.model,
    baseURL: resolveBaseURL(),
    streamingEnabled: requestContext.streamingEnabled,
    toolCount: requestContext.formattedTools?.length ?? 0,
    hasAuthToken: Boolean(resolved.authToken),
    messageCount: requestContext.messageCount,
  });
  const tools = requestContext.formattedTools;
  if (tools !== undefined && tools.length > 0) {
    logger.debug(() => `[OpenAIProvider] Exact tools being sent to API:`, {
      toolCount: tools.length,
      toolNames: tools.map((t) => t.function.name),
      firstTool: tools[0],
    });
  }
}
