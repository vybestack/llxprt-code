/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readInvocationPolicyRecord } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
/**
 * Anthropic Request Preparation Module
 * Encapsulates the full request preparation pipeline from content to API-ready request body
 *
 * @issue #1572 - Decomposing AnthropicProvider (Step 5)
 */

import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type {
  IContent,
  SemanticMediaPurgeCacheWriteEvidence,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  parseOutputLimits,
  type OutputLimitConfig,
} from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import type { IProviderConfig } from '../types/IProviderConfig.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { ImageDimensionBudget } from '@vybestack/llxprt-code-tools/utils/imageDimensionBudget.js';
import type { ProviderToolset } from '../IProvider.js';
import type {
  AnthropicConversationConversionOptions,
  AnthropicMessage,
} from './AnthropicMessageNormalizer.js';
import { convertToAnthropicMessages } from './AnthropicMessageNormalizer.js';
import { attachAnchorCacheControl } from './AnthropicAnchorCache.js';
import {
  attachMediaPurgeCacheControl,
  clearMediaPurgeBoundaryTags,
} from './AnthropicMediaPurgeCache.js';
import { convertToolsToAnthropic } from './schemaConverter.js';
import {
  buildAnthropicSystemPrompt,
  attachPromptCaching,
  buildAnthropicRequestBody,
  sortObjectKeys,
} from './AnthropicRequestBuilder.js';
import {
  buildAnthropicNativeReasoningConfig,
  readAnthropicReasoningSettings,
  type AnthropicReasoningSettings,
} from './anthropic-reasoning-config.js';
import { getRetryConfig } from './AnthropicRateLimitHandler.js';
import {
  isAnthropicOAuthBaseURL,
  isZaiAnthropicEndpoint,
  ANTHROPIC_DEFAULT_BASE_URL,
} from './AnthropicEndpointUtils.js';
import {
  formatContextPrefix,
  type SystemPromptPlacement,
} from '../utils/systemPromptPlacement.js';
import {
  sanitizeAnthropicContentImages,
  resolveAnthropicImageBudget,
} from './AnthropicImageSanitizer.js';

/**
 * What the transport and the response path need to know about a request,
 * whatever form its body takes.
 */
export interface AnthropicRequestFacts {
  streamingEnabled: boolean;
  includeThinkingInResponse: boolean;
  wantCaching: boolean;
  ttl: '5m' | '1h';
  configEphemerals: Record<string, unknown>;
  maxAttempts: number;
  initialDelayMs: number;
  cacheLogger: { debug: (fn: () => string) => void };
  semanticMediaPurgeCacheWriteEvidence:
    | SemanticMediaPurgeCacheWriteEvidence
    | undefined;
}

/**
 * Request preparation context for a request whose body is a built object (the
 * projection route, which estimates the body before it is sent).
 */
export interface AnthropicRequestContext extends AnthropicRequestFacts {
  requestBody: Record<string, unknown>;
  anthropicMessages: AnthropicMessage[];
}

/**
 * Parameters for the request plan: everything a request is resolved from but
 * its history.
 */
export interface AnthropicPlanParams {
  tools: ProviderToolset | undefined;
  options: NormalizedGenerateChatOptions;
  isOAuth: boolean;
  placement: SystemPromptPlacement;
  providerName: string;
  config: OutputLimitConfig | undefined;
  getMaxTokensForModel: (model: string) => number;
  unprefixToolName: (name: string, isOAuth: boolean) => string;
  providerConfig: IProviderConfig | undefined;
  logger: DebugLogger;
  toolsLogger: DebugLogger;
  cacheLogger: { debug: (fn: () => string) => void };
}

/** Parameters for building a request from a history array. */
export interface PrepareRequestParams extends AnthropicPlanParams {
  content: IContent[];
}

/**
 * Helper to resolve CLI settings with fallback to options.settings
 */
