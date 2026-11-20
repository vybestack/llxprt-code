/**
 * @plan PLAN-20251023-STATELESS-HARDENING.P08
 * @requirement REQ-SP2-001
 * @project-plans/debuglogging/requirements.md
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ClientOptions } from '@anthropic-ai/sdk';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderToolset } from '../IProvider.js';
import type { AnthropicRequestFacts } from './AnthropicRequestPreparation.js';
import type { PreparedAnthropicRequest } from './native-anthropic-request.js';

/**
 * Shapes and pure helpers used by AnthropicProvider, kept beside it so the
 * provider stays within its size budget.
 */
export function hasHeaderName(
  headers: Record<string, string>,
  name: string,
): boolean {
  const target = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

export interface PreparedAnthropicPromptEnvelope {
  /** The one prepared body: the projection estimates it, the send posts it. */
  readonly spooled: PreparedAnthropicRequest;
  readonly isOAuth: boolean;
  readonly authToken: string;
  readonly mediaRequest: ResolvedMediaRequest;
  /** Source route: inputs the blanked send options must get back. */
  readonly sourceInputs?: {
    readonly systemInstruction: string | undefined;
    readonly tools: ProviderToolset | undefined;
  };
}

export interface AnthropicTransportPreparation {
  readonly prepared: PreparedAnthropicPromptEnvelope | undefined;
  readonly mediaRequest: ResolvedMediaRequest;
  readonly effectiveOptions: NormalizedGenerateChatOptions;
}

export function isAnthropicMessageStream(
  response: Anthropic.Message | AsyncIterable<Anthropic.MessageStreamEvent>,
): response is AsyncIterable<Anthropic.MessageStreamEvent> {
  return Symbol.asyncIterator in response;
}

export function withSemanticMediaPurgeCacheEvidence(
  content: IContent,
  requestContext: AnthropicRequestFacts,
): IContent {
  const evidence = requestContext.semanticMediaPurgeCacheWriteEvidence;
  const cacheCreationTokens =
    content.metadata?.usage?.cache_creation_input_tokens;
  if (evidence === undefined) return content;
  if (evidence.preparation !== 'added') return content;
  if (typeof cacheCreationTokens !== 'number') return content;
  if (!Number.isFinite(cacheCreationTokens) || cacheCreationTokens <= 0)
    return content;
  return {
    ...content,
    metadata: {
      ...content.metadata,
      semanticMediaPurgeCacheWriteEvidence: evidence,
    },
  };
}

export function instantiateClient(
  classifyOAuthToken: (token: string) => boolean,
  authToken: string,
  baseURL?: string,
  requestFetch?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>,
): Anthropic {
  const isOAuthToken = classifyOAuthToken(authToken);
  const clientConfig: Record<string, unknown> = {
    dangerouslyAllowBrowser: true,
    maxRetries: 0,
    fetch: requestFetch,
  };

  if (isOAuthToken) {
    clientConfig.authToken = authToken;
    clientConfig.defaultHeaders = {
      'anthropic-beta': 'oauth-2025-04-20, interleaved-thinking-2025-05-14',
    };
    if (baseURL && baseURL.trim() !== '') {
      clientConfig.baseURL = baseURL;
    }
  } else {
    clientConfig.apiKey = authToken || '';
    if (baseURL && baseURL.trim() !== '') {
      clientConfig.baseURL = baseURL;
    }
  }

  return new Anthropic(clientConfig as ClientOptions);
}
