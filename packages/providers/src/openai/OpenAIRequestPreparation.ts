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

import type OpenAI from 'openai';
import { type NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { type DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { ToolFormat } from '@vybestack/llxprt-code-tools/IToolFormatter.js';
import { convertToolsToOpenAI, type OpenAITool } from './schemaConverter.js';
import { resolveToolFormat } from '../utils/toolFormatDetection.js';
import {
  writeChatMessages,
  type ChatBodyOptions,
  type ChatBodyRows,
} from './OpenAIChatBodyBuilder.js';
import { extractModelParamsFromOptions } from './OpenAIClientFactory.js';
import { sanitizePromptCacheKey } from '../openai-responses/sanitizePromptCacheKey.js';
import { applyOpenAIChatReasoning } from './openai-chat-reasoning.js';
import {
  parseOutputLimits,
  type OutputLimitConfig,
} from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { applyKimiCacheAffinity } from './kimiCacheAffinity.js';
import {
  conservativeMediaTransportCapabilities,
  type ProviderMediaTransportCapabilities,
} from '../providerMediaTransportCapabilities.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import { jsonValueChunks } from '../utils/boundedJsonBody.js';
import {
  StreamedSegment,
  writeEnvelope,
  type EnvelopeSink,
} from '../utils/envelope-writer.js';
import { KeyedRowIndex } from '../utils/keyed-row-index.js';
import { KeyedRowToolIdStore } from '../utils/keyed-row-tool-id-store.js';
import { providerRowsOf } from '../utils/providerRows.js';
import { WireBodySpool } from '../utils/wire-body-spool.js';

/**
 * A prepared chat request: the sealed body on scratch disk and the scalars the
 * response path needs. The messages exist only as bytes in the spool.
 */
export interface RequestContext {
  model: string;
  detectedFormat: string;
  formattedTools: OpenAITool[] | undefined;
  streamingEnabled: boolean;
  /** The sealed request body; its size is the Content-Length. */
  spool: WireBodySpool;
  /** Messages in the body, the system message included. */
  messageCount: number;
  /** Disposes the spool and closes the tool id index. Idempotent. */
  release(): void;
}

/**
 * Where the rows of one request come from. By default the call's own rows are
 * read and no media is resolved; the caller supplies the media stage, or rows
 * it already prepared (the Kimi file pre-pass).
 */
export interface ChatRowInput {
  readonly rows?: ChatBodyRows;
  readonly mediaStage?: ChatBodyOptions['mediaStage'];
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

async function callRows(
  options: NormalizedGenerateChatOptions,
): Promise<ChatBodyRows> {
  const rows = await providerRowsOf(options);
  const signal = getRequestSignal(options);
  return { rows: () => rows.openReader(signal) };
}

function usesToolIdStore(format: ToolFormat): boolean {
  return format === 'kimi' || format === 'mistral';
}

/**
 * Writes the messages array: `[`, the system message, then each conversion
 * output behind a comma, `]`. Returns the number of messages written.
 */
async function writeMessagesSegment(
  sink: EnvelopeSink,
  options: NormalizedGenerateChatOptions,
  source: ChatBodyRows,
  bodyOptions: ChatBodyOptions,
): Promise<number> {
  sink.append('[');
  const system = jsonValueChunks({
    role: 'system',
    content: options.systemInstruction ?? '',
  });
  if (system === undefined) throw new Error('System message is not JSON');
  for (const chunk of system) sink.append(chunk);
  const converted = await writeChatMessages(source, bodyOptions, {
    message(chunks) {
      sink.append(',');
      for (const chunk of chunks) sink.append(chunk);
    },
  });
  sink.append(']');
  return converted + 1;
}

/**
 * Spools the request body: the envelope's small members are written as
 * `JSON.stringify` would and the messages are converted and written one row
 * at a time. A failure disposes the spool and the tool id index.
 */
async function spoolChatBody(
  envelope: OpenAIChatRequestBody,
  options: NormalizedGenerateChatOptions,
  format: ToolFormat,
  rowInput: ChatRowInput,
): Promise<Pick<RequestContext, 'spool' | 'messageCount' | 'release'>> {
  const spool = WireBodySpool.create('openai-chat', {
    signal: getRequestSignal(options),
  });
  let toolIds: KeyedRowIndex | undefined;
  const release = (): void => {
    try {
      spool.dispose();
    } finally {
      toolIds?.close();
    }
  };
  try {
    if (usesToolIdStore(format)) toolIds = KeyedRowIndex.create('tool-ids');
    const source = rowInput.rows ?? (await callRows(options));
    const bodyOptions: ChatBodyOptions = {
      reasoning: options,
      toolFormat: format,
      config: parseOutputLimits(options.invocation.ephemerals),
      ...(toolIds === undefined
        ? {}
        : { toolIdStore: new KeyedRowToolIdStore(toolIds) }),
      ...(rowInput.mediaStage === undefined
        ? {}
        : { mediaStage: rowInput.mediaStage }),
    };
    let messageCount = 0;
    const messages = new StreamedSegment(async (sink) => {
      messageCount = await writeMessagesSegment(
        sink,
        options,
        source,
        bodyOptions,
      );
    });
    await writeEnvelope(spool, { ...envelope, messages });
    spool.seal();
    return { spool, messageCount, release };
  } catch (error) {
    release();
    throw error;
  }
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
): Promise<RequestContext> {
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

  const body = await spoolChatBody(envelope, options, detectedFormat, rowInput);
  return {
    model,
    detectedFormat,
    formattedTools,
    streamingEnabled,
    ...body,
  };
}
