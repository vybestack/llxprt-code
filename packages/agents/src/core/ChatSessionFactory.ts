import type { ProviderRequestDiagnostics } from '@vybestack/llxprt-code-core/runtime/providerRequestDiagnostics.js';
import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import type { ProviderRetryOperations } from '@vybestack/llxprt-code-core/runtime/contracts/ProviderRetryOperations.js';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core';
import type { SubagentDefinitionReads } from '@vybestack/llxprt-code-core';
import type { ProfileDefinitionReads } from '@vybestack/llxprt-code-core';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ToolGovernance } from '@vybestack/llxprt-code-tools';
import type { PrepareProviderInvocation } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';

import type { InstructionReadOperations } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';

import { assembleChatSystemPrompt } from './chat-system-prompt.js';

import type { ModelGenerationSettings } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { ChatSessionConfig } from './chatSession.js';

import { buildToolDeclarationsFromView } from './clientToolGovernance.js';
import { reportError } from '@vybestack/llxprt-code-core/utils/errorReporting.js';
import { ChatSession } from './chatSession.js';
export { resolveModelForSystemPrompt } from './systemPromptModel.js';
import type { SystemPromptAssembler } from './chatSession.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { MediaAdmissionService } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import type { AgentRuntimeProviderAdapter } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ReadonlySettingsSnapshot } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';

import { loadAgentRuntime } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import { getErrorMessage } from '@vybestack/llxprt-code-core/utils/errors.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { triggerPreCompressHook } from '@vybestack/llxprt-code-core/core/lifecycleHookTriggers.js';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import { isThinkingSupported } from './clientHelpers.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { TodoContinuationService } from './TodoContinuationService.js';

/**
 * Assembles ephemeral settings into an immutable snapshot for the runtime.
 * Pure function — reads config, no side effects.
 */
export { buildSystemInstruction } from './system-instruction.js';

export interface CreateChatSessionDeps {
  readonly requestDiagnostics?: ProviderRequestDiagnostics;
  readonly telemetry: RootTelemetry;
  readonly providerFileLifecycle?: object;
  readonly composeRetryOperations?: (
    provider: string,
  ) => ProviderRetryOperations;
  readonly historyTokenization?: RuntimeTokenizerFactory['getTokenizer'];
  readonly promptEstimator?: Pick<
    RuntimeTokenizerFactory,
    'estimatePrompt' | 'claimsModel' | 'getEstimatorFamily'
  >;
  profileDefinitions?: Pick<ProfileDefinitionReads, 'loadProfile'>;
  subagentDefinitions?: Pick<SubagentDefinitionReads, 'listSubagents'>;
  prepareProviderInvocation?: PrepareProviderInvocation;
  readRuntimeSettings?: () => ReadonlySettingsSnapshot;
  readToolGovernance?: () => ToolGovernance;
  instructions: InstructionReadOperations;
  providerSelection?: AgentRuntimeProviderAdapter;
  readMcpInstructions: () => string | undefined;
  workspaceDirectories: () => readonly string[];
  config: Config;
  mediaStore: LocalMediaStore;
  runtimeState: AgentRuntimeState;
  contentGenerator: ContentGenerator;
  storedHistoryService: HistoryService | undefined;
  clearStoredHistoryService: () => void;
  extraHistory?: readonly IContent[];
  generateContentConfig: ModelGenerationSettings;
  todoContinuationService: TodoContinuationService;
  toolRegistry: ToolSelection | undefined;
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
  systemInstruction: string,
  tools: ChatSessionConfig['tools'],
): ChatSessionConfig {
  const reasoningConfig = isThinkingSupported(model)
    ? {
        ...baseConfig,
        reasoning: {
          ...(baseConfig.reasoning ?? {}),
          includeInOutput: true,
        },
      }
    : baseConfig;
  return { ...reasoningConfig, systemInstruction, tools };
}

/**
 * Builds the runtime bundle, tool declarations, and ChatSession instance.
 */
async function readActiveTodosPrompt(
  service: TodoContinuationService,
): Promise<string | undefined> {
  const todos = await service.readTodoSnapshot();
  const active = service.getActiveTodos(todos);
  if (active.length === 0) return undefined;
  return active.map((todo) => `- [${todo.status}] ${todo.content}`).join('\n');
}

function assembleChatProviderRuntime(
  config: Config,
  runtimeState: AgentRuntimeState,
  lifecycle: object | undefined,
  composeRetryOperations: CreateChatSessionDeps['composeRetryOperations'],
) {
  const retryOperations = composeRetryOperations?.(runtimeState.provider) ?? {};
  return {
    ...retryOperations,
    config,
    providerFileLifecycle: lifecycle,
    runtimeId: runtimeState.runtimeId,
    metadata: { source: 'AgentClient.startChat' },
  };
}

