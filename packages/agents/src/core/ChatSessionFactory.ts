/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelGenerationSettings } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { ChatSessionConfig } from './chatSession.js';
import { getEnvironmentContext } from '@vybestack/llxprt-code-core/utils/environmentContext.js';
import { getCoreSystemPromptAsync } from '@vybestack/llxprt-code-core/core/prompts.js';
import {
  getToolGovernanceEphemerals,
  buildToolDeclarationsFromView,
  getEnabledToolNamesForPrompt,
  shouldIncludeSubagentDelegationForConfig,
} from './clientToolGovernance.js';
import { reportError } from '@vybestack/llxprt-code-core/utils/errorReporting.js';
import { ChatSession } from './chatSession.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ReadonlySettingsSnapshot } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { createSettingsProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/settingsRuntimeAdapter.js';
import { loadAgentRuntime } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import { getErrorMessage } from '@vybestack/llxprt-code-core/utils/errors.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { isThinkingSupported } from './clientHelpers.js';
import { estimateTokens as estimateTextTokens } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { TodoContinuationService } from './TodoContinuationService.js';

/**
 * Assembles ephemeral settings into an immutable snapshot for the runtime.
 * Pure function — reads config, no side effects.
 */
export function buildSettingsSnapshot(
  config: Config,
  getToolGovernance: typeof getToolGovernanceEphemerals = getToolGovernanceEphemerals,
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
    contextLimit,
    preserveThreshold: preserveThreshold ?? 0.2,
    telemetry: { enabled: true, target: null },
    tools: getToolGovernance(config),
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
    'reasoning.fieldName': config.getEphemeralSetting('reasoning.fieldName') as
      | string
      | undefined,
    'reasoning.effort': config.getEphemeralSetting('reasoning.effort') as
      | 'minimal'
      | 'low'
      | 'medium'
      | 'high'
      | 'xhigh'
      | 'max'
      | undefined,
    'reasoning.maxTokens': config.getEphemeralSetting('reasoning.maxTokens') as
      | number
      | undefined,
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
  extraHistory?: IContent[];
  generateContentConfig: ModelGenerationSettings;
  todoContinuationService: TodoContinuationService;
  toolRegistry: ToolRegistry | undefined;
  createHistoryService?: () => HistoryService;
  loadRuntime?: typeof loadAgentRuntime;
  createChatSessionInstance?: (
    ...args: ConstructorParameters<typeof ChatSession>
  ) => ChatSession;
}

/**
 * Appends extra history onto a HistoryService with a fresh turn key per entry.
 * No-op when there is nothing to load.
 */
function loadExtraHistory(
  historyService: HistoryService,
  extraHistory: IContent[] | undefined,
  currentModel: string,
): void {
  if (!extraHistory || extraHistory.length === 0) {
    return;
  }
  for (const content of extraHistory) {
    const turnKey = historyService.generateTurnKey();
    historyService.add(
      { ...content, metadata: { ...content.metadata, turnId: turnKey } },
      currentModel,
    );
  }
}

/**
 * Resolves (or creates) the HistoryService and optionally loads extra history.
 *
 * A stored service is reused to preserve the live conversation/UI display
 * across provider/auth rebuilds. However, `extraHistory` (e.g. the carried
 * `_previousHistory` from a client rebuild during --continue) must not be
 * silently dropped when the stored service is still empty — otherwise restored
 * context never reaches the model (issue #2500). When the stored service
 * already holds content (a mid-session switch), extraHistory is skipped to
 * avoid duplicating turns.
 */
