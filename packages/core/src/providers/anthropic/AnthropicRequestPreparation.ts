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

import { isOpus46Plus } from './AnthropicModelData.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { IContent } from '../../services/history/IContent.js';
import type { Config } from '../../config/config.js';
import type { IProviderConfig } from '../types/IProviderConfig.js';
import type { DebugLogger } from '../../debug/index.js';
import type { ProviderToolset } from '../IProvider.js';
import type { AnthropicMessage } from './AnthropicMessageNormalizer.js';
import { convertToAnthropicMessages } from './AnthropicMessageNormalizer.js';
import { convertToolsToAnthropic } from './schemaConverter.js';
import {
  buildAnthropicSystemPrompt,
  attachPromptCaching,
  buildThinkingConfig,
  buildAnthropicRequestBody,
  sortObjectKeys,
} from './AnthropicRequestBuilder.js';
import { getRetryConfig } from './AnthropicRateLimitHandler.js';
import { getCoreSystemPromptAsync } from '../../core/prompts.js';
import { shouldIncludeSubagentDelegation } from '../../prompt-config/subagent-delegation.js';
import { resolveUserMemory } from '../utils/userMemory.js';

/**
 * Request preparation context returned to caller
 */
export interface AnthropicRequestContext {
  requestBody: Record<string, unknown>;
  anthropicMessages: AnthropicMessage[];
  streamingEnabled: boolean;
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
    typeof options.invocation?.getModelBehavior === 'function'
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
    typeof options.invocation?.getCliSetting === 'function'
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
  const invocationEphemerals = options.invocation?.ephemerals ?? {};
  const streamingSetting =
    (invocationEphemerals['streaming'] as string | undefined) ??
    providerConfig?.getEphemeralSettings?.()?.['streaming'];
  const streamingEnabled = streamingSetting !== 'disabled';

  // Get current model
  const currentModel = options.resolved.model;