function bindActiveTodos(
  chat: ChatSession,
  todos: TodoContinuationService,
): ChatSession {
  chat.setActiveTodosProvider(() => readActiveTodosPrompt(todos));
  return chat;
}

function chatDeclarations(
  view: Parameters<typeof buildToolDeclarationsFromView>[1],
  registry: ToolSelection | undefined,
  todos: TodoContinuationService,
) {
  const declarations = buildToolDeclarationsFromView(registry, view);
  todos.updateTodoToolAvailabilityFromDeclarations(declarations);
  return declarations;
}

async function buildChatFromRuntime(
  config: Config,
  mediaStore: LocalMediaStore,
  runtimeState: AgentRuntimeState,
  contentGenerator: ContentGenerator,
  historyService: HistoryService,
  generateContentConfig: ModelGenerationSettings,
  todoContinuationService: TodoContinuationService,
  toolRegistry: ToolSelection | undefined,
  systemInstruction: string,
  systemPromptAssembler: SystemPromptAssembler,
  createChatSessionInstance: NonNullable<
    CreateChatSessionDeps['createChatSessionInstance']
  >,
  loadRuntime: CreateChatSessionDeps['loadRuntime'],
  providerSelection: CreateChatSessionDeps['providerSelection'],
  prepareProviderInvocation: PrepareProviderInvocation,
  readRuntimeSettings: () => ReadonlySettingsSnapshot,
  readToolGovernance: () => ToolGovernance,
  profileDefinitions: CreateChatSessionDeps['profileDefinitions'],
  promptEstimator: CreateChatSessionDeps['promptEstimator'],
  lifecycle: object | undefined,
  composeRetryOperations: CreateChatSessionDeps['composeRetryOperations'],
  telemetry: RootTelemetry,
  requestDiagnostics: ProviderRequestDiagnostics | undefined,
): Promise<ChatSession> {
  const runtimeBundle = await (loadRuntime ?? loadAgentRuntime)({
    mediaStore,
    profile: {
      config,
      telemetry,
      requestDiagnostics,
      state: runtimeState,
      settings: readRuntimeSettings(),
      promptEstimator,
      providerRuntime: assembleChatProviderRuntime(
        config,
        runtimeState,
        lifecycle,
        composeRetryOperations,
      ),
      readRuntimeSettings,
      readToolGovernance,
      prepareProviderInvocation,
      toolRegistry,
    },
    overrides: {
      historyService,
      contentGenerator,
      providerAdapter: providerSelection,
    },
  });

  const tools = chatDeclarations(
    runtimeBundle.toolsView,
    toolRegistry,
    todoContinuationService,
  );

  return bindActiveTodos(
    createChatSessionInstance(
      {
        ...runtimeBundle.runtimeContext,
        prepareProviderInvocation,
        profileDefinitions,
      },
      runtimeBundle.contentGenerator,
      buildGenerateContentConfig(
        generateContentConfig,
        runtimeState.model,
        systemInstruction,
        tools,
      ),
      [],
      triggerPreCompressHook,
      systemPromptAssembler,
    ),
    todoContinuationService,
  );
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
  mediaStore: LocalMediaStore,
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
  const admission = new MediaAdmissionService(mediaStore);
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
    createChatSessionInstance = (...args) => new ChatSession(...args),
  } = deps;
  const logger = new DebugLogger('llxprt:client:start');
  const { historyService, reused } = await setupHistoryService(
    storedHistoryService,
    admittedHistory,
    runtimeState,
    createHistoryService,
  );
  if (deps.historyTokenization !== undefined)
    historyService.setTokenizerFactory({
      getTokenizer: deps.historyTokenization,
    });

  const { model, systemInstruction, systemPromptAssembler } =
    await assembleChatSystemPrompt(deps);

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

  if (
    deps.readRuntimeSettings === undefined ||
    deps.readToolGovernance === undefined ||
    deps.prepareProviderInvocation === undefined
  )
    throw new Error(
      'Chat creation requires explicit session settings and invocation preparation',
    );
  const chat = await buildChatFromRuntime(
    config,
    deps.mediaStore,
    runtimeState,
    contentGenerator,
    historyService,
    generateContentConfig,
    todoContinuationService,
    toolRegistry,
    systemInstruction,
    systemPromptAssembler,
    createChatSessionInstance,
    deps.loadRuntime,
    deps.providerSelection,
    deps.prepareProviderInvocation,
    deps.readRuntimeSettings,
    deps.readToolGovernance,
    deps.profileDefinitions,
    deps.promptEstimator,
    deps.providerFileLifecycle,
    deps.composeRetryOperations,
    deps.telemetry,
    deps.requestDiagnostics,
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
    deps.mediaStore,
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