function resolveCliSetting<T>(
  options: NormalizedGenerateChatOptions,
  key: string,
): T | undefined {
  const fromCli =
    typeof options.invocation.getCliSetting === 'function'
      ? options.invocation.getCliSetting(key)
      : undefined;
  return (fromCli ?? options.invocation.getEphemeral(key)) as T | undefined;
}

/**
 * Legacy normalized-option fixtures can omit the invocation modelBehavior
 * record; a missing record reads as empty so the options.settings fallbacks
 * supply the reasoning values.
 */
function readInvocationRecord(
  record: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
  return record ?? {};
}

type SemanticMediaPurgeMode = 'off' | 'remove' | 'summary';

function resolveSemanticMediaPurgeMode(
  options: NormalizedGenerateChatOptions,
): SemanticMediaPurgeMode {
  const value = resolveCliSetting<unknown>(options, 'media.semantic-purge');
  if (value === undefined || value === 'off') return 'off';
  if (value === 'remove' || value === 'summary') return value;
  const received =
    typeof value === 'string' ? JSON.stringify(value) : typeof value;
  throw new Error(
    `Invalid media.semantic-purge setting: expected 'off', 'remove', or 'summary'; received ${received}`,
  );
}

/**
 * Reasoning settings resolved from invocation
 */
export interface ReasoningSettings extends AnthropicReasoningSettings {
  stripFromContext: 'all' | 'allButLast' | 'none' | undefined;
  includeInContext: boolean | undefined;
  includeInResponse: boolean | undefined;
}

/**
 * Request settings resolved from options and config
 */
export interface RequestSettings {
  streamingEnabled: boolean;
  currentModel: string;
  requestOverrides: Record<string, unknown>;
  configEphemerals: Record<string, unknown>;
  wantCaching: boolean;
  ttl: '5m' | '1h';
}

function resolveRequestMaxTokens(
  defaultMaxTokens: number,
  requestOverrides: Record<string, unknown>,
): number {
  const override = requestOverrides['max_tokens'];
  if (
    typeof override === 'number' &&
    Number.isFinite(override) &&
    Number.isInteger(override) &&
    override > 0
  ) {
    return override;
  }
  return defaultMaxTokens;
}

/**
 * System context building result
 */
export interface SystemContextResult {
  systemField:
    | string
    | Array<{
        type: 'text';
        text: string;
        cache_control?: { type: 'ephemeral'; ttl: '5m' | '1h' };
      }>
    | undefined;
  messages: AnthropicMessage[];
}

/**
 * Resolve reasoning settings from invocation
 */
function resolveReasoningSettings(
  options: NormalizedGenerateChatOptions,
): ReasoningSettings {
  const nativeReasoning = readAnthropicReasoningSettings(
    readInvocationRecord(options.invocation.modelBehavior),
    {
      enabled: options.invocation.getEphemeral('reasoning.enabled'),
      effort: options.invocation.getEphemeral('reasoning.effort'),
      budgetTokens: options.invocation.getEphemeral('reasoning.budgetTokens'),
      adaptiveThinking: options.invocation.getEphemeral(
        'reasoning.adaptiveThinking',
      ),
      effortWireFormat: options.invocation.getEphemeral(
        'reasoning.effortWireFormat',
      ),
      enabledWireFormat: options.invocation.getEphemeral(
        'reasoning.enabledWireFormat',
      ),
      effortMap: options.invocation.getEphemeral('reasoning.effortMap'),
      enabledMap: options.invocation.getEphemeral('reasoning.enabledMap'),
    },
  );
  const stripFromContext = resolveCliSetting<'all' | 'allButLast' | 'none'>(
    options,
    'reasoning.stripFromContext',
  );
  const includeInContext = resolveCliSetting<boolean>(
    options,
    'reasoning.includeInContext',
  );
  const includeInResponse = resolveCliSetting<boolean>(
    options,
    'reasoning.includeInResponse',
  );

  return {
    ...nativeReasoning,
    stripFromContext,
    includeInContext,
    includeInResponse,
  };
}

