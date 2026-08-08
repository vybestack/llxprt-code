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

import { supportsAdaptiveThinking } from './AnthropicModelData.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { IProviderConfig } from '../types/IProviderConfig.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { ProviderToolset } from '../IProvider.js';
import type { AnthropicMessage } from './AnthropicMessageNormalizer.js';
import { convertToAnthropicMessages } from './AnthropicMessageNormalizer.js';
import { attachAnchorCacheControl } from './AnthropicAnchorCache.js';
import { convertToolsToAnthropic } from './schemaConverter.js';
import {
  buildAnthropicSystemPrompt,
  attachPromptCaching,
  buildThinkingConfig,
  buildAnthropicRequestBody,
  sortObjectKeys,
} from './AnthropicRequestBuilder.js';
import { getRetryConfig } from './AnthropicRateLimitHandler.js';
import {
  isAnthropicOAuthBaseURL,
  ANTHROPIC_DEFAULT_BASE_URL,
} from './AnthropicEndpointUtils.js';
import { formatContextPrefix } from '../utils/systemPromptPlacement.js';

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
}

/**
 * Parameters for request preparation
 */
export interface PrepareRequestParams {
  content: IContent[];
  tools: ProviderToolset | undefined;
  options: NormalizedGenerateChatOptions;
  isOAuth: boolean;
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
 * Helper to resolve model behavior settings with fallback to options.settings
 */
function resolveModelBehavior<T>(
  options: NormalizedGenerateChatOptions,
  key: string,
): T | undefined {
  const fromBehavior =
    typeof options.invocation.getModelBehavior === 'function'
      ? options.invocation.getModelBehavior(key)
      : undefined;
  return (fromBehavior ?? options.settings.get(key)) as T | undefined;
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
 * Reasoning settings resolved from invocation
 */
interface ReasoningSettings {
  reasoningEnabled: boolean | undefined;
  reasoningBudgetTokens: number | undefined;
  stripFromContext: 'all' | 'allButLast' | 'none' | undefined;
  includeInContext: boolean | undefined;
  includeInResponse: boolean | undefined;
  adaptiveThinking: boolean | undefined;
  rawEffort:
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh'
    | 'max'
    | undefined;
}

/**
 * Request settings resolved from options and config
 */
interface RequestSettings {
  streamingEnabled: boolean;
  currentModel: string;
  userMemory: string | undefined;
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
  const reasoningEnabled = resolveModelBehavior<boolean>(
    options,
    'reasoning.enabled',
  );
  const reasoningBudgetTokens = resolveModelBehavior<number>(
    options,
    'reasoning.budgetTokens',
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
  const adaptiveThinking = resolveModelBehavior<boolean>(
    options,
    'reasoning.adaptiveThinking',
  );
  const rawEffort = resolveModelBehavior<
    'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  >(options, 'reasoning.effort');

  return {
    reasoningEnabled,
    reasoningBudgetTokens,
    stripFromContext,
    includeInContext,
    includeInResponse,
    adaptiveThinking,
    rawEffort,
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
    userMemory: undefined, // Will be resolved separately
    requestOverrides,
    configEphemerals,
    wantCaching,
    ttl,
  };
}

async function buildOAuthSystemContext(params: {
  anthropicMessages: readonly AnthropicMessage[];
  wantCaching: boolean;
  ttl: '5m' | '1h';
  cacheLogger: { debug: (fn: () => string) => void };
  systemInstruction: string | undefined;
}): Promise<SystemContextResult> {
  const {
    anthropicMessages,
    wantCaching,
    ttl,
    cacheLogger,
    systemInstruction,
  } = params;

  const messages = [...anthropicMessages];

  // Issue #3136: the agent layer owns system-prompt assembly. The provider
  // transports options.systemInstruction verbatim — it never rebuilds a core
  // prompt or merges two prompts.
  const systemMessage = systemInstruction ?? '';

  if (systemMessage) {
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
            cache_control: { type: 'ephemeral', ttl: '5m' | '1h' };
          },
        ],
      });
      cacheLogger.debug(() => 'Added cache_control to OAuth system message');
    } else {
      messages.unshift({
        role: 'user',
        content: contextPrefixText,
      });
    }
  }

  const oauthSystemField = buildAnthropicSystemPrompt({
    isOAuth: true,
    wantCaching,
    ttl,
  });

  return { systemField: oauthSystemField, messages };
}

