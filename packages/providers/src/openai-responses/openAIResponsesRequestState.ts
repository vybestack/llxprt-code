/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ResponsesExecutorDeps } from './openAIResponsesExecutor.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type {
  ContentBlock,
  IContent,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { sanitizePromptCacheKey } from './sanitizePromptCacheKey.js';
import { computeStatefulConversation } from './openAIResponsesStateful.js';
import { OPENAI_TRANSPORT_SELECTOR_KEYS } from '../openai/openaiModelPolicy.js';
import {
  conservativeMediaTransportCapabilities,
  type ProviderMediaTransportCapabilities,
} from '../providerMediaTransportCapabilities.js';

interface MediaCapabilitiesSource {
  readonly getMediaTransportCapabilities?: (
    isCodex: boolean,
  ) => ProviderMediaTransportCapabilities;
}

export function resolveMediaCapabilities(
  source: MediaCapabilitiesSource,
  isCodex: boolean,
): ProviderMediaTransportCapabilities {
  return (
    source.getMediaTransportCapabilities?.(isCodex) ??
    conservativeMediaTransportCapabilities()
  );
}

export function resolveExplicitUserStore(
  requestOverrides: Readonly<Record<string, unknown>>,
): boolean | undefined {
  const store = requestOverrides['store'];
  return typeof store === 'boolean' ? store : undefined;
}

export function supportsStatefulResponsesTransport(
  forceStateless: boolean,
  capabilities: ProviderMediaTransportCapabilities,
  webSocketActive: boolean,
): boolean {
  if (forceStateless) return false;
  if (capabilities.durableStoredContinuation) return true;
  return capabilities.transportScopedContinuation && webSocketActive;
}

export function resolveResponsesBaseURL(
  options: NormalizedGenerateChatOptions,
  deps: ResponsesExecutorDeps,
): string {
  return (
    options.resolved.baseURL ??
    deps.getProviderBaseURL(options) ??
    'https://api.openai.com/v1'
  );
}

export function translateRequestOverrides(
  mergedParams: Record<string, unknown>,
  deps: ResponsesExecutorDeps,
): Record<string, unknown> {
  const requestOverrides: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(mergedParams)) {
    if (OPENAI_TRANSPORT_SELECTOR_KEYS.has(key)) {
      deps.logger.debug(
        () => `Dropping transport-selector key "${key}" from request body`,
      );
      continue;
    }
    if (key === 'max_tokens' || key === 'max_completion_tokens') {
      requestOverrides['max_output_tokens'] = value;
      deps.logger.debug(
        () =>
          `Translated ${key}=${value} to max_output_tokens for Responses API`,
      );
    } else if (key === 'prompt_cache_key') {
      const sanitized =
        typeof value === 'string' ? sanitizePromptCacheKey(value) : '';
      if (sanitized !== '') {
        requestOverrides[key] = sanitized;
      } else {
        deps.logger.debug(
          () =>
            `Dropping invalid prompt_cache_key from modelParams (type=${typeof value})`,
        );
      }
    } else {
      requestOverrides[key] = value;
    }
  }
  return requestOverrides;
}

export function getGenericMaxOutput(
  options: NormalizedGenerateChatOptions,
): number | undefined {
  const rawMaxOutput = (
    options as { settings?: { get: (key: string) => unknown } }
  ).settings?.get('maxOutputTokens');
  return typeof rawMaxOutput === 'number' &&
    Number.isFinite(rawMaxOutput) &&
    rawMaxOutput > 0
    ? rawMaxOutput
    : undefined;
}

export function buildRequestOverrides(
  options: NormalizedGenerateChatOptions,
  deps: ResponsesExecutorDeps,
): Record<string, unknown> {
  const mergedParams: Record<string, unknown> = {
    ...options.invocation.modelParams,
  };
  const genericMaxOutput = getGenericMaxOutput(options);
  if (
    genericMaxOutput !== undefined &&
    mergedParams['max_tokens'] === undefined &&
    mergedParams['max_completion_tokens'] === undefined &&
    mergedParams['max_output_tokens'] === undefined
  ) {
    mergedParams['max_output_tokens'] = genericMaxOutput;
  }

  const requestOverrides = translateRequestOverrides(mergedParams, deps);
  deps.logger.debug(
    () => `Request overrides: ${JSON.stringify(Object.keys(requestOverrides))}`,
  );
  return requestOverrides;
}

