/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { IProviderConfig } from '../types/IProviderConfig.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { ProviderToolset } from '../IProvider.js';
import type { AnthropicMessage } from './AnthropicMessageNormalizer.js';
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
 * Request preparation context returned to caller
 */
export interface AnthropicRequestContext {
  requestBody: Record<string, unknown>;
  anthropicMessages: AnthropicMessage[];
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
 * Parameters for request preparation
 */
export interface PrepareRequestParams {
  content: IContent[];
  tools: ProviderToolset | undefined;
  options: NormalizedGenerateChatOptions;
  isOAuth: boolean;
  placement: SystemPromptPlacement;
  providerName: string;
  config: Config | undefined;
  getMaxTokensForModel: (model: string) => number;
  unprefixToolName: (name: string, isOAuth: boolean) => string;
  providerConfig: IProviderConfig | undefined;
  logger: DebugLogger;
  toolsLogger: DebugLogger;
  cacheLogger: { debug: (fn: () => string) => void };
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
  return (fromCli ?? options.settings.get(key)) as T | undefined;
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
interface ReasoningSettings extends AnthropicReasoningSettings {
  stripFromContext: 'all' | 'allButLast' | 'none' | undefined;
  includeInContext: boolean | undefined;
  includeInResponse: boolean | undefined;
}

/**
 * Request settings resolved from options and config
 */
interface RequestSettings {
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
interface SystemContextResult {
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
      enabled: options.settings.get('reasoning.enabled'),
      effort: options.settings.get('reasoning.effort'),
      budgetTokens: options.settings.get('reasoning.budgetTokens'),
      adaptiveThinking: options.settings.get('reasoning.adaptiveThinking'),
      effortWireFormat: options.settings.get('reasoning.effortWireFormat'),
      enabledWireFormat: options.settings.get('reasoning.enabledWireFormat'),
      effortMap: options.settings.get('reasoning.effortMap'),
      enabledMap: options.settings.get('reasoning.enabledMap'),
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
  providerConfig: IProviderConfig | undefined,
  providerName: string,
): RequestSettings {
  // Get streaming setting from ephemeral settings (default: enabled)
  const invocationEphemerals = options.invocation.ephemerals;
  const providerEphemerals = providerConfig?.getEphemeralSettings?.();
  const streamingSetting =
    (invocationEphemerals['streaming'] as string | undefined) ??
    providerEphemerals?.['streaming'];
  const streamingEnabled = streamingSetting !== 'disabled';

  // Get current model
  const currentModel = options.resolved.model;

  // Get pre-separated model parameters from invocation context
  const requestOverrides: Record<string, unknown> = {
    ...options.invocation.modelParams,
  };

  // Translate generic maxOutputTokens ephemeral to Anthropic's max_tokens
  const rawMaxOutput = options.settings.get('maxOutputTokens');
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

  const configEphemerals = invocationEphemerals;

  // Get caching setting from options.settings or provider settings
  const providerSettings = options.settings.getProviderSettings(providerName);
  const cachingSetting =
    (options.settings.get('prompt-caching') as
      | 'off'
      | '5m'
      | '1h'
      | undefined) ??
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
function placeSystemInstruction(params: {
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
 * Build system context (issue #3172). Placement controls WHERE the assembled
 * instruction goes; the resolved auth classification independently controls
 * the vendor-required system field. Fail fast for the impossible
 * OAuth/system-field combination rather than dropping or misplacing bytes.
 */
function buildSystemContext(params: {
  placement: SystemPromptPlacement;
  isOAuth: boolean;
  anthropicMessages: readonly AnthropicMessage[];
  wantCaching: boolean;
  ttl: '5m' | '1h';
  cacheLogger: { debug: (fn: () => string) => void };
  systemInstruction: string | undefined;
}): SystemContextResult {
  // OAuth requires context-prefix placement: the system field must carry ONLY
  // the Claude Code string, so the assembled prompt must go at the top of the
  // context. OAuth + system-field is impossible and must fail fast rather than
  // drop or misplace prompt bytes.
  assertPlacementCompatibleWithAuth(params.isOAuth, params.placement);

  const messages = placeSystemInstruction({
    placement: params.placement,
    anthropicMessages: params.anthropicMessages,
    wantCaching: params.wantCaching,
    ttl: params.ttl,
    cacheLogger: params.cacheLogger,
    systemInstruction: params.systemInstruction,
  });

  const systemField = buildSystemField({
    placement: params.placement,
    isOAuth: params.isOAuth,
    wantCaching: params.wantCaching,
    ttl: params.ttl,
    systemInstruction: params.systemInstruction,
  });

  return { systemField, messages };
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

/**
 * Convert messages and tools to Anthropic format with stable ordering
 */
function convertMessagesAndTools(params: {
  content: IContent[];
  tools: ProviderToolset | undefined;
  isOAuth: boolean;
  reasoningSettings: ReasoningSettings;
  config: Config | undefined;
  currentModel: string;
  currentBaseURL: string | undefined;
  unprefixToolName: (name: string, isOAuth: boolean) => string;
  logger: DebugLogger;
}): {
  anthropicMessages: AnthropicMessage[];
  anthropicTools:
    | Array<{ name: string; input_schema: { properties?: unknown } }>
    | undefined;
} {
  const {
    content,
    tools,
    reasoningSettings,
    config,
    currentModel,
    currentBaseURL,
    unprefixToolName,
    logger,
  } = params;

  // Convert IContent to Anthropic API format
  const anthropicMessages = convertToAnthropicMessages(content, {
    isOAuth: params.isOAuth,
    stripFromContext: reasoningSettings.stripFromContext,
    includeInContext: reasoningSettings.includeInContext,
    reasoningEnabled: reasoningSettings.enabled === true,
    config,
    currentModel,
    currentBaseURL,
    unprefixToolName,
    logger,
  });

  // Convert tools to Anthropic format and stabilize ordering
  let anthropicTools = convertToolsToAnthropic(tools, params.isOAuth);

  if (anthropicTools && anthropicTools.length > 0) {
    anthropicTools = [...anthropicTools]
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

  return { anthropicMessages, anthropicTools };
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

function applyRequestCacheControls(params: {
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

function buildRequestContext(params: {
  reasoningSettings: ReasoningSettings;
  requestSettings: RequestSettings;
  anthropicTools:
    | Array<{ name: string; input_schema: { properties?: unknown } }>
    | undefined;
  systemContext: SystemContextResult;
  getMaxTokensForModel: (model: string) => number;
  providerName: string;
  cacheLogger: { debug: (fn: () => string) => void };
  toolsLogger: DebugLogger;
  logger: DebugLogger;
  wantCaching: boolean;
  wantMediaPurgeCacheAnchor: boolean;
}): AnthropicRequestContext {
  const {
    reasoningSettings,
    requestSettings,
    anthropicTools,
    systemContext,
    getMaxTokensForModel,
    providerName,
    cacheLogger,
    toolsLogger,
    logger,
    wantCaching,
    wantMediaPurgeCacheAnchor,
  } = params;

  const semanticMediaPurgeCacheWriteEvidence = applyRequestCacheControls({
    systemContext,
    requestSettings,
    cacheLogger,
    wantCaching,
    wantMediaPurgeCacheAnchor,
  });

  const requestBody = buildThinkingAndRequestBody({
    currentModel: requestSettings.currentModel,
    reasoningSettings,
    providerName,
    logger,
    anthropicMessages: systemContext.messages,
    systemField: systemContext.systemField,
    anthropicTools,
    getMaxTokensForModel,
    streamingEnabled: requestSettings.streamingEnabled,
    requestOverrides: requestSettings.requestOverrides,
  });

  logRequestDebugInfo({
    anthropicTools,
    requestBody,
    anthropicMessages: systemContext.messages,
    toolsLogger,
    logger,
  });

  const { maxAttempts, initialDelayMs } = getRetryConfig(
    requestSettings.configEphemerals,
  );

  return {
    requestBody,
    anthropicMessages: systemContext.messages,
    streamingEnabled: requestSettings.streamingEnabled,
    includeThinkingInResponse: reasoningSettings.includeInResponse !== false,
    wantCaching,
    ttl: requestSettings.ttl,
    configEphemerals: requestSettings.configEphemerals,
    maxAttempts,
    initialDelayMs,
    cacheLogger,
    semanticMediaPurgeCacheWriteEvidence,
  };
}

/**
 * Prepare complete Anthropic API request context
 */
export async function prepareAnthropicRequest(
  params: PrepareRequestParams,
): Promise<AnthropicRequestContext> {
  const semanticMediaPurgeMode = resolveSemanticMediaPurgeMode(params.options);
  const reasoningSettings = resolveReasoningSettings(params.options);

  params.logger.debug(
    () =>
      `[AnthropicProvider] Reasoning settings from invocation.modelBehavior (fallback to options.settings): enabled=${String(reasoningSettings.enabled)}, budgetTokens=${String(reasoningSettings.budgetTokens)}, stripFromContext=${String(reasoningSettings.stripFromContext)}, includeInContext=${String(reasoningSettings.includeInContext)}`,
  );

  const configForMessages = params.config ?? params.options.runtime?.config;

  // Issue #3216: proactively sanitize oversized image blocks from the neutral
  // history before conversion, so known-invalid bytes never reach the wire.
  // The budget is resolved from invocation ephemerals (the stateless per-call
  // source of truth), NOT from config.getEphemeralSettings — the stateless
  // contract guarantees config is never accessed for request overrides.
  // sanitizeAnthropicContentImages already returns the contents unchanged
  // (0 replacements) when the budget is undefined, so no fallback is needed.
  const configEphemeralsForBudget: Readonly<Record<string, unknown>> =
    params.options.invocation.ephemerals;
  const sanitizedContent = sanitizeAnthropicContentImages(
    params.content,
    resolveAnthropicImageBudget(configEphemeralsForBudget),
  );

  const { anthropicMessages, anthropicTools } = convertMessagesAndTools({
    content: sanitizedContent.contents,
    tools: params.tools,
    isOAuth: params.isOAuth,
    reasoningSettings,
    config: configForMessages,
    currentModel: params.options.resolved.model,
    currentBaseURL:
      params.options.resolved.baseURL ?? ANTHROPIC_DEFAULT_BASE_URL,
    unprefixToolName: params.unprefixToolName,
    logger: params.logger,
  });

  const requestSettings = resolveRequestSettings(
    params.options,
    params.providerConfig,
    params.providerName,
  );

  // Issue #2410: z.ai and other third-party Anthropic-compatible endpoints
  // reject the prompt-cache `system` array format
  // ([{type:'text', text:'...', cache_control:{...}}]). Only emit cache_control
  // when the request targets the native Anthropic API. Reusing the OAuth
  // eligibility helper avoids duplicating the hostname check.
  const effectiveWantCaching =
    requestSettings.wantCaching &&
    isAnthropicOAuthBaseURL(params.options.resolved.baseURL);

  if (!effectiveWantCaching && requestSettings.wantCaching) {
    params.cacheLogger.debug(
      () =>
        `Prompt caching disabled: base URL (${params.options.resolved.baseURL ?? '<unset>'}) is not a native Anthropic endpoint`,
    );
  }

  if (effectiveWantCaching) {
    params.cacheLogger.debug(
      () => `Prompt caching enabled with TTL: ${requestSettings.ttl}`,
    );
  }

  const systemContext = buildSystemContext({
    placement: params.placement,
    isOAuth: params.isOAuth,
    anthropicMessages,
    wantCaching: effectiveWantCaching,
    ttl: requestSettings.ttl,
    cacheLogger: params.cacheLogger,
    systemInstruction: params.options.systemInstruction,
  });

  return buildRequestContext({
    reasoningSettings,
    requestSettings,
    anthropicTools,
    systemContext,
    getMaxTokensForModel: params.getMaxTokensForModel,
    providerName: params.providerName,
    cacheLogger: params.cacheLogger,
    toolsLogger: params.toolsLogger,
    logger: params.logger,
    wantCaching: effectiveWantCaching,
    wantMediaPurgeCacheAnchor:
      semanticMediaPurgeMode === 'remove' ||
      semanticMediaPurgeMode === 'summary',
  });
}