async function buildNonOAuthSystemContext(params: {
  anthropicMessages: readonly AnthropicMessage[];
  wantCaching: boolean;
  ttl: '5m' | '1h';
  systemInstruction: string | undefined;
}): Promise<SystemContextResult> {
  const { anthropicMessages, wantCaching, ttl, systemInstruction } = params;

  // Issue #3136: the agent layer owns system-prompt assembly. The provider
  // transports options.systemInstruction verbatim into the `system` field.
  const systemFieldValue = buildAnthropicSystemPrompt({
    corePromptText: systemInstruction ?? '',
    isOAuth: false,
    wantCaching,
    ttl,
  });

  return { systemField: systemFieldValue, messages: [...anthropicMessages] };
}

/**
 * Build system context with OAuth or regular system field
 */
async function buildSystemContext(params: {
  isOAuth: boolean;
  anthropicMessages: readonly AnthropicMessage[];
  wantCaching: boolean;
  ttl: '5m' | '1h';
  cacheLogger: { debug: (fn: () => string) => void };
  systemInstruction: string | undefined;
}): Promise<SystemContextResult> {
  if (params.isOAuth) {
    return buildOAuthSystemContext(params);
  }
  return buildNonOAuthSystemContext(params);
}

function mapEffortLevel(
  rawEffort:
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh'
    | 'max'
    | undefined,
  currentModel: string,
): 'low' | 'medium' | 'high' | 'max' | undefined {
  if (!rawEffort) {
    return undefined;
  }

  const adaptiveCapable = supportsAdaptiveThinking(currentModel);

  if (rawEffort === 'minimal' || rawEffort === 'low') {
    return 'low';
  } else if (rawEffort === 'medium') {
    return 'medium';
  } else if (rawEffort === 'high') {
    return 'high';
  } else if (rawEffort === 'xhigh') {
    return adaptiveCapable ? 'max' : 'high';
  }

  // rawEffort is 'max' here
  return adaptiveCapable ? 'max' : 'high';
}

/**
 * Build thinking configuration and request body
 */