/**
 * Resolve request settings from options and config
 */
function resolveRequestSettings(
  options: NormalizedGenerateChatOptions,
  providerName: string,
): RequestSettings {
  // Get streaming setting from ephemeral settings (default: enabled)
  const streamingSetting =
    options.invocation.getCliSetting('streaming') ??
    options.invocation.getEphemeral('streaming') ??
    readInvocationPolicyRecord(options.invocation.providerDefaults.ephemerals)[
      'streaming'
    ];
  const streamingEnabled =
    options.resolved.streaming ?? streamingSetting !== 'disabled';

  // Get current model
  const currentModel = options.resolved.model;

  // Get pre-separated model parameters from invocation context
  const requestOverrides: Record<string, unknown> = {
    ...options.invocation.modelParams,
  };

  // Translate generic maxOutputTokens ephemeral to Anthropic's max_tokens
  const rawMaxOutput = options.modelParameters
    ? options.modelParameters.genericMaxOutputTokens
    : options.invocation.getEphemeral('maxOutputTokens');
  const genericMaxOutput =
    typeof rawMaxOutput === 'number' &&
    Number.isFinite(rawMaxOutput) &&
    rawMaxOutput > 0
      ? rawMaxOutput
      : undefined;
  if (
    genericMaxOutput !== undefined &&
    requestOverrides['max_tokens'] === undefined
  ) {
    requestOverrides['max_tokens'] = genericMaxOutput;
  }

  const configEphemerals = options.invocation.ephemerals;

  // Get caching setting from options.settings or provider settings
  const providerSettings =
    options.invocation.getProviderOverrides<Record<string, unknown>>(
      providerName,
    ) ?? {};
  const cachingSetting =
    options.invocation.getEphemeral('prompt-caching') ??
    (providerSettings['prompt-caching'] as 'off' | '5m' | '1h' | undefined) ??
    '1h';
  const wantCaching = cachingSetting !== 'off';
  const ttl = cachingSetting === '1h' ? '1h' : '5m';

  return {
    streamingEnabled,
    currentModel,
    requestOverrides,
    configEphemerals,
    wantCaching,
    ttl,
  };
}

/**
 * Placement-only message selection (issue #3172). Positions the assembled
 * instruction at the top of the context when placement is `context-prefix`.
 *
 * This helper has NO reason to reference the resolved auth classification:
 * placement (WHERE the prompt goes) is independent of transport auth. The
 * vendor system field is determined separately by buildSystemField.
 */
export function placeSystemInstruction(params: {
  placement: SystemPromptPlacement;
  anthropicMessages: readonly AnthropicMessage[];
  wantCaching: boolean;
  ttl: '5m' | '1h';
  cacheLogger: { debug: (fn: () => string) => void };
  systemInstruction: string | undefined;
}): AnthropicMessage[] {
  const {
    placement,
    anthropicMessages,
    wantCaching,
    ttl,
    cacheLogger,
    systemInstruction,
  } = params;

  const messages = [...anthropicMessages];

  if (placement !== 'context-prefix') {
    return messages;
  }

  const systemMessage = systemInstruction ?? '';
  if (systemMessage === '') {
    return messages;
  }

  // Issue #3136: Anthropic under OAuth declares `context-prefix` placement —
  // its `system` field may carry ONLY the Claude Code string, so the real
  // prompt is unshifted to the TOP OF THE CONTEXT (never inside history).
  // The wrapper format is owned by the shared placement policy so this
  // provider does not re-derive it.
  const contextPrefixText = formatContextPrefix(systemMessage);

  if (wantCaching) {
    messages.unshift({
      role: 'user',
      content: [
        {
          type: 'text',
          text: contextPrefixText,
          cache_control: { type: 'ephemeral', ttl },
        } as {
          type: 'text';
          text: string;
          cache_control: { type: 'ephemeral'; ttl: '5m' | '1h' };
        },
      ],
    });
    cacheLogger.debug(
      () => 'Added cache_control to context-prefixed system instruction',
    );
  } else {
    messages.unshift({
      role: 'user',
      content: contextPrefixText,
    });
  }

  return messages;
}