function setupHistoryService(
  storedHistoryService: HistoryService | undefined,
  extraHistory: IContent[] | undefined,
  runtimeState: AgentRuntimeState,
  createHistoryService: () => HistoryService,
): { historyService: HistoryService; reused: boolean } {
  const logger = new DebugLogger('llxprt:client:start');
  const currentModel = runtimeState.model;
  if (storedHistoryService) {
    if (storedHistoryService.isEmpty()) {
      loadExtraHistory(storedHistoryService, extraHistory, currentModel);
    }
    logger.debug('Reusing stored HistoryService to preserve UI conversation');
    return { historyService: storedHistoryService, reused: true };
  }

  const historyService = createHistoryService();
  loadExtraHistory(historyService, extraHistory, currentModel);
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
  } catch {
    // Token estimation failed - use fallback estimation
    logger.debug(
      () =>
        `Failed to count system instruction tokens for model ${model}, using fallback`,
    );
    historyService.setBaseTokenOffset(estimateTextTokens(systemInstruction));
  }
}

/**
 * Builds the generation settings with thinking support if applicable.
 */
function buildGenerateContentConfig(
  baseConfig: ModelGenerationSettings,
  model: string,
): ChatSessionConfig {
  return isThinkingSupported(model)
    ? {
        ...baseConfig,
        reasoning: {
          ...(baseConfig.reasoning ?? {}),
          includeInOutput: true,
        },
      }
    : baseConfig;
}

/**
 * Builds the runtime bundle, tool declarations, and ChatSession instance.
 */
async function buildChatFromRuntime(
  config: Config,
  runtimeState: AgentRuntimeState,
  contentGenerator: ContentGenerator,
  historyService: HistoryService,
  generateContentConfig: ModelGenerationSettings,
  todoContinuationService: TodoContinuationService,
  toolRegistry: ToolRegistry | undefined,
  systemInstruction: string,
  createChatSessionInstance: (
    ...args: ConstructorParameters<typeof ChatSession>
  ) => ChatSession,
  loadRuntime: typeof loadAgentRuntime,
): Promise<ChatSession> {
  const model = runtimeState.model;
  const generationConfigWithThinking = buildGenerateContentConfig(
    generateContentConfig,
    model,
  );

  const settings = buildSettingsSnapshot(config);
  const providerRuntime = createSettingsProviderRuntimeContext({
    settingsService: config.getSettingsService(),
    config,
    runtimeId: runtimeState.runtimeId,
    metadata: { source: 'AgentClient.startChat' },
  });

  const runtimeBundle = await loadRuntime({
    profile: {
      config,
      state: runtimeState,
      settings,
      providerRuntime,
      contentGeneratorConfig: config.getContentGeneratorConfig(),
      toolRegistry,
      providerManager: config.getProviderManager(),
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
  const tools = [{ functionDeclarations: filteredDeclarations }];

  const chat = createChatSessionInstance(
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

  return chat;
}

/**
 * Stateful factory: creates a ChatSession session.
 * Reuses stored HistoryService when available, creates a new one otherwise.
 * Configures thinking, loads the agent runtime, builds tool declarations.
 */
export async function createChatSession(
  deps: CreateChatSessionDeps,
): Promise<ChatSession> {
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
    createHistoryService = () => new HistoryService(),
    loadRuntime = loadAgentRuntime,
    createChatSessionInstance = (...args) => new ChatSession(...args),
  } = deps;

  const logger = new DebugLogger('llxprt:client:start');

  const { historyService, reused } = setupHistoryService(
    storedHistoryService,
    extraHistory,
    runtimeState,
    createHistoryService,
  );

  const getTokenizerFactory = (config as Config & Record<string, unknown>)[
    'getTokenizerFactory'
  ];
  if (typeof getTokenizerFactory === 'function') {
    const tokenizerFactory = getTokenizerFactory.call(config);
    if (tokenizerFactory) {
      historyService.setTokenizerFactory(tokenizerFactory);
    }
  }

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

  if (reused) {
    historyService.resetTokenAccounting();
    await historyService.recalculateTotalTokens(model);
  }

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

  const chat = await buildChatFromRuntime(
    config,
    runtimeState,
    contentGenerator,
    historyService,
    generateContentConfig,
    todoContinuationService,
    toolRegistry,
    systemInstruction,
    createChatSessionInstance,
    loadRuntime,
  );

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
): Promise<ChatSession> {
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
