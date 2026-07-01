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

import type {
  Content,
  GenerateContentResponse,
  SendMessageParameters,
} from '@google/genai';
import { FinishReason, type GenerateContentConfig } from '@google/genai';
import type { BeforeModelHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
import { ContentConverters } from '@vybestack/llxprt-code-core/services/history/ContentConverters.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { logApiRequest } from './turnLogging.js';
import type { ConversationManager } from './ConversationManager.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

export type ToolGroupArray = Array<{
  functionDeclarations?: Array<{
    name: string;
    description?: string;
    parametersJsonSchema?: unknown;
  }>;
}>;

export interface ToolSelectionHookResult {
  tools: GenerateContentConfig['tools'];
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
  userContent: Content | Content[],
  conversationManager: ConversationManager,
  historyService: HistoryService,
): { contents: IContent[]; pending: IContent[] } {
  const matcher = conversationManager.makePositionMatcher();
  if (Array.isArray(userContent)) {
    const userIContents = userContent.map((content) => {
      const turnKey = historyService.generateTurnKey();
      const idGen = historyService.getIdGeneratorCallback(turnKey);
      return ContentConverters.toIContent(content, idGen, matcher, turnKey);
    });
    return {
      contents: historyService.getCuratedForProvider(userIContents),
      pending: userIContents,
    };
  }
  const turnKey = historyService.generateTurnKey();
  const idGen = historyService.getIdGeneratorCallback(turnKey);
  const userIContent = ContentConverters.toIContent(
    userContent,
    idGen,
    matcher,
    turnKey,
  );
  return {
    contents: historyService.getCuratedForProvider([userIContent]),
    pending: [userIContent],
  };
}

/**
 * Select the tools for the request from params or the fallback generationConfig.
 */
export function selectRequestTools(
  params: SendMessageParameters,
  fallbackTools: GenerateContentConfig['tools'],
): GenerateContentConfig['tools'] {
  return params.config?.tools ?? fallbackTools;
}

/**
 * Merge the base runtime context with request params. When the request config
 * carries an abort signal, surface it via runtime metadata while preserving the
 * original Config instance untouched.
 */
export function buildRuntimeContext(
  baseRuntimeContext: ProviderRuntimeContext,
  params: SendMessageParameters,
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
  tools: GenerateContentConfig['tools'];
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
      toolCount: args.tools?.length ?? 0,
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
 * Patch a synthetic response that is missing a finishReason.
 */
export function patchMissingFinishReason(
  syntheticResponse: GenerateContentResponse,
  candidate: NonNullable<GenerateContentResponse['candidates']>[0],
): GenerateContentResponse {
  return {
    ...syntheticResponse,
    candidates: [{ ...candidate, finishReason: FinishReason.STOP }],
  } as GenerateContentResponse;
}

/**
 * Apply LLM request modifications from a BeforeModel hook result.
 */
export function applyRequestModifications(
  beforeModelResult: BeforeModelHookOutput | undefined,
  requestContents: IContent[],
  model: string,
): IContent[] {
  if (!beforeModelResult) return requestContents;

  const modifiedRequest = beforeModelResult.applyLLMRequestModifications({
    model: model || '',
    contents: ContentConverters.toGeminiContents(requestContents),
  });
  const modifiedContents = (modifiedRequest as { contents?: Content[] | null })
    .contents;
  if (modifiedContents !== undefined && modifiedContents !== null) {
    return ContentConverters.toIContents(modifiedContents);
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
    ContentConverters.toGeminiContents(requestPayload.contents),
    modelName,
    promptId,
  );
}