/**
 * Build the vendor system field for context-prefix placement (issue #3172).
 * The field carries the Claude Code string when the resolved token is OAuth and
 * remains absent for non-OAuth transports using context-prefix placement.
 */
function buildContextPrefixSystemField(
  isOAuth: boolean,
  wantCaching: boolean,
  ttl: '5m' | '1h',
): SystemContextResult['systemField'] {
  if (!isOAuth) {
    return undefined;
  }
  return buildAnthropicSystemPrompt({
    isOAuth: true,
    wantCaching,
    ttl,
  });
}

function buildSystemField(params: {
  placement: SystemPromptPlacement;
  isOAuth: boolean;
  wantCaching: boolean;
  ttl: '5m' | '1h';
  systemInstruction: string | undefined;
}): SystemContextResult['systemField'] {
  const { placement, wantCaching, ttl, systemInstruction } = params;

  if (placement === 'system-field') {
    return buildAnthropicSystemPrompt({
      corePromptText: systemInstruction ?? '',
      isOAuth: false,
      wantCaching,
      ttl,
    });
  }

  return buildContextPrefixSystemField(params.isOAuth, wantCaching, ttl);
}

function assertPlacementCompatibleWithAuth(
  isOAuth: boolean,
  placement: SystemPromptPlacement,
): void {
  if (isOAuth && placement !== 'context-prefix') {
    throw new Error(
      `SystemPromptPlacementError: OAuth requires context-prefix placement but placement is ${placement} (issue #3172).`,
    );
  }
}

/**
 * Build thinking configuration and request body
 */
function buildThinkingAndRequestBody(params: {
  currentModel: string;
  reasoningSettings: ReasoningSettings;
  providerName: string;
  logger: DebugLogger;
  anthropicMessages: AnthropicMessage[];
  systemField:
    | string
    | Array<{
        type: 'text';
        text: string;
        cache_control?: { type: 'ephemeral'; ttl: '5m' | '1h' };
      }>
    | undefined;
  anthropicTools:
    | Array<{ name: string; input_schema: { properties?: unknown } }>
    | undefined;
  getMaxTokensForModel: (model: string) => number;
  streamingEnabled: boolean;
  requestOverrides: Record<string, unknown>;
}): Record<string, unknown> {
  const nativeReasoning = buildAnthropicNativeReasoningConfig({
    settings: params.reasoningSettings,
    modelParams: params.requestOverrides,
    model: params.currentModel,
    providerName: params.providerName,
    includeInResponse: params.reasoningSettings.includeInResponse,
    logger: params.logger,
  });

  return buildAnthropicRequestBody({
    model: params.currentModel,
    messages: params.anthropicMessages,
    system: params.systemField,
    tools:
      params.anthropicTools && params.anthropicTools.length > 0
        ? params.anthropicTools
        : undefined,
    maxTokens: resolveRequestMaxTokens(
      params.getMaxTokensForModel(params.currentModel),
      params.requestOverrides,
    ),
    streamingEnabled: params.streamingEnabled,
    modelParams: params.requestOverrides,
    thinking: nativeReasoning.thinking,
    outputConfig: nativeReasoning.outputConfig,
  });
}

type AnthropicToolList = Array<{
  name: string;
  input_schema: { properties?: unknown };
}>;

