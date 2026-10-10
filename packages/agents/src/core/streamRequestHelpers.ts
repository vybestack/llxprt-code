/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/toolDeclaration.js';

/**
 * @fileoverview Pure request-preparation helpers extracted from StreamProcessor.
 *
 * These functions build the request payload, select tools, apply hook
 * modifications, and resolve provider-runtime values. They take explicit
 * params (no shared mutable state) so they can be unit-tested in isolation.
 */

import type { BeforeModelHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
import {
  type ToolChoice,
  type ModelStreamChunk,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type {
  IContent,
  UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { SendMessageParams } from './chatSession.js';
import type { SemanticMediaPurgeAttempt } from './semanticMediaPurgeSession.js';
import { sanitizeProviderContentForSerialization } from '@vybestack/llxprt-code-core/services/history/historyCloneUtils.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  providerRequestRows,
  type ProviderRequestRows,
  type ProviderRequestSnapshot,
} from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { ProviderCuratedStreamOptions } from '@vybestack/llxprt-code-core/services/history/provider-curated-stream.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { AgentClientGenerateConfig } from '@vybestack/llxprt-code-core/core/clientContract.js';
import {
  canonicalizeToolName,
  SCOPE_LOCAL_EMIT_TOOL_NAME,
} from './toolGovernance.js';

export interface ToolSelectionHookResult {
  tools: ToolDeclaration[] | undefined;
  allowedFunctionNames: string[] | undefined;
  conversationLogEmptyTools?: boolean;
}

/** Request payload shape shared by the stream send and its fallback logging. */
export interface PreparedRequest {
  requestPayload: {
    contents: IContent[];
    tools: ToolDeclaration[] | undefined;
  };
  baseRuntimeContext: ProviderRuntimeContext;
}

/** Cold, repeatable request copies preserve the purge transaction and boundary identity. */
export function streamSemanticPurgeRequest(
  attempt: SemanticMediaPurgeAttempt | undefined,
  signal?: AbortSignal,
): AsyncIterable<IContent> | undefined {
  if (attempt === undefined) return undefined;
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<IContent, void, unknown> {
      signal?.throwIfAborted();
      for await (const row of attempt.requestHistory.streamRows(signal)) {
        signal?.throwIfAborted();
        const content = sanitizeProviderContentForSerialization(row);
        const boundary = row.metadata?.semanticMediaPurgeBoundary;
        if (row.metadata !== undefined) {
          content.metadata = structuredClone(row.metadata);
          if (boundary !== undefined) {
            content.metadata.semanticMediaPurgeBoundary = { ...boundary };
          }
        }
        yield content;
      }
    },
  };
}

export interface RequestContentsSnapshot {
  readonly contents: ProviderRequestRows;
  readonly pending: ProviderRequestSnapshot['pending'] & {
    readonly isPending: (index: number) => boolean;
  };
}

export async function withRequestContentsSnapshot<T>(
  userContents: IContent | IContent[],
  historyService: HistoryService,
  consume: (request: RequestContentsSnapshot) => Promise<T>,
  options: ProviderCuratedStreamOptions = {},
  historyOverride?: Iterable<IContent> | AsyncIterable<IContent>,
): Promise<T> {
  const owner = await openRequestContentsSnapshot(
    userContents,
    historyService,
    options,
    historyOverride,
  );
  try {
    return await consume(
      Object.freeze({
        contents: providerRequestRows(owner),
        pending: Object.freeze({
          ...owner.pending,
          isPending: (index: number) => owner.isPending(index),
        }),
      }),
    );
  } finally {
    owner.close();
  }
}

/** The caller closes this disk selection after the final response or failed attempt. */
export function openRequestContentsSnapshot(
  userContents: IContent | IContent[],
  historyService: HistoryService,
  options: ProviderCuratedStreamOptions = {},
  historyOverride?: Iterable<IContent> | AsyncIterable<IContent>,
): Promise<ProviderRequestSnapshot> {
  options.signal?.throwIfAborted();
  return historyService.prepareCuratedForProviderSnapshot(
    preparePendingContents(userContents, historyService),
    options,
    historyOverride,
  );
}

export function preparePendingContents(
  userContents: IContent | IContent[],
  historyService: HistoryService,
): IContent[] {
  const inputArray = Array.isArray(userContents)
    ? userContents
    : [userContents];
  return inputArray.map((content) => {
    const turnKey = historyService.generateTurnKey();
    const idGen = historyService.getIdGeneratorCallback(turnKey);
    return {
      ...content,
      metadata: { ...(content.metadata ?? {}), id: idGen(), turnId: turnKey },
    };
  });
}

/**
 * Select the tools for the request from params or the fallback generationConfig.
 */
export function selectRequestTools(
  params: SendMessageParams,
  fallbackTools: ToolDeclaration[] | undefined,
): ToolDeclaration[] | undefined {
  return params.config?.tools ?? fallbackTools;
}

export function extractAllowedToolNames(
  toolChoice: unknown,
): string[] | undefined {
  if (toolChoice === null || toolChoice === undefined) return undefined;
  if (typeof toolChoice !== 'object') return undefined;
  if (!('allowedToolNames' in toolChoice)) return undefined;
  if (!Array.isArray(toolChoice.allowedToolNames)) return undefined;
  return toolChoice.allowedToolNames;
}

export async function applyToolSelectionHook(
  configForHooks: AgentRuntimeContext['providerRuntime']['config'],
  tools: AgentClientGenerateConfig['tools'],
  model: string,
): Promise<ToolSelectionHookResult> {
  if (configForHooks === undefined) {
    return { tools, allowedFunctionNames: undefined };
  }

  const getToolSelectionHooksEnabled = configForHooks.getEnableHooks;
  if (
    typeof getToolSelectionHooksEnabled !== 'function' ||
    getToolSelectionHooksEnabled.call(configForHooks) !== true
  ) {
    return { tools, allowedFunctionNames: undefined };
  }

  const getToolSelectionHookSystem = configForHooks.getHookSystem;
  const hookSystem =
    typeof getToolSelectionHookSystem === 'function'
      ? getToolSelectionHookSystem.call(configForHooks)
      : undefined;
  if (hookSystem === undefined) {
    return { tools, allowedFunctionNames: undefined };
  }

  // Re-initializing would discard runtime enable/disable state of registered hooks.
  if (!hookSystem.isInitialized()) await hookSystem.initialize();
  const toolsFromConfig = Array.isArray(tools) ? tools : [];
  const toolSelectionResult = await hookSystem.fireBeforeToolSelectionEvent({
    model,
    contents: [],
    tools: toolsFromConfig,
  });
  const modifiedConfig = toolSelectionResult?.applyToolChoiceModifications({
    tools: toolsFromConfig,
  });

  const toolChoice: ToolChoice | undefined = modifiedConfig?.toolChoice;
  if (toolChoice?.mode === 'none') {
    return {
      tools: [],
      allowedFunctionNames: [],
      conversationLogEmptyTools: true,
    };
  }
  const allowedFunctions = extractAllowedToolNames(toolChoice);
  if (allowedFunctions === undefined) {
    return {
      tools,
      allowedFunctionNames: undefined,
      conversationLogEmptyTools: tools === undefined,
    };
  }

  const emitterName = canonicalizeToolName(SCOPE_LOCAL_EMIT_TOOL_NAME);
  const hasScopeLocalEmitter = toolsFromConfig.some(
    (decl) => canonicalizeToolName(decl.name) === emitterName,
  );
  const effectiveAllowedFunctions = hasScopeLocalEmitter
    ? Array.from(new Set([...allowedFunctions, SCOPE_LOCAL_EMIT_TOOL_NAME]))
    : allowedFunctions;
  const allowedNames = new Set(
    effectiveAllowedFunctions.map(canonicalizeToolName),
  );
  const filteredTools = toolsFromConfig.filter((decl) =>
    allowedNames.has(canonicalizeToolName(decl.name)),
  );
  return {
    tools: filteredTools,
    allowedFunctionNames: effectiveAllowedFunctions,
    conversationLogEmptyTools: filteredTools.length === 0,
  };
}

/**
 * Merge the base runtime context with request params. When the request config
 * carries an abort signal, surface it via runtime metadata while preserving the
 * original Config instance untouched.
 */
export function buildRuntimeContext(
  baseRuntimeContext: ProviderRuntimeContext,
  params: SendMessageParams,
): ProviderRuntimeContext {
  if (!params.config?.abortSignal) return baseRuntimeContext;
  return {
    ...baseRuntimeContext,
    metadata: {
      ...(baseRuntimeContext.metadata ?? {}),
      abortSignal: params.config.abortSignal,
    },
  };
}

/**
 * Type guard: true when a value is a non-null object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Type guard: true when the hook output's llm_request actually contains a
 * contents array (i.e., the hook intends to REPLACE the conversation
 * contents). A hook that supplies llm_request with only model/settings fields
 * (no contents) does NOT intend to replace contents — in that case the
 * original IContent[] must be preserved.
 *
 * Shared by both call sites (applyRequestModifications and
 * DirectMessageProcessor._handleBeforeModelHook) to avoid drift.
 */
export function hookProvidedContents(
  beforeModelResult: BeforeModelHookOutput | undefined,
): boolean {
  if (!beforeModelResult) return false;
  const hookSpecificOutput = beforeModelResult.hookSpecificOutput;
  if (!isRecord(hookSpecificOutput)) return false;
  const llmRequest = hookSpecificOutput['llm_request'];
  if (!isRecord(llmRequest)) return false;
  return Array.isArray(llmRequest['contents']);
}

/**
 * Apply LLM request modifications from a BeforeModel hook result.
 *
 * When the hook output contains NO llm_request field (or an llm_request with
 * NO contents array — only model/settings overrides), the ORIGINAL
 * requestContents array is returned (reference-equal) so callers can detect
 * "no content modification" via reference equality. Contents are ONLY
 * replaced when the hook actually supplied replacement contents.
 *
 * F1 (v2 full fidelity): the v2 wire format carries contents as IContent[]
 * verbatim — tool args, tool outputs, and thinking blocks pass through by
 * reference. Hooks are a trusted extension seam (#2624); no text-only
 * round-trip exists that could strip them.
 */
export function applyRequestModifications(
  beforeModelResult: BeforeModelHookOutput | undefined,
  requestContents: IContent[],
  model: string,
): IContent[] {
  if (!beforeModelResult) return requestContents;

  // H2: only merge when the hook actually supplied replacement contents. A
  // contents-less llm_request (model/settings only) must preserve the
  // original contents reference.
  if (!hookProvidedContents(beforeModelResult)) {
    return requestContents;
  }

  const modifiedRequest = beforeModelResult.applyLLMRequestModifications({
    version: 2,
    model: model || '',
    contents: requestContents,
  });
  const modifiedContents = modifiedRequest.contents;
  // Guard: if the hook supplied llm_request.contents: [] (empty array),
  // treat it as "no modification" and return the ORIGINAL reference. An
  // empty contents array would silently erase the entire conversation
  // (and break the provider call); returning the original reference keeps
  // the caller's boundary detection authoritative.
  if (modifiedContents.length === 0) {
    return requestContents;
  }
  return modifiedContents;
}

/**
 * Resolve the user-memory string from the provider runtime config.
 *
 * `Config.getUserMemory()` is declared as a required method, but tests may
 * mock Config without it, so boundary-validate `typeof === 'function'`.
 */
export function resolveUserMemory(
  config: Config | undefined,
): string | undefined {
  if (config && typeof config.getUserMemory === 'function') {
    return config.getUserMemory();
  }
  return undefined;
}

const systemInstructionLogger = new DebugLogger(
  'llxprt:agents:system-instruction',
);

/**
 * Extracts a plain-text system instruction string from a Gemini
 * `ContentUnion` value (string, Content, Part[], or Part).
 *
 * Issue #2410: subagent personas are built into
 * generationConfig.systemInstruction by subagentRuntimeSetup.createChatObject().
 * This helper normalizes the various shapes the SDK allows so the instruction
 * can be forwarded to providers as a simple string. Returns undefined when the
 * value is absent or contains no text.
 */
export function extractSystemInstructionText(
  raw: AgentClientGenerateConfig['systemInstruction'],
): string | undefined {
  // Broadening to unknown lets the null guard pass lint without a suppression directive.
  const value: unknown = raw;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  // Content shape: { role, parts: Part[] }
  if (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'parts' in value &&
    Array.isArray(value.parts)
  ) {
    const text = extractPartsText(value.parts);
    return text.length > 0 ? text : undefined;
  }
  // Part[] shape
  if (Array.isArray(value)) {
    const text = extractPartsText(value);
    return text.length > 0 ? text : undefined;
  }
  // Single Part shape: { text: string } — exclude Content objects that
  // happen to have a text property alongside parts (makes this check
  // self-contained and order-independent).
  if (typeof value === 'object' && 'text' in value && !('parts' in value)) {
    const text = typeof value.text === 'string' ? value.text.trim() : '';
    return text.length > 0 ? text : undefined;
  }
  // Unrecognized top-level shape — warn so a malformed systemInstruction
  // (which carries the subagent persona, issue #2410) is not silently lost.
  const shapeDesc =
    typeof value === 'object'
      ? `object(keys=${Object.keys(value).join(',')})`
      : typeof value;
  systemInstructionLogger.warn(
    () =>
      `extractSystemInstructionText: unrecognized systemInstruction shape (type=${shapeDesc})`,
  );
  return undefined;
}

function extractPartsText(parts: unknown[]): string {
  return parts
    .map((part) => {
      if (typeof part === 'string') return part.trim();
      if (
        part !== null &&
        typeof part === 'object' &&
        'text' in part &&
        typeof part.text === 'string'
      ) {
        return part.text.trim();
      }
      // Unrecognized part type — warn so malformed parts in a systemInstruction
      // (which carries the subagent persona, issue #2410) are not silently lost.
      const partDesc = describeUnrecognizedPart(part);
      systemInstructionLogger.warn(
        () =>
          `extractPartsText: dropping unrecognized systemInstruction part (type=${partDesc})`,
      );
      return '';
    })
    .filter((text) => text.length > 0)
    .join('\n')
    .trim();
}

function describeUnrecognizedPart(part: unknown): string {
  if (part === null) return 'null';
  if (typeof part === 'object') {
    return `object(keys=${Object.keys(part).join(',')})`;
  }
  return typeof part;
}

/**
 * Merge chunk-level usage into the content recorded for telemetry.
 */
/**
 * Attach the newest usage the provider reported during a stream to the
 * assembled response. Same reason as
 * {@link contentForTelemetryPreservingUsage}: usage may arrive mid-stream
 * rather than on the final chunk (#3130).
 */
export function withReportedUsage(
  response: IContent,
  reportedUsage: UsageStats | undefined,
): IContent {
  if (reportedUsage === undefined) return response;
  return {
    ...response,
    metadata: { ...response.metadata, usage: reportedUsage },
  };
}

/**
 * Telemetry content for the newest chunk, carrying forward the most recently
 * reported usage when this chunk reports none.
 *
 * Providers do not all report usage on the final chunk; some report it once,
 * mid-stream. Taking the last chunk verbatim would then record a billed
 * request as having cost nothing (#3130).
 */
export function contentForTelemetryPreservingUsage(
  chunk: ModelStreamChunk,
  previous: IContent | undefined,
): IContent {
  const current = contentForTelemetry(chunk);
  if (current.metadata?.usage !== undefined) return current;
  const carried = previous?.metadata?.usage;
  if (carried === undefined) return current;
  return {
    ...current,
    metadata: { ...(current.metadata ?? {}), usage: carried },
  };
}

export function contentForTelemetry(chunk: ModelStreamChunk): IContent {
  if (chunk.usage === undefined) {
    return chunk.content;
  }
  return {
    ...chunk.content,
    metadata: {
      ...(chunk.content.metadata ?? {}),
      usage: chunk.usage,
    },
  };
}