function buildThinkingAndRequestBody(params: {
  currentModel: string;
  rawEffort:
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh'
    | 'max'
    | undefined;
  shouldIncludeThinking: boolean;
  reasoningBudgetTokens: number | undefined;
  adaptiveThinking: boolean | undefined;
  includeInResponse: boolean | undefined;
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
  const {
    currentModel,
    rawEffort,
    shouldIncludeThinking,
    reasoningBudgetTokens,
    adaptiveThinking,
    includeInResponse,
    anthropicMessages,
    systemField,
    anthropicTools,
    getMaxTokensForModel,
    streamingEnabled,
    requestOverrides,
  } = params;

  const mappedEffort = mapEffortLevel(rawEffort, currentModel);

  const thinkingConfig = buildThinkingConfig({
    reasoningEnabled: shouldIncludeThinking,
    reasoningBudgetTokens,
    adaptiveThinking,
    includeInResponse,
    thinkingEffort: mappedEffort,
    model: currentModel,
  });

  return buildAnthropicRequestBody({
    model: currentModel,
    messages: anthropicMessages,
    system: systemField,
    tools:
      anthropicTools && anthropicTools.length > 0 ? anthropicTools : undefined,
    maxTokens: resolveRequestMaxTokens(
      getMaxTokensForModel(currentModel),
      requestOverrides,
    ),
    streamingEnabled,
    modelParams: requestOverrides,
    thinking: thinkingConfig.thinking,
    outputConfig: thinkingConfig.output_config,
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
    isOAuth,
    reasoningSettings,
    config,
    currentModel,
    currentBaseURL,
    unprefixToolName,
    logger,
  } = params;

  // Convert IContent to Anthropic API format
  const anthropicMessages = convertToAnthropicMessages(content, {
    isOAuth,
    stripFromContext: reasoningSettings.stripFromContext,
    includeInContext: reasoningSettings.includeInContext,
    reasoningEnabled: reasoningSettings.reasoningEnabled as boolean,
    config,
    currentModel,
    currentBaseURL,
    unprefixToolName,
    logger,
  });

  // Convert tools to Anthropic format and stabilize ordering
  let anthropicTools = convertToolsToAnthropic(tools, isOAuth);

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

function buildRequestContext(params: {
  reasoningSettings: ReasoningSettings;
  requestSettings: RequestSettings;
  anthropicTools:
    | Array<{ name: string; input_schema: { properties?: unknown } }>
    | undefined;
  systemContext: SystemContextResult;
  getMaxTokensForModel: (model: string) => number;
  shouldIncludeThinking: boolean;
  cacheLogger: { debug: (fn: () => string) => void };
  toolsLogger: DebugLogger;
  logger: DebugLogger;
  wantCaching: boolean;
}): AnthropicRequestContext {
  const {
    reasoningSettings,
    requestSettings,
    anthropicTools,
    systemContext,
    getMaxTokensForModel,
    shouldIncludeThinking,
    cacheLogger,
    toolsLogger,
    logger,
    wantCaching,
  } = params;

  // Issue #2410: use the effective caching flag (already gated on whether the
  // base URL is a native Anthropic endpoint) for both system-field and
  // message-level cache_control injection.
  if (wantCaching) {
    attachPromptCaching(
      systemContext.messages,
      requestSettings.ttl,
      cacheLogger,
    );
    // Issue #3070: spend a third breakpoint at the preserved-head boundary so
    // the byte-stable compressed head is READ from cache instead of re-billed
    // at cache-WRITE pricing. Runs after the rolling-tail breakpoint so the
    // two are never placed on the same block. Gated on the same native-base-URL
    // flag as the other breakpoints (third-party gateways stay unchanged).
    attachAnchorCacheControl(
      systemContext.messages,
      requestSettings.ttl,
      cacheLogger,
    );
  }

  const requestBody = buildThinkingAndRequestBody({
    currentModel: requestSettings.currentModel,
    rawEffort: reasoningSettings.rawEffort,
    shouldIncludeThinking,
    reasoningBudgetTokens: reasoningSettings.reasoningBudgetTokens,
    adaptiveThinking: reasoningSettings.adaptiveThinking,
    includeInResponse: reasoningSettings.includeInResponse,
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
  };
}

/**
 * Prepare complete Anthropic API request context
 */
export async function prepareAnthropicRequest(
  params: PrepareRequestParams,
): Promise<AnthropicRequestContext> {
  const reasoningSettings = resolveReasoningSettings(params.options);

  params.logger.debug(
    () =>
      `[AnthropicProvider] Reasoning settings from invocation.modelBehavior (fallback to options.settings): enabled=${String(reasoningSettings.reasoningEnabled)}, budgetTokens=${String(reasoningSettings.reasoningBudgetTokens)}, stripFromContext=${String(reasoningSettings.stripFromContext)}, includeInContext=${String(reasoningSettings.includeInContext)}`,
  );

  const configForMessages = params.config ?? params.options.runtime?.config;
  const { anthropicMessages, anthropicTools } = convertMessagesAndTools({
    content: params.content,
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

  const systemContext = await buildSystemContext({
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
    shouldIncludeThinking: reasoningSettings.reasoningEnabled === true,
    cacheLogger: params.cacheLogger,
    toolsLogger: params.toolsLogger,
    logger: params.logger,
    wantCaching: effectiveWantCaching,
  });
}