/** The options the message conversion (array route and table route) runs with. */
function conversionOptionsOf(params: {
  isOAuth: boolean;
  reasoningSettings: ReasoningSettings;
  config: OutputLimitConfig | undefined;
  currentModel: string;
  currentBaseURL: string | undefined;
  supportsUrlImages: boolean;
  unprefixToolName: (name: string, isOAuth: boolean) => string;
  logger: DebugLogger;
}): AnthropicConversationConversionOptions {
  const { reasoningSettings } = params;
  return {
    isOAuth: params.isOAuth,
    stripFromContext: reasoningSettings.stripFromContext,
    includeInContext: reasoningSettings.includeInContext,
    reasoningEnabled: reasoningSettings.enabled === true,
    config: params.config,
    currentModel: params.currentModel,
    currentBaseURL: params.currentBaseURL,
    supportsUrlImages: params.supportsUrlImages,
    unprefixToolName: params.unprefixToolName,
    logger: params.logger,
  };
}

/** Convert tools to Anthropic format and stabilize ordering. */
function convertToolset(
  tools: ProviderToolset | undefined,
  isOAuth: boolean,
): AnthropicToolList | undefined {
  const anthropicTools = convertToolsToAnthropic(tools, isOAuth);
  if (!anthropicTools || anthropicTools.length === 0) return anthropicTools;
  return [...anthropicTools]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((tool) => {
      const schema = tool.input_schema;
      if (schema.properties) {
        return {
          ...tool,
          input_schema: {
            ...schema,
            properties: sortObjectKeys(schema.properties),
          },
        };
      }
      return tool;
    });
}

/**
 * Log request debug information
 */
function logRequestDebugInfo(params: {
  anthropicTools:
    | Array<{ name: string; input_schema: { properties?: unknown } }>
    | undefined;
  requestBody: Record<string, unknown>;
  anthropicMessages: AnthropicMessage[];
  toolsLogger: DebugLogger;
  logger: DebugLogger;
}): void {
  const {
    anthropicTools,
    requestBody,
    anthropicMessages,
    toolsLogger,
    logger,
  } = params;

  // Debug log the tools being sent to Anthropic
  if (anthropicTools && anthropicTools.length > 0) {
    toolsLogger.debug(() => `[AnthropicProvider] Sending tools to API:`, {
      toolCount: anthropicTools.length,
      toolNames: anthropicTools.map((t) => t.name),
      firstTool: anthropicTools[0],
      requestHasTools: 'tools' in requestBody,
    });
  }

  // Debug log thinking blocks in messages
  const messagesWithThinking = anthropicMessages.filter(
    (m) =>
      m.role === 'assistant' &&
      Array.isArray(m.content) &&
      m.content.some((b) => (b as { type?: string }).type === 'thinking'),
  );
  if (messagesWithThinking.length > 0) {
    logger.debug(
      () =>
        `[AnthropicProvider] Messages with thinking blocks: ${messagesWithThinking.length}`,
    );
  }
}

export function applyRequestCacheControls(params: {
  readonly systemContext: SystemContextResult;
  readonly requestSettings: RequestSettings;
  readonly cacheLogger: { debug: (fn: () => string) => void };
  readonly wantCaching: boolean;
  readonly wantMediaPurgeCacheAnchor: boolean;
}): SemanticMediaPurgeCacheWriteEvidence | undefined {
  if (!params.wantCaching) {
    clearMediaPurgeBoundaryTags(params.systemContext.messages);
    return undefined;
  }
  attachPromptCaching(
    params.systemContext.messages,
    params.requestSettings.ttl,
    params.cacheLogger,
  );
  attachAnchorCacheControl(
    params.systemContext.messages,
    params.requestSettings.ttl,
    params.cacheLogger,
  );
  if (!params.wantMediaPurgeCacheAnchor) {
    clearMediaPurgeBoundaryTags(params.systemContext.messages);
    return undefined;
  }
  return attachMediaPurgeCacheControl(
    params.systemContext.messages,
    params.requestSettings.ttl,
    params.cacheLogger,
  );
}

