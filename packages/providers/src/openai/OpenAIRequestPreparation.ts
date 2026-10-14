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
  usesToolIdStore,
  type ChatBodyOptions,
  type ChatBodyRows,
} from './OpenAIChatBodyBuilder.js';
import { writeMessagesSegment } from './OpenAIChatMessagesSegment.js';
import {
  createChatContinuation,
  type ChatContinuation,
} from './OpenAIChatContinuation.js';
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
import { StreamedSegment, writeEnvelope } from '../utils/envelope-writer.js';
import { KeyedRowIndex } from '../utils/keyed-row-index.js';
import { KeyedRowToolIdStore } from '../utils/keyed-row-tool-id-store.js';
import { providerRowsOf } from '../utils/providerRows.js';
import { WireBodySpool } from '../utils/wire-body-spool.js';
import type { PromptKeySink } from '../runtime/prompt-key-tee-writer.js';
import { shouldDump, type DumpMode } from '../utils/dumpContext.js';
import type { StreamedDumpBody } from '../utils/dumpSDKContext.js';
import {
  ChatEstimatorFiles,
  type ChatPromptEstimate,
} from './OpenAIChatEstimatorFiles.js';
import { chatDumpBody } from './OpenAIChatDumpBody.js';

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
  /** Disposes the spool and the files, and closes the tool id index. Idempotent. */
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

/** Whether `dumpcontext` writes a request dump on success or on failure. */
function wantsRequestDump(mode: unknown): boolean {
  return (
    shouldDump(mode as DumpMode | undefined, false) ||
    shouldDump(mode as DumpMode | undefined, true)
  );
}

interface SpooledChatBody {
  readonly spool: WireBodySpool;
  readonly messageCount: number;
  readonly estimate: ChatPromptEstimate | undefined;
  readonly dump: StreamedDumpBody | undefined;
  readonly continuation: ChatContinuation;
}

/** What the prompt files of a request are for. */
interface ChatFileUse {
  /** The estimator form is handed to a projection. */
  readonly estimate: boolean;
  /** The dump form is written for a request dump. */
  readonly dump: boolean;
}

function chatBodyOptions(
  options: NormalizedGenerateChatOptions,
  format: ToolFormat,
  rowInput: ChatRowInput,
  toolIds: KeyedRowIndex | undefined,
  files: ChatEstimatorFiles | undefined,
): ChatBodyOptions {
  const mediaStage =
    files === undefined
      ? rowInput.mediaStage
      : files.listUnsupportedMedia(rowInput.mediaStage);
  return {
    reasoning: options,
    toolFormat: format,
    config: parseOutputLimits(options.invocation.ephemerals),
    ...(toolIds === undefined
      ? {}
      : { toolIdStore: new KeyedRowToolIdStore(toolIds) }),
    ...(mediaStage === undefined ? {} : { mediaStage }),
  };
}

function releaseChatBody(
  spool: WireBodySpool,
  toolIds: KeyedRowIndex | undefined,
  files: ChatEstimatorFiles | undefined,
): void {
  try {
    spool.dispose();
  } finally {
    try {
      toolIds?.close();
    } finally {
      files?.discard();
    }
  }
}

/**
 * Spools the request body: the envelope's small members are written as
 * `JSON.stringify` would and the messages are converted and written one row
 * at a time. A failure disposes the spool, the tool id index and the prompt
 * files.
 */
async function spoolChatBody(
  envelope: OpenAIChatRequestBody,
  options: NormalizedGenerateChatOptions,
  format: ToolFormat,
  rowInput: ChatRowInput,
  use: ChatFileUse,
): Promise<SpooledChatBody & { readonly release: () => void }> {
  const signal = getRequestSignal(options);
  const spool = WireBodySpool.create('openai-chat', { signal });
  let toolIds: KeyedRowIndex | undefined;
  let files: ChatEstimatorFiles | undefined;
  const release = (): void => releaseChatBody(spool, toolIds, files);
  try {
    if (usesToolIdStore(format)) toolIds = KeyedRowIndex.create('tool-ids');
    if (use.estimate || use.dump) {
      files = ChatEstimatorFiles.create(envelope.model, signal, use.dump);
    }
    const source = rowInput.rows ?? (await callRows(options));
    const bodyOptions = chatBodyOptions(
      options,
      format,
      rowInput,
      toolIds,
      files,
    );
    let messageCount = 0;
    const messages = new StreamedSegment(async (sink) => {
      const write = (estimate: PromptKeySink | undefined): Promise<number> =>
        writeMessagesSegment(
          sink,
          options.systemInstruction,
          source,
          bodyOptions,
          estimate,
        );
      if (files === undefined) {
        messageCount = await write(undefined);
      } else {
        await files.writeMessages(async (estimate) => {
          messageCount = await write(estimate);
        });
      }
    });
    await writeEnvelope(spool, { ...envelope, messages });
    spool.seal();
    await files?.writeTools(envelope.tools);
    return {
      spool,
      messageCount,
      estimate: use.estimate ? files?.seal() : undefined,
      dump:
        use.dump && files !== undefined
          ? chatDumpBody(envelope, files.dumpMessagesFile())
          : undefined,
      continuation: createChatContinuation({
        envelope,
        systemInstruction: options.systemInstruction,
        signal,
        source,
        body: {
          reasoning: options,
          toolFormat: format,
          config: bodyOptions.config,
          ...(rowInput.mediaStage === undefined
            ? {}
            : { mediaStage: rowInput.mediaStage }),
        },
      }),
      release,
    };
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
  withEstimate = false,
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

  const body = await spoolChatBody(
    envelope,
    options,
    detectedFormat,
    rowInput,
    {
      estimate: withEstimate,
      dump: wantsRequestDump(ephemeralSettings['dumpcontext']),
    },
  );
  return {
    model,
    detectedFormat,
    formattedTools,
    streamingEnabled,
    ...body,
  };
}
