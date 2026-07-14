/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Pure request-preparation helpers extracted from StreamProcessor.
 *
 * These functions build the request payload, select tools, apply hook
 * modifications, and resolve provider-runtime values. They take explicit
 * params (no shared mutable state) so they can be unit-tested in isolation.
 */

import type { BeforeModelHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
import { ContentConverters } from '@vybestack/llxprt-code-core/services/history/ContentConverters.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { SendMessageParams } from './chatSession.js';
import { logApiRequest } from './turnLogging.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { AgentClientGenerateConfig } from '@vybestack/llxprt-code-core/core/clientContract.js';

export type ToolGroupArray = Array<{
  functionDeclarations?: Array<{
    name: string;
    description?: string;
    parametersJsonSchema?: unknown;
  }>;
}>;

export interface ToolSelectionHookResult {
  tools: unknown;
  allowedFunctionNames: string[] | undefined;
}

/** Result of preparing a request payload with its runtime contexts. */
export interface PreparedRequest {
  requestPayload: { contents: IContent[]; tools: unknown };
  baseRuntimeContext: ProviderRuntimeContext;
}

/**
 * Build the request contents (curated IContent[]) and pending IContent[]
 * from user input. Returns both the provider-ready contents and the raw
 * pending items so downstream enforcement can thread the pending boundary
 * explicitly (issue #2304).
 */
export function buildRequestContentsResult(
  userContents: IContent | IContent[],
  historyService: HistoryService,
): { contents: IContent[]; pending: IContent[] } {
  const inputArray = Array.isArray(userContents)
    ? userContents
    : [userContents];
  const userIContents: IContent[] = inputArray.map((content) => {
    const turnKey = historyService.generateTurnKey();
    const idGen = historyService.getIdGeneratorCallback(turnKey);
    return {
      ...content,
      metadata: { ...(content.metadata ?? {}), id: idGen(), turnId: turnKey },
    };
  });
  return {
    contents: historyService.getCuratedForProvider(userIContents),
    pending: userIContents,
  };
}

/**
 * Select the tools for the request from params or the fallback generationConfig.
 */
export function selectRequestTools(
  params: SendMessageParams,
  fallbackTools: unknown,
): unknown {
  return params.config?.tools ?? fallbackTools;
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

interface PrepareRequestPayloadParams {
  requestContents: IContent[];
  tools: unknown;
  logger: DebugLogger;
  providerRuntimeBuilder: (
    source: string,
    extras?: Record<string, unknown>,
  ) => ProviderRuntimeContext;
  providerName: string;
  modelName: string;
  baseUrl: string | undefined;
}

/**
 * Prepare the request payload (contents + tools) and the base provider runtime
 * context. The request-specific runtime context (e.g. abort-signal metadata) is
 * layered on by the caller via buildRuntimeContext.
 */
export function prepareRequestPayload(
  args: PrepareRequestPayloadParams,
): PreparedRequest {
  args.logger.debug(
    () => '[StreamProcessor] Calling provider.generateChatCompletion',
    {
      providerName: args.providerName,
      model: args.modelName,
      historyLength: args.requestContents.length,
      toolCount: Array.isArray(args.tools) ? args.tools.length : 0,
      baseUrl: args.baseUrl,
    },
  );

  const baseRuntimeContext = args.providerRuntimeBuilder(
    'StreamProcessor.generateRequest',
    { historyLength: args.requestContents.length },
  );

  const requestPayload = { contents: args.requestContents, tools: args.tools };

  return { requestPayload, baseRuntimeContext };
}

/**
 * Type guard: true when a value is a non-null object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Type guard: true when the hook output's llm_request actually contains a
 * messages array (i.e., the hook intends to REPLACE the conversation
 * contents). A hook that supplies llm_request with only model/config fields
 * (no messages) does NOT intend to replace contents — in that case the
 * original IContent[] must be preserved (tool calls, IDs, metadata would be
 * destroyed by the text-only translator round-trip).
 *
 * Shared by both call sites (applyRequestModifications and
 * DirectMessageProcessor._handleBeforeModelHook) to avoid drift.
 */
export function hookProvidedMessages(
  beforeModelResult: BeforeModelHookOutput | undefined,
): boolean {
  if (!beforeModelResult) return false;
  const hookSpecificOutput = beforeModelResult.hookSpecificOutput;
  if (!isRecord(hookSpecificOutput)) return false;
  const llmRequest = hookSpecificOutput['llm_request'];
  if (!isRecord(llmRequest)) return false;
  return Array.isArray(llmRequest['messages']);
}

/**
 * Apply LLM request modifications from a BeforeModel hook result.
 *
 * When the hook output contains NO llm_request field (or an llm_request with
 * NO messages array — only model/config overrides), the ORIGINAL
 * requestContents array is returned (reference-equal) so callers can detect
 * "no content modification" via reference equality, and so tool calls, IDs,
 * and metadata are preserved (the text-only hook translator round-trip would
 * otherwise destroy them). Contents are ONLY replaced when the hook actually
 * supplied replacement messages.
 */
export function applyRequestModifications(
  beforeModelResult: BeforeModelHookOutput | undefined,
  requestContents: IContent[],
  model: string,
): IContent[] {
  if (!beforeModelResult) return requestContents;

  // H2: only round-trip through the translator when the hook actually
  // supplied replacement messages. A messages-less llm_request (model/config
  // only) must preserve the original contents reference.
  if (!hookProvidedMessages(beforeModelResult)) {
    return requestContents;
  }

  const target = {
    model: model || '',
    contents: ContentConverters.toGeminiContents(requestContents),
  };
  // hookProvidedMessages guarantees llm_request has a messages array, so
  // applyLLMRequestModifications always returns a new object here
  // ({...target, ...sdkRequest}); the meaningful condition is whether the
  // merged request carries usable contents.
  const modifiedRequest =
    beforeModelResult.applyLLMRequestModifications(target);
  const modifiedContents = (modifiedRequest as { contents?: unknown }).contents;
  if (modifiedContents !== undefined && modifiedContents !== null) {
    // The hook wire adapter returns Gemini-shaped contents; convert back
    // to neutral IContent[] via toIContents at the boundary.
    const converted = ContentConverters.toIContents(
      modifiedContents as Parameters<typeof ContentConverters.toIContents>[0],
    );
    // Guard: if the hook supplied llm_request.messages: [] (empty array) —
    // which converts to an empty contents array — treat it as "no
    // modification" and return the ORIGINAL reference. An empty contents
    // array would silently erase the entire conversation (and break the
    // provider call); returning the original reference keeps the caller's
    // boundary detection authoritative.
    if (converted.length === 0) {
      return requestContents;
    }
    return converted;
  }
  return requestContents;
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

/**
 * Log the outgoing API request via the telemetry runtime context.
 */
export function logOutgoingRequest(
  runtimeContext: AgentRuntimeContext,
  requestPayload: { contents: IContent[] },
  modelName: string,
  promptId: string,
): void {
  logApiRequest(
    runtimeContext,
    runtimeContext.state,
    requestPayload.contents,
    modelName,
    promptId,
  );
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