/** Everything about a request but its body. */
export function requestFactsOf(
  plan: AnthropicRequestPlan,
  cacheLogger: { debug: (fn: () => string) => void },
  semanticMediaPurgeCacheWriteEvidence:
    | SemanticMediaPurgeCacheWriteEvidence
    | undefined,
): AnthropicRequestFacts {
  const { requestSettings, reasoningSettings } = plan;
  const { maxAttempts, initialDelayMs } = getRetryConfig(
    requestSettings.configEphemerals,
  );
  return {
    streamingEnabled: requestSettings.streamingEnabled,
    includeThinkingInResponse: reasoningSettings.includeInResponse !== false,
    wantCaching: plan.wantCaching,
    ttl: requestSettings.ttl,
    configEphemerals: requestSettings.configEphemerals,
    maxAttempts,
    initialDelayMs,
    cacheLogger,
    semanticMediaPurgeCacheWriteEvidence,
  };
}

/**
 * The request body with an empty `messages` array in its key position, and
 * everything else final. The table route writes the messages in that position.
 */
export function buildRequestEnvelope(
  plan: AnthropicRequestPlan,
  params: AnthropicPlanParams,
  anthropicMessages: AnthropicMessage[] = [],
): Record<string, unknown> {
  const requestBody = buildThinkingAndRequestBody({
    currentModel: plan.requestSettings.currentModel,
    reasoningSettings: plan.reasoningSettings,
    providerName: params.providerName,
    logger: params.logger,
    anthropicMessages,
    systemField: plan.systemField,
    anthropicTools: plan.anthropicTools,
    getMaxTokensForModel: params.getMaxTokensForModel,
    streamingEnabled: plan.requestSettings.streamingEnabled,
    requestOverrides: plan.requestSettings.requestOverrides,
  });
  logRequestDebugInfo({
    anthropicTools: plan.anthropicTools,
    requestBody,
    anthropicMessages,
    toolsLogger: params.toolsLogger,
    logger: params.logger,
  });
  return requestBody;
}

/**
 * Everything a request needs before its messages exist: the settings, the
 * conversion options, the tools and the system field. The array route and the
 * table route both start here, so they cannot disagree about the request.
 */
export interface AnthropicRequestPlan {
  readonly reasoningSettings: ReasoningSettings;
  readonly requestSettings: RequestSettings;
  readonly conversion: AnthropicConversationConversionOptions;
  readonly imageBudget: ImageDimensionBudget | undefined;
  readonly anthropicTools: AnthropicToolList | undefined;
  readonly systemField: SystemContextResult['systemField'];
  /** Prompt caching in effect: asked for and the endpoint is native. */
  readonly wantCaching: boolean;
  readonly wantMediaPurgeCacheAnchor: boolean;
}

/**
 * Resolves the plan of a request (issue #3172 placement included): placement
 * controls WHERE the assembled instruction goes; the resolved auth
 * classification independently controls the vendor-required system field. The
 * impossible OAuth/system-field combination fails here rather than dropping or
 * misplacing bytes.
 */
