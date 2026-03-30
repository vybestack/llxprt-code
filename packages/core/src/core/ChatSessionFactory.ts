/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Content, GenerateContentConfig, Tool } from '@google/genai';
import { getEnvironmentContext } from '../utils/environmentContext.js';
import { getCoreSystemPromptAsync } from './prompts.js';
import {
  getToolGovernanceEphemerals,
  buildToolDeclarationsFromView,
  getEnabledToolNamesForPrompt,
  shouldIncludeSubagentDelegationForConfig,
} from './clientToolGovernance.js';
import { reportError } from '../utils/errorReporting.js';
import { GeminiChat } from './geminiChat.js';
import { DebugLogger } from '../debug/index.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { ContentConverters } from '../services/history/ContentConverters.js';
import type { ReadonlySettingsSnapshot } from '../runtime/AgentRuntimeContext.js';
import { createProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';
import { loadAgentRuntime } from '../runtime/AgentRuntimeLoader.js';
import { getErrorMessage } from '../utils/errors.js';
import type { ContentGenerator } from './contentGenerator.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import { isThinkingSupported } from './clientHelpers.js';
import { estimateTokens as estimateTextTokens } from '../utils/toolOutputLimiter.js';
import type { Config } from '../config/config.js';
import type { AgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import type { TodoContinuationService } from './TodoContinuationService.js';

/**
 * Assembles ephemeral settings into an immutable snapshot for the runtime.
 * Pure function — reads config, no side effects.
 */
export function buildSettingsSnapshot(
  config: Config,
): ReadonlySettingsSnapshot {
  const rawCompressionThreshold = config.getEphemeralSetting(
    'compression-threshold',
  );
  const compressionThreshold =
    typeof rawCompressionThreshold === 'number' &&
    Number.isFinite(rawCompressionThreshold)
      ? rawCompressionThreshold
      : undefined;

  const rawContextLimit = config.getEphemeralSetting('context-limit');
  const contextLimit =
    typeof rawContextLimit === 'number' &&
    Number.isFinite(rawContextLimit) &&
    rawContextLimit > 0
      ? rawContextLimit
      : undefined;

  const rawPreserveThreshold = config.getEphemeralSetting(
    'compression-preserve-threshold',
  );
  const preserveThreshold =
    typeof rawPreserveThreshold === 'number' &&
    Number.isFinite(rawPreserveThreshold)
      ? rawPreserveThreshold
      : undefined;

  return {
    compressionThreshold: compressionThreshold ?? 0.85,
    preserveThreshold: preserveThreshold ?? 0.2,
    telemetry: { enabled: true, target: null },
    tools: getToolGovernanceEphemerals(config),
    'reasoning.enabled': config.getEphemeralSetting('reasoning.enabled') as
      | boolean
      | undefined,
    'reasoning.includeInContext': config.getEphemeralSetting(
      'reasoning.includeInContext',
    ) as boolean | undefined,
    'reasoning.includeInResponse': config.getEphemeralSetting(
      'reasoning.includeInResponse',
    ) as boolean | undefined,
    'reasoning.format': config.getEphemeralSetting('reasoning.format') as
      | 'native'
      | 'field'
      | undefined,
    'reasoning.stripFromContext': config.getEphemeralSetting(
      'reasoning.stripFromContext',
    ) as 'all' | 'allButLast' | 'none' | undefined,
    'reasoning.effort': config.getEphemeralSetting('reasoning.effort') as
      | 'minimal'
      | 'low'
      | 'medium'
      | 'high'
      | 'xhigh'
      | undefined,
    'reasoning.maxTokens': config.getEphemeralSetting('reasoning.maxTokens') as
      | number
      | undefined,
    contextLimit,
  };
}

/**
 * Builds the full system instruction: env context, core memory, JIT memory,
 * user memory, MCP instructions, subagent delegation.
 *
 * This is the FULL path used by startChat — differs from the lightweight path
 * in clientLlmUtilities which skips env context, core memory, and JIT memory.
 */
export async function buildSystemInstruction(
  config: Config,
  enabledToolNames: string[],
  envParts: Array<{ text?: string }>,
  model: string,
): Promise<string> {
  let userMemory = config.isJitContextEnabled()
    ? config.getGlobalMemory()
    : config.getUserMemory();
  const coreMemory = config.getCoreMemory();

  const jitMemory = await config.getJitMemoryForPath(config.getWorkingDir());
  if (jitMemory) {
    userMemory = userMemory ? `${userMemory}\n\n${jitMemory}` : jitMemory;
  }

  const mcpInstructions = config.getMcpClientManager()?.getMcpInstructions();
  const includeSubagentDelegation =
    await shouldIncludeSubagentDelegationForConfig(config, enabledToolNames);
  const interactionMode = config.isInteractive()
    ? 'interactive'
    : 'non-interactive';

  let systemInstruction = await getCoreSystemPromptAsync({
    userMemory,
    coreMemory,
    mcpInstructions,
    model,
    tools: enabledToolNames,
    includeSubagentDelegation,
    interactionMode,
  });

  const envContextText = envParts
    .map((part) => ('text' in part && part.text ? part.text : ''))
    .join('\n');
  if (envContextText) {
    systemInstruction = envContextText + '\n\n' + systemInstruction;
  }

  return systemInstruction;
}

export interface CreateChatSessionDeps {
  config: Config;
  runtimeState: AgentRuntimeState;
  contentGenerator: ContentGenerator;
  storedHistoryService: HistoryService | undefined;
  clearStoredHistoryService: () => void;
  extraHistory?: Content[];
  generateContentConfig: GenerateContentConfig;
  todoContinuationService: TodoContinuationService;
  toolRegistry: ToolRegistry | undefined;
}

/**
 * Resolves (or creates) the HistoryService and optionally loads extra history.
 */
function setupHistoryService(
  storedHistoryService: HistoryService | undefined,
  extraHistory: Content[] | undefined,
  runtimeState: AgentRuntimeState,
): { historyService: HistoryService; reused: boolean } {
  const logger = new DebugLogger('llxprt:client:start');
  if (storedHistoryService != null) {
    logger.debug('Reusing stored HistoryService to preserve UI conversation');
    return { historyService: storedHistoryService, reused: true };
  }

  const historyService = new HistoryService();
  if (extraHistory != null && extraHistory.length > 0) {
    const currentModel = runtimeState.model;
    for (const content of extraHistory) {
      const turnKey = historyService.generateTurnKey();
      historyService.add(
        ContentConverters.toIContent(content, undefined, undefined, turnKey),
        currentModel,
      );
    }
  }
  return { historyService, reused: false };
}

/**
 * Estimates and sets the system prompt token offset on the history service.
 */
async function applySystemPromptTokenOffset(
  historyService: HistoryService,
  systemInstruction: string,
  model: string,
  logger: DebugLogger,
): Promise<void> {
  try {
    const tokens = await historyService.estimateTokensForText(
      systemInstruction,
      model,
    );
    historyService.setBaseTokenOffset(tokens);
  } catch (_error) {
    logger.debug(
      () =>
        `Failed to count system instruction tokens for model ${model}, using fallback`,
    );
    historyService.setBaseTokenOffset(estimateTextTokens(systemInstruction));
  }
}

/**
 * Builds the GenerateContentConfig with thinking support if applicable.
 */
function buildGenerateContentConfig(
  baseConfig: GenerateContentConfig,
  model: string,
): GenerateContentConfig {
  return isThinkingSupported(model)
    ? {
        ...baseConfig,
        thinkingConfig: { thinkingBudget: -1, includeThoughts: true },
      }
    : baseConfig;
}

/**
 * Stateful factory: creates a GeminiChat session.
 * Reuses stored HistoryService when available, creates a new one otherwise.
 * Configures thinking, loads the agent runtime, builds tool declarations.
 */
export async function createChatSession(
  deps: CreateChatSessionDeps,
): Promise<GeminiChat> {
  const {
    config,
    runtimeState,
    contentGenerator,
    storedHistoryService,
    clearStoredHistoryService,
    extraHistory,
    generateContentConfig,
    todoContinuationService,
    toolRegistry,
  } = deps;

  const logger = new DebugLogger('llxprt:client:start');

  const { historyService, reused } = setupHistoryService(
    storedHistoryService,
    extraHistory,
    runtimeState,
  );

  const enabledToolNames = getEnabledToolNamesForPrompt(config);
  const envParts = await getEnvironmentContext(config);
  const model = runtimeState.model;

  logger.debug(() => `DEBUG [client.startChat]: Model from config: ${model}`);

  const systemInstruction = await buildSystemInstruction(
    config,
    enabledToolNames,
    envParts,
    model,
  );

  await applySystemPromptTokenOffset(
    historyService,
    systemInstruction,
    model,
    logger,
  );

  logger.debug(
    () =>
      `DEBUG [client.startChat]: System instruction includes Flash instructions: ${systemInstruction.includes(
        'IMPORTANT: You MUST use the provided tools',
      )}`,
  );

  const generationConfigWithThinking = buildGenerateContentConfig(
    generateContentConfig,
    model,
  );

  const settings = buildSettingsSnapshot(config);
  const providerRuntime = createProviderRuntimeContext({
    settingsService: config.getSettingsService(),
    runtimeId: runtimeState.runtimeId,
    metadata: { source: 'GeminiClient.startChat' },
    config,
  });

  const runtimeBundle = await loadAgentRuntime({
    profile: {
      state: runtimeState,
      contentGeneratorConfig: config.getContentGeneratorConfig(),
      providerManager: config.getProviderManager?.(),
      config,
      settings,
      providerRuntime,
      toolRegistry,
    },
    overrides: { historyService, contentGenerator },
  });

  const filteredDeclarations = buildToolDeclarationsFromView(
    toolRegistry,
    runtimeBundle.toolsView,
  );
  todoContinuationService.updateTodoToolAvailabilityFromDeclarations(
    filteredDeclarations,
  );
  const tools: Tool[] = [{ functionDeclarations: filteredDeclarations }];

  const chat = new GeminiChat(
    runtimeBundle.runtimeContext,
    runtimeBundle.contentGenerator,
    { systemInstruction, ...generationConfigWithThinking, tools },
    [],
  );

  chat.setActiveTodosProvider(async () => {
    const todos = await todoContinuationService.readTodoSnapshot();
    const active = todoContinuationService.getActiveTodos(todos);
    if (active.length === 0) return undefined;
    return active.map((t) => `- [${t.status}] ${t.content}`).join('\n');
  });

  if (reused) {
    clearStoredHistoryService();
  }

  return chat;
}

/**
 * Wraps createChatSession with error reporting for the startChat call site.
 */
export async function createChatSessionSafe(
  deps: CreateChatSessionDeps,
): Promise<GeminiChat> {
  try {
    return await createChatSession(deps);
  } catch (error) {
    await reportError(
      error,
      'Error initializing chat session.',
      deps.extraHistory ?? [],
      'startChat',
    );
    throw new Error(`Failed to initialize chat: ${getErrorMessage(error)}`);
  }
}