export interface ResponsesRequestShape {
  readonly rawBaseURL: string;
  readonly isCodex: boolean;
  readonly systemPrompt: string;
  readonly requestOverrides: ReturnType<typeof buildRequestOverrides>;
  readonly explicitUserStore: boolean | undefined;
  readonly stateful: ReturnType<typeof computeStatefulConversation>;
}

/**
 * Resolves everything the request shape depends on before any media is
 * reserved: the base URL, the Codex verdict, and whether this turn can chain
 * statefully. Statefulness needs both a transport that can carry the parent
 * (#3219) and media capabilities that survive continuation (#3199).
 */
export function resolveResponsesRequestShape(
  options: NormalizedGenerateChatOptions,
  patchedContent: IContent[],
  invocationEphemerals: Record<string, unknown>,
  deps: ResponsesExecutorDeps,
  forceStateless: boolean,
): ResponsesRequestShape {
  const rawBaseURL = resolveResponsesBaseURL(options, deps);
  const isCodex = deps.isCodexBaseURL(rawBaseURL);
  const requestOverrides = buildRequestOverrides(options, deps);
  const explicitUserStore = resolveExplicitUserStore(requestOverrides);
  const statefulTransportSupported = supportsStatefulResponsesTransport(
    forceStateless,
    resolveMediaCapabilities(deps, isCodex),
    deps.isWebSocketTransportActive?.() ?? false,
  );
  return {
    rawBaseURL,
    isCodex,
    // Issue #3136: the agent layer owns system-prompt assembly. The provider
    // transports options.systemInstruction verbatim (empty for projection).
    // options.userMemory is deliberately NOT read here: user memory is baked
    // into the assembled instruction upstream.
    systemPrompt: options.systemInstruction ?? '',
    requestOverrides,
    explicitUserStore,
    stateful: computeStatefulConversation(
      options,
      patchedContent,
      invocationEphemerals,
      explicitUserStore,
      isCodex,
      rawBaseURL,
      (responseId) => deps.isRejectedStatefulParent?.(responseId) ?? false,
      statefulTransportSupported,
      deps.logger,
    ),
  };
}

/**
 * Renders history for the estimation-only full-history projection (#2817)
 * without resolving media (#3199).
 *
 * A stateful turn deliberately reads only post-parent media -- the pre-parent
 * objects may not even exist on disk any more -- so running the real history
 * through a transport converter would throw on the unresolved references. A
 * reference already carries everything an estimate needs (mime type,
 * dimensions and normalizedBase64Length), so substitute a payload of the
 * declared length. This projection is never transported.
 */
export function toEstimationContents(contents: IContent[]): IContent[] {
  return contents.map((content) => {
    if (!content.blocks.some(isEstimationPlaceholderCandidate)) {
      return content;
    }
    return {
      ...content,
      blocks: content.blocks.map((block) =>
        isEstimationPlaceholderCandidate(block)
          ? estimationPlaceholder(block)
          : block,
      ),
    };
  });
}

function isEstimationPlaceholderCandidate(
  block: ContentBlock,
): block is MediaReferenceBlock {
  return block.type === 'media' && block.encoding === 'reference';
}

function estimationPlaceholder(block: MediaReferenceBlock): ContentBlock {
  const {
    contentId: _contentId,
    originalContentId: _originalContentId,
    selectedContentId: _selectedContentId,
    originalObject: _originalObject,
    selectedObject: _selectedObject,
    byteLength: _byteLength,
    normalizedBase64Length,
    ...rest
  } = block;
  return {
    ...rest,
    encoding: 'base64',
    // Length-accurate, content-free: the estimator counts characters, and no
    // byte of the referenced object is read to produce it.
    data: 'A'.repeat(normalizedBase64Length),
  };
}