export function planAnthropicRequest(
  params: AnthropicPlanParams,
): AnthropicRequestPlan {
  const semanticMediaPurgeMode = resolveSemanticMediaPurgeMode(params.options);
  const reasoningSettings = resolveReasoningSettings(params.options);

  params.logger.debug(
    () =>
      `[AnthropicProvider] Reasoning settings from invocation.modelBehavior (fallback to options.settings): enabled=${String(reasoningSettings.enabled)}, budgetTokens=${String(reasoningSettings.budgetTokens)}, stripFromContext=${String(reasoningSettings.stripFromContext)}, includeInContext=${String(reasoningSettings.includeInContext)}`,
  );

  assertPlacementCompatibleWithAuth(params.isOAuth, params.placement);
  const requestSettings = resolveRequestSettings(
    params.options,
    params.providerName,
  );

  // Issue #2410: z.ai and other third-party Anthropic-compatible endpoints
  // reject the prompt-cache `system` array format
  // ([{type:'text', text:'...', cache_control:{...}}]). Only emit cache_control
  // when the request targets the native Anthropic API. Reusing the OAuth
  // eligibility helper avoids duplicating the hostname check.
  const wantCaching =
    requestSettings.wantCaching &&
    isAnthropicOAuthBaseURL(params.options.resolved.baseURL);

  if (!wantCaching && requestSettings.wantCaching) {
    params.cacheLogger.debug(
      () =>
        `Prompt caching disabled: base URL (${params.options.resolved.baseURL ?? '<unset>'}) is not a native Anthropic endpoint`,
    );
  }

  if (wantCaching) {
    params.cacheLogger.debug(
      () => `Prompt caching enabled with TTL: ${requestSettings.ttl}`,
    );
  }

  return {
    reasoningSettings,
    requestSettings,
    conversion: conversionOptionsOf({
      isOAuth: params.isOAuth,
      reasoningSettings,
      config: parseOutputLimits(params.options.invocation.ephemerals),
      currentModel: params.options.resolved.model,
      currentBaseURL:
        params.options.resolved.baseURL ?? ANTHROPIC_DEFAULT_BASE_URL,
      // Issue #3693: zai's Anthropic-compatible endpoint rejects
      // source:{type:'url'} image blocks; url-encoded images serialize as the
      // unsupported-media placeholder on zai hosts only.
      supportsUrlImages: !isZaiAnthropicEndpoint(
        params.options.resolved.baseURL,
      ),
      unprefixToolName: params.unprefixToolName,
      logger: params.logger,
    }),
    // Issue #3216: proactively sanitize oversized image blocks before
    // conversion, so known-invalid bytes never reach the wire. The budget is
    // resolved from invocation ephemerals (the stateless per-call source of
    // truth), NOT from config.getEphemeralSettings; an undefined budget
    // replaces nothing.
    imageBudget: resolveAnthropicImageBudget(
      params.options.invocation.ephemerals,
    ),
    anthropicTools: convertToolset(params.tools, params.isOAuth),
    systemField: buildSystemField({
      placement: params.placement,
      isOAuth: params.isOAuth,
      wantCaching,
      ttl: requestSettings.ttl,
      systemInstruction: params.options.systemInstruction,
    }),
    wantCaching,
    wantMediaPurgeCacheAnchor:
      semanticMediaPurgeMode === 'remove' ||
      semanticMediaPurgeMode === 'summary',
  };
}

/**
 * Prepare complete Anthropic API request context
 */
export async function prepareAnthropicRequest(
  params: PrepareRequestParams,
): Promise<AnthropicRequestContext> {
  const plan = planAnthropicRequest(params);
  const sanitizedContent = sanitizeAnthropicContentImages(
    params.content,
    plan.imageBudget,
  );
  const messages = placeSystemInstruction({
    placement: params.placement,
    anthropicMessages: convertToAnthropicMessages(
      sanitizedContent.contents,
      plan.conversion,
    ),
    wantCaching: plan.wantCaching,
    ttl: plan.requestSettings.ttl,
    cacheLogger: params.cacheLogger,
    systemInstruction: params.options.systemInstruction,
  });
  const semanticMediaPurgeCacheWriteEvidence = applyRequestCacheControls({
    systemContext: { systemField: plan.systemField, messages },
    requestSettings: plan.requestSettings,
    cacheLogger: params.cacheLogger,
    wantCaching: plan.wantCaching,
    wantMediaPurgeCacheAnchor: plan.wantMediaPurgeCacheAnchor,
  });
  return {
    ...requestFactsOf(
      plan,
      params.cacheLogger,
      semanticMediaPurgeCacheWriteEvidence,
    ),
    requestBody: buildRequestEnvelope(plan, params, messages),
    anthropicMessages: messages,
  };
}