  // Get pre-separated model parameters from invocation context
  const requestOverrides: Record<string, unknown> = {
    ...(options.invocation?.modelParams ?? {}),
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
  const providerSettings =
    options.settings.getProviderSettings(providerName) ?? {};
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

/**
 * Build system context with OAuth or regular system field
 */
async function buildSystemContext(params: {
  isOAuth: boolean;
  currentModel: string;
  userMemory: string | undefined;
  mcpInstructions: string | undefined;
  toolNamesForPrompt: string[] | undefined;
  includeSubagentDelegation: boolean;
  interactionMode: 'interactive' | 'non-interactive';
  anthropicMessages: readonly AnthropicMessage[];
  wantCaching: boolean;
  ttl: '5m' | '1h';
  cacheLogger: { debug: (fn: () => string) => void };
}): Promise<SystemContextResult> {
  const {
    isOAuth,
    currentModel,
    userMemory,
    mcpInstructions,
    toolNamesForPrompt,
    includeSubagentDelegation,
    interactionMode,
    anthropicMessages,
    wantCaching,
    ttl,
    cacheLogger,
  } = params;

  // Create a mutable copy to allow modification
  const messages = [...anthropicMessages];

  // For OAuth mode, inject core system prompt as the first human message
  if (isOAuth) {
    const corePrompt = await getCoreSystemPromptAsync({
      userMemory,
      mcpInstructions,
      model: currentModel,
      tools: toolNamesForPrompt,
      includeSubagentDelegation,
      interactionMode,
    });
    if (corePrompt) {
      if (wantCaching) {
        messages.unshift({
          role: 'user',
          content: [
            {
              type: 'text',
              text: `<system>
${corePrompt}
</system>

User provided conversation begins here:`,
              cache_control: { type: 'ephemeral', ttl },
            } as {
              type: 'text';
              text: string;
              cache_control: { type: 'ephemeral'; ttl: '5m' | '1h' };
            },
          ],
        });
        cacheLogger.debug(() => 'Added cache_control to OAuth system message');
      } else {
        messages.unshift({
          role: 'user',
          content: `<system>
${corePrompt}
</system>

User provided conversation begins here:`,
        });
      }
    }
    return { systemField: undefined, messages };
  }

  // Build system field with caching support (for non-OAuth)
  const systemPrompt = await getCoreSystemPromptAsync({
    userMemory,
    mcpInstructions,
    model: currentModel,
    tools: toolNamesForPrompt,
    includeSubagentDelegation,
    interactionMode,
  });

  const systemFieldValue = buildAnthropicSystemPrompt({
    corePromptText: systemPrompt,
    isOAuth,
    wantCaching,
    ttl,
  });

  return { systemField: systemFieldValue, messages };
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
    anthropicMessages,
    systemField,
    anthropicTools,
    getMaxTokensForModel,
    streamingEnabled,
    requestOverrides,
  } = params;

  // Map effort levels for thinking configuration
  // Only allow max for Opus 4.6+; downgrade xhigh/max to high for older models
  const opus46Plus = isOpus46Plus(currentModel);
  let mappedEffort: 'low' | 'medium' | 'high' | 'max' | undefined;
  if (rawEffort) {
    if (rawEffort === 'minimal' || rawEffort === 'low') {
      mappedEffort = 'low';
    } else if (rawEffort === 'medium') {
      mappedEffort = 'medium';
    } else if (rawEffort === 'high') {
      mappedEffort = 'high';
    } else if (rawEffort === 'xhigh' || rawEffort === 'max') {
      mappedEffort = opus46Plus ? 'max' : 'high';
    }
  }

  // Build thinking configuration
  const thinkingConfig = buildThinkingConfig({
    reasoningEnabled: shouldIncludeThinking,
    reasoningBudgetTokens,
    adaptiveThinking,
    thinkingEffort: mappedEffort,
    model: currentModel,
  });

  // Build request body
  return buildAnthropicRequestBody({
    model: currentModel,
    messages: anthropicMessages,
    system: systemField,
    tools:
      anthropicTools && anthropicTools.length > 0 ? anthropicTools : undefined,
    maxTokens: getMaxTokensForModel(currentModel),
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
  unprefixToolName: (name: string, isOAuth: boolean) => string;
  logger: DebugLogger;
}): {
  anthropicMessages: AnthropicMessage[];
  anthropicTools:
    | Array<{ name: string; input_schema: { properties?: unknown } }>
    | undefined;
  toolNamesForPrompt: string[] | undefined;
} {
  const {
    content,
    tools,
    isOAuth,
    reasoningSettings,
    config,
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

  // Extract tool names for system prompt
  const toolNamesForPrompt =
    tools === undefined
      ? undefined
      : Array.from(
          new Set(
            tools.flatMap(
              (group: { functionDeclarations: Array<{ name?: string }> }) =>
                group.functionDeclarations
                  .map((decl: { name?: string }) => decl.name)
                  .filter((name): name is string => Boolean(name)),
            ),
          ),
        );

  return { anthropicMessages, anthropicTools, toolNamesForPrompt };
}

/**
 * Resolve MCP and subagent configuration
 */
async function resolveMcpAndSubagentConfig(params: {
  config: Config | undefined;
  toolNamesForPrompt: string[] | undefined;
}): Promise<{
  mcpInstructions: string | undefined;
  includeSubagentDelegation: boolean;
  interactionMode: 'interactive' | 'non-interactive';
}> {
  const { config, toolNamesForPrompt } = params;

  const mcpInstructions = config?.getMcpClientManager?.()?.getMcpInstructions();
  const includeSubagentDelegation = await shouldIncludeSubagentDelegation(
    toolNamesForPrompt ?? [],
    () => config?.getSubagentManager?.(),
  );

  const interactionMode = config?.isInteractive?.()
    ? 'interactive'
    : 'non-interactive';

  return { mcpInstructions, includeSubagentDelegation, interactionMode };
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

/**
 * Prepare complete Anthropic API request context
 */
export async function prepareAnthropicRequest(
  params: PrepareRequestParams,
): Promise<AnthropicRequestContext> {
  const {
    content,
    tools,
    options,
    isOAuth,
    providerName,
    config,
    getMaxTokensForModel,
    unprefixToolName,
    providerConfig,
    logger,
    toolsLogger,
    cacheLogger,
  } = params;

  // 1. Resolve reasoning settings
  const reasoningSettings = resolveReasoningSettings(options);

  logger.debug(
    () =>
      `[AnthropicProvider] Reasoning settings from invocation.modelBehavior (fallback to options.settings): enabled=${String(reasoningSettings.reasoningEnabled)}, budgetTokens=${String(reasoningSettings.reasoningBudgetTokens)}, stripFromContext=${String(reasoningSettings.stripFromContext)}, includeInContext=${String(reasoningSettings.includeInContext)}`,
  );

  const shouldIncludeThinking = reasoningSettings.reasoningEnabled === true;

  // 2. Convert messages and tools
  const configForMessages = config ?? options.runtime?.config;
  const { anthropicMessages, anthropicTools, toolNamesForPrompt } =
    convertMessagesAndTools({
      content,
      tools,
      isOAuth,
      reasoningSettings,
      config: configForMessages,
      unprefixToolName,
      logger,
    });

  // 3. Resolve request settings
  const requestSettings = resolveRequestSettings(
    options,
    providerConfig,
    providerName,
  );

  if (requestSettings.wantCaching) {
    cacheLogger.debug(
      () => `Prompt caching enabled with TTL: ${requestSettings.ttl}`,
    );
  }

  // 4. Resolve user memory
  const userMemory = await resolveUserMemory(
    options.userMemory,
    () => options.invocation?.userMemory,
  );

  // 5. Determine MCP and subagent configuration
  const { mcpInstructions, includeSubagentDelegation, interactionMode } =
    await resolveMcpAndSubagentConfig({ config, toolNamesForPrompt });

  // 6. Build system context
  const systemContext = await buildSystemContext({
    isOAuth,
    currentModel: requestSettings.currentModel,
    userMemory,
    mcpInstructions,
    toolNamesForPrompt,
    includeSubagentDelegation,
    interactionMode,
    anthropicMessages,
    wantCaching: requestSettings.wantCaching,
    ttl: requestSettings.ttl,
    cacheLogger,
  });

  // 7. Attach prompt caching to last message if enabled
  if (requestSettings.wantCaching) {
    attachPromptCaching(
      systemContext.messages,
      requestSettings.ttl,
      cacheLogger,
    );
  }

  // 8. Build request body with thinking configuration
  const requestBody = buildThinkingAndRequestBody({
    currentModel: requestSettings.currentModel,
    rawEffort: reasoningSettings.rawEffort,
    shouldIncludeThinking,
    reasoningBudgetTokens: reasoningSettings.reasoningBudgetTokens,
    adaptiveThinking: reasoningSettings.adaptiveThinking,
    anthropicMessages: systemContext.messages,
    systemField: systemContext.systemField,
    anthropicTools,
    getMaxTokensForModel,
    streamingEnabled: requestSettings.streamingEnabled,
    requestOverrides: requestSettings.requestOverrides,
  });

  // 9. Log debug information
  logRequestDebugInfo({
    anthropicTools,
    requestBody,
    anthropicMessages: systemContext.messages,
    toolsLogger,
    logger,
  });

  // 10. Get retry configuration
  const { maxAttempts, initialDelayMs } = getRetryConfig(
    requestSettings.configEphemerals,
  );

  return {
    requestBody,
    anthropicMessages: systemContext.messages,
    streamingEnabled: requestSettings.streamingEnabled,
    wantCaching: requestSettings.wantCaching,
    ttl: requestSettings.ttl,
    configEphemerals: requestSettings.configEphemerals,
    maxAttempts,
    initialDelayMs,
    cacheLogger,
  };
}
