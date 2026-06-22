/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { ModelMessage } from 'ai';

import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { getContentPreview } from '../utils/contentPreview.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';

import type { ReasoningSettings } from './vercelStreamTypes.js';
import type { OpenAIVercelTool } from './schemaConverter.js';

type VercelTools = Record<string, unknown>;

export function logRequestContext(
  logger: DebugLogger,
  providerName: string,
  options: NormalizedGenerateChatOptions,
  modelId: string,
  metadata: NormalizedGenerateChatOptions['metadata'],
): void {
  if (!logger.enabled) return;
  const resolved = options.resolved;
  logger.debug(() => `[OpenAIVercelProvider] Resolved request context`, {
    provider: providerName,
    model: modelId,
    resolvedModel: resolved.model,
    resolvedBaseUrl: resolved.baseURL,
    authTokenPresent: Boolean(resolved.authToken),
    messageCount: options.contents.length,
    toolCount: options.tools?.length ?? 0,
    metadataKeys: Object.keys(metadata),
  });
}

export function logChatPayload(
  logger: DebugLogger,
  messages: ModelMessage[],
  formattedTools: OpenAIVercelTool[] | undefined,
): void {
  if (!logger.enabled) return;
  logger.debug(() => `[OpenAIVercelProvider] Chat payload snapshot`, {
    messageCount: messages.length,
    messages: messages.map((msg) => ({
      role: msg.role,
      contentPreview: getContentPreview(msg.content),
    })),
  });
  if (formattedTools != null) {
    logger.debug(() => `[OpenAIVercelProvider] Tool conversion summary`, {
      hasTools: true,
      toolCount: formattedTools.length,
      toolNames: formattedTools.map((t) => t.function.name),
    });
  }
}

export function logSendRequest(
  logger: DebugLogger,
  modelId: string,
  resolved: NormalizedGenerateChatOptions['resolved'],
  streamingEnabled: boolean,
  aiTools: VercelTools | undefined,
  rs: ReasoningSettings,
  maxOutputTokens: number | undefined,
  fallbackBaseURL: string | undefined,
): void {
  if (!logger.enabled) return;
  logger.debug(
    () =>
      `[OpenAIVercelProvider] Reasoning: enabled=${rs.enabled}, streaming=${streamingEnabled}`,
  );
  logger.debug(() => `[OpenAIVercelProvider] Sending chat request`, {
    model: modelId,
    baseURL: resolved.baseURL ?? fallbackBaseURL,
    streamingEnabled,
    hasTools: !!aiTools,
    toolCount: aiTools ? Object.keys(aiTools).length : 0,
    maxOutputTokens,
  });
}
