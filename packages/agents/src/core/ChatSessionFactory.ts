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
import { resolveModelForSystemPrompt } from './systemPromptModel.js';
export { resolveModelForSystemPrompt } from './systemPromptModel.js';
import type { SystemPromptAssembler } from './chatSession.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { MediaAdmissionService } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ReadonlySettingsSnapshot } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { createSettingsProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/settingsRuntimeAdapter.js';
import { loadAgentRuntime } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import { getErrorMessage } from '@vybestack/llxprt-code-core/utils/errors.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { triggerPreCompressHook } from '@vybestack/llxprt-code-core/core/lifecycleHookTriggers.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { isThinkingSupported } from './clientHelpers.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { TodoContinuationService } from './TodoContinuationService.js';
import { resolvePromptMemory } from './promptMemoryPolicy.js';

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
 * Memory sourcing is shared with the subagent builder via
 * {@link resolvePromptMemory} so both execution contexts apply the same JIT
 * policy (issue #3173). This is the FULL path used by startChat — it differs
 * from the lightweight path in clientLlmUtilities, which skips env context and
 * JIT memory; both paths pass core memory.
 */
export async function buildSystemInstruction(
  config: Config,
  enabledToolNames: string[],
  envParts: Array<{ text?: string }>,
  provider: string | undefined,
  model: string,
): Promise<string> {
  const { userMemory, coreMemory, mcpInstructions } =
    await resolvePromptMemory(config);

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
    provider,
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
  extraHistory?: readonly IContent[];
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
async function loadExtraHistory(
  historyService: HistoryService,
  extraHistory: readonly IContent[] | undefined,
  currentModel: string,
): Promise<void> {
  if (!extraHistory || extraHistory.length === 0) {
    return;
  }
  const restored = extraHistory.map((content) => {
    const turnKey = historyService.generateTurnKey();
    return { ...content, metadata: { ...content.metadata, turnId: turnKey } };
  });
  await historyService.addBatch(restored, currentModel);
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
async function setupHistoryService(
  storedHistoryService: HistoryService | undefined,
  extraHistory: readonly IContent[] | undefined,
  runtimeState: AgentRuntimeState,
  createHistoryService: () => HistoryService,
): Promise<{ historyService: HistoryService; reused: boolean }> {
  const logger = new DebugLogger('llxprt:client:start');
  const currentModel = runtimeState.model;
  if (storedHistoryService) {
    if (storedHistoryService.isEmpty()) {
      await loadExtraHistory(storedHistoryService, extraHistory, currentModel);
    }
    logger.debug('Reusing stored HistoryService to preserve UI conversation');
    return { historyService: storedHistoryService, reused: true };
  }

  const historyService = createHistoryService();
  await loadExtraHistory(historyService, extraHistory, currentModel);
  return { historyService, reused: false };
}

/**
 * Estimates and sets the system prompt token offset on the history service.
 */
async function applySystemPromptTokenOffset(
  historyService: HistoryService,
  systemInstruction: string,
  model: string,
): Promise<void> {
  const tokens = await historyService.estimateTokensForText(
    systemInstruction,
    model,
  );
  historyService.setBaseTokenOffset(tokens);
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
  systemPromptAssembler: SystemPromptAssembler,
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
    triggerPreCompressHook,
    systemPromptAssembler,
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
 * Applies the config's tokenizer factory to a history service, if available.
 */
function applyTokenizerFactory(
  config: Config,
  historyService: HistoryService,
): void {
  const getTokenizerFactory = (config as Config & Record<string, unknown>)[
    'getTokenizerFactory'
  ];
  if (typeof getTokenizerFactory === 'function') {
    const tokenizerFactory = getTokenizerFactory.call(config);
    if (tokenizerFactory) {
      historyService.setTokenizerFactory(tokenizerFactory);
    }
  }
}
function chatSessionFactoryAdmission(runtimeId: string): {
  readonly turnId: string;
  readonly source: string;
  readonly reservationOwnerScope: string;
} {
  return {
    turnId: runtimeId,
    source: 'chat-session-factory',
    reservationOwnerScope: `chat-session-factory:${runtimeId}`,
  };
}

interface AdmittedInitialHistory {
  readonly history: readonly IContent[] | undefined;
  readonly release: () => Promise<void>;
}

async function admitInitialHistory(
  config: Config,
  history: readonly IContent[] | undefined,
  runtimeId: string,
): Promise<AdmittedInitialHistory> {
  if (history === undefined) {
    return { history: undefined, release: () => Promise.resolve() };
  }
  const hasLocalMedia = history.some((content) =>
    content.blocks.some(
      (block) =>
        block.type === 'media' &&
        (block.encoding === 'base64' || block.encoding === 'reference'),
    ),
  );
  if (!hasLocalMedia) {
    return { history, release: () => Promise.resolve() };
  }
  const admission = new MediaAdmissionService(config.getLocalMediaStore());
  const admissionContext = chatSessionFactoryAdmission(runtimeId);
  const admitted = await admission.admitContents(history, admissionContext);
  return {
    history: admitted,
    release: () => admission.releaseContents(admitted, admissionContext),
  };
}

async function buildAdmittedChatSession(
  deps: CreateChatSessionDeps,
  admittedHistory: readonly IContent[] | undefined,
): Promise<ChatSession> {
  const {
    config,
    runtimeState,
    contentGenerator,
    storedHistoryService,
    clearStoredHistoryService,
    generateContentConfig,
    todoContinuationService,
    toolRegistry,
    createHistoryService = () => new HistoryService(),
    loadRuntime = loadAgentRuntime,
    createChatSessionInstance = (...args) => new ChatSession(...args),
  } = deps;
  const logger = new DebugLogger('llxprt:client:start');
  const { historyService, reused } = await setupHistoryService(
    storedHistoryService,
    admittedHistory,
    runtimeState,
    createHistoryService,
  );
  applyTokenizerFactory(config, historyService);

  const enabledToolNames = getEnabledToolNamesForPrompt(config);
  const envParts = await getEnvironmentContext(config);
  const model = resolveModelForSystemPrompt(config);
  logger.debug(() => `DEBUG [client.startChat]: Model from config: ${model}`);
  const systemInstruction = await buildSystemInstruction(
    config,
    enabledToolNames,
    envParts,
    runtimeState.provider,
    model,
  );
  const systemPromptAssembler: SystemPromptAssembler = {
    assemble: (request: { provider: string | undefined; model: string }) =>
      buildSystemInstruction(
        config,
        enabledToolNames,
        envParts,
        request.provider,
        request.model,
      ),
  };

  historyService.setActiveTokenizationTarget(model, runtimeState.provider);
  if (reused) {
    historyService.resetTokenAccounting();
    await historyService.recalculateTotalTokens();
  }
  await applySystemPromptTokenOffset(historyService, systemInstruction, model);
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
    systemPromptAssembler,
    createChatSessionInstance,
    loadRuntime,
  );
  if (reused) clearStoredHistoryService();
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
  const admittedHistory = await admitInitialHistory(
    deps.config,
    deps.extraHistory,
    deps.runtimeState.runtimeId,
  );
  try {
    const chat = await buildAdmittedChatSession(deps, admittedHistory.history);
    await admittedHistory.release();
    return chat;
  } catch (error: unknown) {
    try {
      await admittedHistory.release();
    } catch (cleanupError: unknown) {
      throw new AggregateError(
        [error, cleanupError],
        'Chat session setup failed and admitted history cleanup was incomplete',
      );
    }
    throw error;
  }
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
      deps.extraHistory ? [...deps.extraHistory] : [],
      'startChat',
    );
    throw new Error(`Failed to initialize chat: ${getErrorMessage(error)}`);
  }
}
