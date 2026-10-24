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

import { providerRowsOf } from '../utils/providerRows.js';
import type OpenAI from 'openai';
import type { ToolFormat } from '@vybestack/llxprt-code-tools/IToolFormatter.js';
import { type NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { type DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { convertToolsToOpenAI, type OpenAITool } from './schemaConverter.js';
import { resolveToolFormat } from '../utils/toolFormatDetection.js';
import type { ChatBodyOptions } from './OpenAIChatBodyBuilder.js';
import type { ChatContinuation } from './OpenAIChatContinuation.js';
import { extractModelParamsFromOptions } from './OpenAIClientFactory.js';
import { sanitizePromptCacheKey } from '../openai-responses/sanitizePromptCacheKey.js';
import { applyOpenAIChatReasoning } from './openai-chat-reasoning.js';
import { type OutputLimitConfig } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { applyKimiCacheAffinity } from './kimiCacheAffinity.js';
import {
  conservativeMediaTransportCapabilities,
  type ProviderMediaTransportCapabilities,
} from '../providerMediaTransportCapabilities.js';
import { wantsRequestDump } from '../utils/dumpContext.js';
import type { StreamedDumpBody } from '../utils/dumpSDKContext.js';
import type { ChatPromptEstimate } from './OpenAIChatEstimatorFiles.js';
import { prepareNativePlainRequest } from './native-chat-body.js';
import type { ChatHttpBody } from '../utils/chat-http-body.js';

/**
 * A prepared chat request: a replayable native body and the scalars the
 * response path needs.
 */
export interface RequestContext {
  model: string;
  detectedFormat: string;
  formattedTools: OpenAITool[] | undefined;
  streamingEnabled: boolean;
  /** The sealed request body; its size is the Content-Length. */
  spool: ChatHttpBody;
  /** Messages in the body, the system message included. */
  messageCount: number;
  /**
   * The estimator form of the prompt keys, written with the body when the
   * request is projected. The caller owns it once it has the request.
   */
  estimate: ChatPromptEstimate | undefined;
  /**
   * The body a request dump records, streamed from the dump-form files written
   * with the body. Present only when the call's `dumpcontext` asks for a dump.
   */
  dump: StreamedDumpBody | undefined;
  /**
   * Builds the request that follows a reply of tool calls and no text, as a
   * second spool over the same rows.
   */
  continuation: ChatContinuation;
  /** Releases the body and its request-owned resources. Idempotent. */
  release(): void | Promise<void>;
}

/**
 * How the rows of one request are prepared. The call's own rows are always
 * read; by default no media is resolved, and the caller supplies the media
 * stage that resolves stored media and, for the Kimi file pre-pass, replaces
 * uploaded blocks with their references.
 */
export interface ChatRowInput {
  readonly mediaStage?: ChatBodyOptions['mediaStage'];
  /** Media blocks the Kimi pre-pass replaced with provider file references. */
  readonly uploadedMedia?: number;
}

/**
 * Convert tools to OpenAI format and handle empty-array guard.
 */
function convertAndGuardTools(
  tools: NormalizedGenerateChatOptions['tools'],
  model: string,
  detectedFormat: string,
  logger: DebugLogger,
): OpenAITool[] | undefined {
  let formattedTools: OpenAITool[] | undefined = convertToolsToOpenAI(tools);

  // CRITICAL FIX: Ensure we never pass an empty tools array
  if (Array.isArray(formattedTools) && formattedTools.length === 0) {
    logger.warn(
      () =>
        `[OpenAIProvider] CRITICAL: Formatted tools is empty array! Setting to undefined to prevent API errors.`,
      {
        model,
        inputTools: tools,
        inputToolsLength: tools?.length,
        inputFirstGroup: tools?.[0],
        stackTrace: new Error().stack,
      },
    );
    formattedTools = undefined;
  }

  // Debug log the conversion result
  if (logger.enabled && formattedTools !== undefined) {
    logger.debug(() => `[OpenAIProvider] Tool conversion summary:`, {
      detectedFormat,
      inputHadTools: !!tools,
      inputToolsLength: tools?.length,
      inputFirstGroup: tools?.[0],
      inputFunctionDeclarationsLength: tools?.length,
      outputHasTools: formattedTools.length > 0,
      outputToolsLength: formattedTools.length,
      outputToolNames: formattedTools.map((t) => t.function.name),
    });
  }

  return formattedTools;
}

type OpenAIChatRequestBody = OpenAI.Chat.ChatCompletionCreateParams &
  Record<string, unknown>;

/**
 * The invocation context is required; only a legacy subrecord (modelBehavior,
 * ephemerals) can be explicitly undefined in fixtures built before the
 * invocation contract hardened, and a missing subrecord reads as empty at the
 * transport boundary.
 */
function readInvocationRecord(
  record: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
  return record ?? {};
}

function resolveReasoningConfig(
  requestBody: OpenAIChatRequestBody,
  options: NormalizedGenerateChatOptions,
  ephemeralSettings: Readonly<Record<string, unknown>>,
  model: string,
  providerName: string,
  logger: DebugLogger,
): void {
  const baseUrl =
    options.resolved.baseURL ??
    (typeof ephemeralSettings['base-url'] === 'string'
      ? ephemeralSettings['base-url']
      : undefined);

  applyOpenAIChatReasoning({
    body: requestBody,
    modelBehavior: readInvocationRecord(options.invocation.modelBehavior),
    baseUrl,
    model,
    providerName,
    logger,
  });
}

/**
 * Apply model-param overrides, reasoning config, and stream-options to the
 * request body.
 */
function applyRequestBodyOverrides(
  requestBody: OpenAIChatRequestBody,
  options: NormalizedGenerateChatOptions,
  ephemeralSettings: Readonly<Record<string, unknown>>,
  model: string,
  streamingEnabled: boolean,
  providerName: string,
  logger: DebugLogger,
): void {
  // Apply request overrides, sanitizing prompt_cache_key at the transport
  // boundary so an overlong value (e.g. a subagent runtimeId) never reaches
  // the API (issue #2853). Non-string or empty cache keys are dropped.
  // All other model params are forwarded unchanged.
  const requestOverrides = extractModelParamsFromOptions(options);
  if (requestOverrides) {
    const sanitizedOverrides = sanitizeOverridesCacheKey(
      requestOverrides,
      logger,
    );
    if (logger.enabled && sanitizedOverrides) {
      logger.debug(() => `[OpenAIProvider] Applying request overrides`, {
        overrideKeys: Object.keys(sanitizedOverrides),
      });
    }
    if (sanitizedOverrides) {
      assertNoMessagesOverride(sanitizedOverrides);
      Object.assign(requestBody, sanitizedOverrides);
    }
  }

  resolveReasoningConfig(
    requestBody,
    options,
    ephemeralSettings,
    model,
    providerName,
    logger,
  );

  // Add stream options if streaming is enabled
  const streamOptions = (ephemeralSettings['stream-options'] as
    | { include_usage?: boolean }
    | undefined) ?? { include_usage: true };

  if (streamingEnabled) {
    Object.assign(requestBody, { stream_options: streamOptions });
  }
}

/**
 * The messages are the spooled array; an override cannot replace them, because
 * the body is written from the rows and a replacement would be dropped or sent
 * without the conversion rules applied.
 */
function assertNoMessagesOverride(overrides: Record<string, unknown>): void {
  if ('messages' in overrides) {
    throw new Error(
      'OpenAI chat request overrides cannot replace "messages"; the messages are written from the request rows',
    );
  }
}

/**
 * Sanitize a single extracted model-params record, clamping/dropping only
 * the `prompt_cache_key` field (issue #2853). All other keys are preserved
 * verbatim so that provider-specific extensions and canonical Chat
 * Completions fields (service_tier, store, verbosity, etc.) continue to
 * pass through. Returns undefined when the cache key was the only entry
 * and it was dropped.
 */
function sanitizeOverridesCacheKey(
  overrides: Record<string, unknown>,
  logger: DebugLogger,
): Record<string, unknown> | undefined {
  const value = overrides['prompt_cache_key'];
  if (value === undefined) {
    return overrides;
  }
  const result: Record<string, unknown> = { ...overrides };
  if (typeof value === 'string' && value.trim() !== '') {
    result['prompt_cache_key'] = sanitizePromptCacheKey(value);
  } else {
    delete result['prompt_cache_key'];
    logger.debug(
      () =>
        `Dropping invalid prompt_cache_key from modelParams (type=${typeof value})`,
    );
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

interface OpenAIToolPayload {
  readonly detectedFormat: ToolFormat;
  readonly formattedTools: OpenAITool[] | undefined;
}

function prepareToolPayload(
  options: NormalizedGenerateChatOptions,
  model: string,
  logger: DebugLogger,
  providerName: string,
): OpenAIToolPayload {
  const detectedFormat = resolveToolFormat(
    model,
    providerName,
    options.invocation.getProviderOverrides<Record<string, unknown>>(
      providerName,
    )?.toolFormat,
    logger,
  );
  logger.debug(
    () =>
      `[OpenAIProvider] Using tool format '${detectedFormat}' for model '${model}'`,
    { model, detectedFormat, provider: providerName },
  );
  return {
    detectedFormat,
    formattedTools: convertAndGuardTools(
      options.tools,
      model,
      detectedFormat,
      logger,
    ),
  };
}

/**
 * Prepare OpenAI API request from normalized options
 * Extracts all the request preparation logic from generateChatCompletionImpl
 */
export async function prepareRequest(
  options: NormalizedGenerateChatOptions,
  defaultModel: string,
  _config: OutputLimitConfig | undefined,
  logger: DebugLogger,
  providerName?: string,
  mediaTransportCapabilities: ProviderMediaTransportCapabilities = conservativeMediaTransportCapabilities(),
  rowInput: ChatRowInput = {},
  withEstimate = false,
): Promise<RequestContext> {
  if (
    options.requestRows?.native === undefined &&
    options.requestRows?.callerOwned !== true
  )
    throw new Error(
      'OpenAI Chat requires a native or caller-owned request selection',
    );
  const model = options.resolved.model || defaultModel;
  const ephemeralSettings = readInvocationRecord(options.invocation.ephemerals);
  const resolvedProviderName = providerName ?? 'openai';
  const { detectedFormat, formattedTools } = prepareToolPayload(
    options,
    model,
    logger,
    resolvedProviderName,
  );
  const streamingEnabled = ephemeralSettings['streaming'] !== 'disabled';

  // The envelope keeps `messages` in its key position as an empty placeholder;
  // the spool writer replaces it with the streamed array.
  const envelope: OpenAIChatRequestBody = {
    model,
    messages: [],
    stream: streamingEnabled,
  };

  if (formattedTools && formattedTools.length > 0) {
    envelope.tools = formattedTools;
    envelope.tool_choice = 'auto';
  }

  // Apply model params, reasoning, and stream-options overrides
  applyRequestBodyOverrides(
    envelope,
    options,
    ephemeralSettings,
    model,
    streamingEnabled,
    resolvedProviderName,
    logger,
  );
  applyKimiCacheAffinity(envelope, {
    providerName: resolvedProviderName,
    runtimeId: options.invocation.runtimeId,
    cacheAffinityKey: mediaTransportCapabilities.cacheAffinityKey,
  });

  const use = {
    estimate: withEstimate,
    dump: wantsRequestDump(ephemeralSettings['dumpcontext']),
  };
  const nativeRows = await providerRowsOf(options);
  const body = await prepareNativePlainRequest(
    envelope,
    nativeRows,
    options,
    use,
    rowInput,
    detectedFormat,
    resolvedProviderName,
  );
  return {
    model,
    detectedFormat,
    formattedTools,
    streamingEnabled,
    ...body,
  };
}
