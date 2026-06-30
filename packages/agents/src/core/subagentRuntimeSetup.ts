/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Execution environment preparation for subagents.
 * Contains standalone functions for validation, configuration building,
 * chat object creation, and prompt assembly.
 *
 * Extracted from subagent.ts as part of Issue #1581 (Phase 2).
 */

import { reportError } from '@vybestack/llxprt-code-core/utils/errorReporting.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ToolSchedulerContract } from '@vybestack/llxprt-code-core/core/toolSchedulerContract.js';
import {
  ApprovalMode,
  type SchedulerCallbacks,
  type SchedulerOptions,
} from '@vybestack/llxprt-code-core/config/config.js';
import { type ToolExecutionConfig } from './nonInteractiveToolExecutor.js';
import {
  type Content,
  type FunctionDeclaration,
  type GenerateContentConfig,
  Type,
} from '@google/genai';
import { ChatSession } from './chatSession.js';
import type {
  AgentRuntimeContext,
  ReadonlySettingsSnapshot,
  ToolRegistryView,
  ToolMetadata,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { AgentRuntimeLoaderResult } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import {
  canonicalizeToolName,
  INVALID_TOOL_NAME,
} from '@vybestack/llxprt-code-tools';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { getExplicitToolNameCandidates } from './toolGovernance.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { getCoreSystemPromptAsync } from '@vybestack/llxprt-code-core/core/prompts.js';
import {
  EmojiFilter,
  type EmojiFilterMode,
} from '@vybestack/llxprt-code-core/filters/EmojiFilter.js';
import { debugLogger } from '@vybestack/llxprt-code-core/utils/debugLogger.js';
import type { ContextState } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import {
  templateString,
  type ToolConfig,
  type OutputConfig,
  type ModelConfig,
  type PromptConfig,
  type EnvironmentContextLoader,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';

// ---------------------------------------------------------------------------
// Simple utilities
// ---------------------------------------------------------------------------

/**
 * Tools that must never be exposed to a subagent because they would allow
 * nested subagent spawning (recursive task delegation) or enumeration of the
 * parent's subagent registry from within a sandboxed runtime.
 */
const SUBAGENT_EXCLUDED_TOOLS: ReadonlySet<string> = new Set(
  ['task', 'list_subagents'].map(canonicalizeToolName),
);

/**
 * Returns true when a canonical (or raw) tool name is excluded from subagent
 * runtimes (task/list_subagents).
 */
function isSubagentExcludedToolName(name: string): boolean {
  return getExplicitToolNameCandidates(name).some((candidate) =>
    SUBAGENT_EXCLUDED_TOOLS.has(candidate),
  );
}

/**
 * Returns true when a non-string FunctionDeclaration entry is excluded from
 * subagent runtimes (task/list_subagents). Declarations without a usable
 * string name are never excluded.
 */
function isSubagentExcludedDeclaration(decl: unknown): boolean {
  if (typeof decl !== 'object' || decl === null || !('name' in decl)) {
    return false;
  }

  const declName = decl.name;
  return typeof declName === 'string' && isSubagentExcludedToolName(declName);
}

function getDeclarationWhitelistName(decl: unknown): string | undefined {
  if (typeof decl !== 'object' || decl === null || !('name' in decl)) {
    return undefined;
  }

  const declName = decl.name;
  if (typeof declName !== 'string' || isSubagentExcludedToolName(declName)) {
    return undefined;
  }

  return getExplicitToolNameCandidates(declName)[0];
}

function resolveAllowedToolEntryCanonical(
  name: string,
  allowedNames: ReadonlySet<string>,
): string | undefined {
  const candidates = getExplicitToolNameCandidates(name);
  return candidates.find((candidate) => allowedNames.has(candidate));
}

/**
 * Converts a ToolMetadata object into a FunctionDeclaration for the Gemini API.
 */
export function convertMetadataToFunctionDeclaration(
  fallbackName: string,
  metadata: ToolMetadata,
): FunctionDeclaration {
  const rawSchema =
    metadata.parameterSchema && typeof metadata.parameterSchema === 'object'
      ? { ...metadata.parameterSchema }
      : {};
  const properties =
    (rawSchema.properties as Record<string, unknown> | undefined) ?? {};

  const parameterType = (rawSchema.type as Type | undefined) ?? Type.OBJECT;
  const parameterProperties = { ...properties };
  const parametersJsonSchema: Record<string, unknown> = {
    ...rawSchema,
    type: parameterType,
    properties: parameterProperties,
  };

  const runtimeMetadata = metadata as Partial<ToolMetadata>;

  return {
    name: runtimeMetadata.name ?? fallbackName,
    description: runtimeMetadata.description ?? '',
    parametersJsonSchema,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function filterToolEntry(
  toolEntry: ToolConfig['tools'][number],
  allowedNames: Set<string>,
): { shouldInclude: boolean; value: ToolConfig['tools'][number] } {
  if (typeof toolEntry !== 'string') {
    return { shouldInclude: true, value: toolEntry };
  }

  if (
    allowedNames.size > 0 &&
    !resolveAllowedToolEntryCanonical(toolEntry, allowedNames)
  ) {
    debugLogger.warn(
      `Tool "${toolEntry}" is not permitted by the runtime view and is skipped.`,
    );
    return { shouldInclude: false, value: toolEntry };
  }

  return { shouldInclude: true, value: toolEntry };
}

/**
 * Filters the tools in toolConfig against the allowed set from the runtime view.
 * Returns a new ToolConfig with only the tools that are permitted.
 * Tools not in the allowed set are logged as warnings and removed.
 *
 * @param params - Object containing toolConfig and toolsView
 * @returns A Promise that resolves to a filtered ToolConfig
 */
export async function filterToolsAgainstRuntime(params: {
  toolConfig: ToolConfig;
  toolsView: ToolRegistryView;
}): Promise<ToolConfig> {
  const { toolConfig, toolsView } = params;
  const allowedNames = new Set(
    (typeof toolsView.listToolNames === 'function'
      ? toolsView.listToolNames()
      : []
    ).map(canonicalizeToolName),
  );

  const filteredTools: ToolConfig['tools'] = [];
  for (const toolEntry of toolConfig.tools) {
    const result = filterToolEntry(toolEntry, allowedNames);
    if (result.shouldInclude) {
      filteredTools.push(result.value);
    }
  }

  return {
    ...toolConfig,
    tools: filteredTools,
  };
}

// ---------------------------------------------------------------------------
// Ephemeral settings & tool execution config
// ---------------------------------------------------------------------------

export function buildEphemeralSettings(
  snapshot?: ReadonlySettingsSnapshot,
): Record<string, unknown> {
  const ephemerals: Record<string, unknown> = {};

  if (!snapshot) {
    ephemerals.emojifilter = 'auto';
    return ephemerals;
  }

  if (snapshot.emojifilter !== undefined) {
    ephemerals.emojifilter = snapshot.emojifilter;
  } else {
    ephemerals.emojifilter = 'auto';
  }

  if (snapshot.tools?.allowed) {
    ephemerals['tools.allowed'] = [...snapshot.tools.allowed];
  }
  if (snapshot.tools?.disabled) {
    ephemerals['tools.disabled'] = [...snapshot.tools.disabled];
  }

  return ephemerals;
}

/**
 * Creates the bottom-layer tool execution configuration for subagents.
 *
 * This is the single source of truth for tool-related configuration in the
 * subagent, including scheduler creation. It interfaces directly with
 * `foregroundConfig` and is responsible for injecting default dependencies
 * (`messageBus` and `toolRegistry`) that callers may not provide.
 *
 * Delegation chain: createSchedulerConfig → toolExecutorContext → foregroundConfig
 */
export function createToolExecutionConfig(
  runtimeBundle: AgentRuntimeLoaderResult,
  toolRegistry: ToolRegistry,
  foregroundConfig: Config,
  messageBus?: MessageBus,
  settingsSnapshot?: ReadonlySettingsSnapshot,
  toolConfig?: ToolConfig,
): ToolExecutionConfig {
  const ephemerals = buildEphemeralSettings(settingsSnapshot);

  if (toolConfig && Array.isArray(toolConfig.tools)) {
    applyToolWhitelistToEphemerals(ephemerals, toolConfig, toolRegistry);
  }

  return {
    getToolRegistry: () => toolRegistry,
    getEphemeralSettings: () => ({ ...ephemerals }),
    getEphemeralSetting: (key: string) => ephemerals[key],
    // Issue #2069: scheduler governance must fail-closed for subagent-excluded
    // tools (task/list_subagents) so they can never be executed by a subagent
    // runtime, regardless of registry resolution or ephemeral whitelist state.
    getExcludeTools: () => Array.from(SUBAGENT_EXCLUDED_TOOLS),
    getSessionId: () => runtimeBundle.runtimeContext.state.sessionId,
    getTelemetryLogPromptsEnabled: () =>
      Boolean(settingsSnapshot?.telemetry?.enabled),
    getOrCreateScheduler: (sessionId, callbacks, options, dependencies) =>
      foregroundConfig.getOrCreateScheduler(sessionId, callbacks, options, {
        messageBus: dependencies?.messageBus ?? messageBus,
        toolRegistry: dependencies?.toolRegistry ?? toolRegistry,
      }),
    disposeScheduler: (sessionId) =>
      foregroundConfig.disposeScheduler(sessionId),
  };
}

interface ToolRegistryWhitelistView {
  getEnabledTools?: ToolRegistry['getEnabledTools'];
}

/** @internal — applies tool whitelist from toolConfig onto ephemeral settings */
function applyToolWhitelistToEphemerals(
  ephemerals: Record<string, unknown>,
  toolConfig: ToolConfig,
  toolRegistry: ToolRegistryWhitelistView,
): void {
  const registryNames =
    typeof toolRegistry.getEnabledTools === 'function'
      ? new Set(
          toolRegistry
            .getEnabledTools()
            .flatMap((tool) => getExplicitToolNameCandidates(tool.name)),
        )
      : undefined;
  if (registryNames !== undefined && registryNames.size === 0) {
    debugLogger.warn(
      'Registry has no enabled tools; all whitelist entries will be dropped and tools.allowed will fail-closed to [].',
    );
  }
  const normalizedStringWhitelist = toolConfig.tools
    .filter((entry): entry is string => typeof entry === 'string')
    .filter((entry) => !isSubagentExcludedToolName(entry))
    .map((entry) => {
      if (registryNames !== undefined) {
        const resolved = resolveAllowedToolEntryCanonical(entry, registryNames);
        if (resolved === undefined) {
          debugLogger.warn(
            `Tool "${entry}" is not in the registry and is skipped.`,
          );
        }
        return resolved;
      }
      const candidates = getExplicitToolNameCandidates(entry);
      if (candidates.length === 0) {
        debugLogger.warn(`Tool "${entry}" has an invalid name and is skipped.`);
        return undefined;
      }
      return candidates[0];
    })
    .filter(
      (entry): entry is string =>
        entry !== undefined && entry !== INVALID_TOOL_NAME && entry.length > 0,
    );
  const declarationWhitelist = toolConfig.tools
    .filter((entry) => typeof entry !== 'string')
    .map(getDeclarationWhitelistName)
    .filter((entry): entry is string => entry !== undefined);
  const normalizedWhitelist = [
    ...normalizedStringWhitelist,
    ...declarationWhitelist,
  ];

  // Explicit empty/fail-closed: preserve tools.allowed=[] so the scheduler
  // does not fall back to parent/default allowed tools.
  if (normalizedWhitelist.length === 0) {
    ephemerals['tools.allowed'] = [];
    return;
  }

  const existingAllowedValue = ephemerals['tools.allowed'];
  const hasExistingAllowed = Array.isArray(existingAllowedValue);
  const existingAllowed = hasExistingAllowed
    ? new Set(
        existingAllowedValue
          .filter((entry): entry is string => typeof entry === 'string')
          .flatMap(getExplicitToolNameCandidates)
          .filter(
            (entry) =>
              entry !== INVALID_TOOL_NAME &&
              entry.length > 0 &&
              !isSubagentExcludedToolName(entry),
          ),
      )
    : new Set<string>();

  const allowedSet = hasExistingAllowed
    ? normalizedWhitelist.filter((entry) =>
        getExplicitToolNameCandidates(entry).some((candidate) =>
          existingAllowed.has(candidate),
        ),
      )
    : normalizedWhitelist;

  ephemerals['tools.allowed'] = Array.from(new Set(allowedSet));
}

// ---------------------------------------------------------------------------
// Emoji filter
// ---------------------------------------------------------------------------

export function createEmojiFilter(
  settingsSnapshot?: ReadonlySettingsSnapshot,
): EmojiFilter | undefined {
  const rawFilterMode = settingsSnapshot?.emojifilter;
  const filterMode: EmojiFilterMode = rawFilterMode ?? 'auto';

  if (filterMode === 'allowed') {
    const noFilter: EmojiFilter | undefined = void 0;
    return noFilter;
  }

  return new EmojiFilter({ mode: filterMode });
}

// ---------------------------------------------------------------------------
// Function declarations
// ---------------------------------------------------------------------------

function resolveDeclarationEntry(
  entry: ToolConfig['tools'][number],
  ctx: {
    allowedNames: Set<string>;
    toolsView: ToolRegistryView;
    registryNameByCanonical: Map<string, string>;
  },
): FunctionDeclaration | null {
  if (typeof entry !== 'string') {
    if (isSubagentExcludedDeclaration(entry)) {
      return null;
    }
    return entry;
  }

  if (isSubagentExcludedToolName(entry)) {
    return null;
  }

  const candidates = getExplicitToolNameCandidates(entry);
  if (candidates.length === 0) {
    debugLogger.warn(`Tool "${entry}" has an invalid name and is skipped.`);
    return null;
  }

  let resolvedName: string;
  if (ctx.allowedNames.size > 0) {
    const canonical = candidates.find((candidate) =>
      ctx.allowedNames.has(candidate),
    );
    if (!canonical) {
      debugLogger.warn(
        `Tool "${entry}" is not permitted by the runtime view and is skipped.`,
      );
      return null;
    }
    resolvedName = ctx.registryNameByCanonical.get(canonical) ?? canonical;
  } else {
    const registryCanonical = candidates.find((candidate) =>
      ctx.registryNameByCanonical.has(candidate),
    );
    resolvedName = registryCanonical
      ? (ctx.registryNameByCanonical.get(registryCanonical) ??
        registryCanonical)
      : candidates[0];
  }
  const namesToTry = [
    resolvedName,
    ...candidates.filter((candidate) => candidate !== resolvedName),
  ];
  for (const name of Array.from(new Set(namesToTry))) {
    const metadata = ctx.toolsView.getToolMetadata(name);
    if (metadata) {
      return convertMetadataToFunctionDeclaration(name, metadata);
    }
  }

  debugLogger.warn(
    `Tool "${entry}" is not available in the runtime view and is skipped.`,
  );
  return null;
}

export function buildRuntimeFunctionDeclarations(
  toolsView: ToolRegistryView,
  toolConfig: ToolConfig | undefined,
): FunctionDeclaration[] {
  const listedNames =
    typeof toolsView.listToolNames === 'function'
      ? toolsView.listToolNames()
      : [];
  const registryNameByCanonical = new Map<string, string>();
  for (const name of listedNames) {
    const canonical = canonicalizeToolName(name);
    if (canonical && !registryNameByCanonical.has(canonical)) {
      registryNameByCanonical.set(canonical, name);
    }
  }
  const allowedNames = new Set(registryNameByCanonical.keys());

  const declarations: FunctionDeclaration[] = [];

  if (toolConfig === undefined) {
    for (const name of listedNames) {
      if (isSubagentExcludedToolName(name)) {
        continue;
      }
      const metadata = toolsView.getToolMetadata(name);
      if (metadata) {
        declarations.push(convertMetadataToFunctionDeclaration(name, metadata));
      } else {
        debugLogger.warn(
          `Tool "${name}" is not available in the runtime view and is skipped.`,
        );
      }
    }
    return declarations;
  }

  if (toolConfig.tools.length === 0) {
    const noFunctionDeclarations: FunctionDeclaration[] = [];
    return noFunctionDeclarations;
  }

  for (const entry of toolConfig.tools) {
    const result = resolveDeclarationEntry(entry, {
      allowedNames,
      toolsView,
      registryNameByCanonical,
    });
    if (result) {
      declarations.push(result);
    }
  }
  return declarations;
}

export function getScopeLocalFuncDefs(
  outputConfig?: OutputConfig,
): FunctionDeclaration[] {
  if (!outputConfig?.outputs) {
    return [];
  }

  const emitValueTool: FunctionDeclaration = {
    name: 'self_emitvalue',
    description: `* This tool emits A SINGLE return value from this execution, such that it can be collected and presented to the calling function.
        * You can only emit ONE VALUE each time you call this tool. You are expected to call this tool MULTIPLE TIMES if you have MULTIPLE OUTPUTS.`,
    parametersJsonSchema: {
      type: Type.OBJECT,
      properties: {
        emit_variable_name: {
          description: 'This is the name of the variable to be returned.',
          type: Type.STRING,
        },
        emit_variable_value: {
          description: 'This is the _value_ to be returned for this variable.',
          type: Type.STRING,
        },
      },
      required: ['emit_variable_name', 'emit_variable_value'],
    },
  };

  return [emitValueTool];
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export function buildChatSystemPrompt(
  promptConfig: PromptConfig,
  outputConfig: OutputConfig | undefined,
  context: ContextState,
): string {
  let finalPrompt = templateString(promptConfig.systemPrompt, context);

  if (outputConfig?.outputs) {
    let outputInstructions =
      '\n\nAfter you have achieved all other goals, you MUST emit the required output variables. For each expected output, make one final call to the `self_emitvalue` tool.';

    for (const [key, value] of Object.entries(outputConfig.outputs)) {
      outputInstructions += `\n* Use 'self_emitvalue' to emit the '${key}' key, with a value described as: '${value}'`;
    }
    finalPrompt += outputInstructions;
  }

  finalPrompt += `

Important Rules:
 * You are running in a non-interactive mode. You CANNOT ask the user for input or clarification. You must proceed with the information you have.
 * Once you believe all goals have been met and all required outputs have been emitted, stop calling tools.`;

  return finalPrompt;
}

// ---------------------------------------------------------------------------
// Scheduler config
// ---------------------------------------------------------------------------

type DefensiveConfig = {
  getExcludeTools?: () => string[];
  getEphemeralSettings?: () => Record<string, unknown>;
};

function resolveConfigAccessors(
  toolExecutorContext: ToolExecutionConfig,
  foregroundConfig: Config,
  defensiveConfig: DefensiveConfig,
): Pick<
  Config,
  | 'getEphemeralSettings'
  | 'getEphemeralSetting'
  | 'getExcludeTools'
  | 'getTelemetryLogPromptsEnabled'
  | 'getAllowedTools'
> {
  const getEphemeralSettings =
    typeof toolExecutorContext.getEphemeralSettings === 'function'
      ? () => ({ ...toolExecutorContext.getEphemeralSettings() })
      : () => ({ ...(defensiveConfig.getEphemeralSettings?.() ?? {}) });

  const getEphemeralSetting = (key: string): unknown =>
    getEphemeralSettings()[key];

  const getExcludeTools =
    typeof toolExecutorContext.getExcludeTools === 'function'
      ? () => toolExecutorContext.getExcludeTools()
      : () => defensiveConfig.getExcludeTools?.() ?? [];

  const getTelemetryLogPromptsEnabled =
    typeof toolExecutorContext.getTelemetryLogPromptsEnabled === 'function'
      ? () => toolExecutorContext.getTelemetryLogPromptsEnabled()
      : () => foregroundConfig.getTelemetryLogPromptsEnabled();

  const getAllowedTools = (): string[] | undefined => {
    const ephemerals = getEphemeralSettings();
    const allowed = ephemerals['tools.allowed'];
    if (Array.isArray(allowed)) {
      return allowed.filter(
        (entry): entry is string => typeof entry === 'string',
      );
    }
    return typeof foregroundConfig.getAllowedTools === 'function'
      ? foregroundConfig.getAllowedTools()
      : undefined;
  };

  return {
    getEphemeralSettings,
    getEphemeralSetting,
    getExcludeTools,
    getTelemetryLogPromptsEnabled,
    getAllowedTools,
  };
}

/**
 * Creates a higher-level Config facade for the CoreToolScheduler.
 *
 * This facade delegates scheduler operations (`getOrCreateScheduler`,
 * `disposeScheduler`) through `toolExecutorContext` rather than bypassing
 * it. The only policy this layer adds is the `interactiveMode` flag.
 *
 * Delegation chain: createSchedulerConfig → toolExecutorContext → foregroundConfig
 */
export function createSchedulerConfig(
  toolExecutorContext: ToolExecutionConfig,
  foregroundConfig: Config,
  options?: { interactive?: boolean },
): Config {
  const isInteractive = options?.interactive ?? false;

  // Defensive runtime guard: test doubles and bootstrap configs may not
  // implement every Config method despite the declared types.
  const defensiveConfig = foregroundConfig as unknown as {
    getEphemeralSettings?: () => Record<string, unknown>;
    getExcludeTools?: () => string[];
    getTelemetryLogPromptsEnabled?: () => boolean;
    getAllowedTools?: () => string[] | undefined;
    getToolRegistry?: () => unknown;
    getOrCreateScheduler?: (
      sessionId: string,
      callbacks: unknown,
      options: unknown,
      deps: unknown,
    ) => Promise<ToolSchedulerContract>;
    disposeScheduler?: (sessionId: string) => void;
    getEnableHooks?: () => boolean;
    getHooks?: () => unknown;
    getHookSystem?: () => unknown;
    getWorkingDir?: () => string;
    getTargetDir?: () => string;
  };

  const accessors = resolveConfigAccessors(
    toolExecutorContext,
    foregroundConfig,
    defensiveConfig,
  );

  return {
    getToolRegistry: () => toolExecutorContext.getToolRegistry(),
    getSessionId: () => toolExecutorContext.getSessionId(),
    ...accessors,
    getApprovalMode: () =>
      typeof foregroundConfig.getApprovalMode === 'function'
        ? foregroundConfig.getApprovalMode()
        : ApprovalMode.DEFAULT,
    getPolicyEngine: () => foregroundConfig.getPolicyEngine(),
    getOrCreateScheduler: (
      sessionId: string,
      callbacks: SchedulerCallbacks,
      schedulerOptions?: SchedulerOptions,
      dependencies?: {
        messageBus?: MessageBus;
        toolRegistry?: ToolRegistry;
      },
    ) =>
      toolExecutorContext.getOrCreateScheduler(
        sessionId,
        callbacks,
        { ...schedulerOptions, interactiveMode: isInteractive },
        dependencies,
      ),
    disposeScheduler: (sessionId: string) => {
      toolExecutorContext.disposeScheduler(sessionId);
    },
    getEnableHooks: () => defensiveConfig.getEnableHooks?.() ?? false,
    getHooks: () => defensiveConfig.getHooks?.(),
    getHookSystem: () => defensiveConfig.getHookSystem?.(),
    getWorkingDir: () => defensiveConfig.getWorkingDir?.() ?? process.cwd(),
    getTargetDir: () => defensiveConfig.getTargetDir?.() ?? process.cwd(),
  } as unknown as Config;
}

// ---------------------------------------------------------------------------
// Chat object creation
// ---------------------------------------------------------------------------

export interface CreateChatObjectParams {
  promptConfig: PromptConfig;
  modelConfig: ModelConfig;
  outputConfig?: OutputConfig;
  toolConfig?: ToolConfig;
  runtimeContext: AgentRuntimeContext;
  contentGenerator: ContentGenerator;
  environmentContextLoader: EnvironmentContextLoader;
  foregroundConfig: Config;
  context: ContextState;
}

export async function createChatObject(
  params: CreateChatObjectParams,
): Promise<ChatSession | null> {
  const { promptConfig, modelConfig, outputConfig, toolConfig } = params;
  const { runtimeContext, contentGenerator, environmentContextLoader } = params;
  const { foregroundConfig: config, context } = params;
  const logger = new DebugLogger('llxprt:subagent');

  if (
    typeof promptConfig.systemPrompt !== 'string' ||
    promptConfig.systemPrompt.trim().length === 0
  ) {
    throw new Error('PromptConfig.systemPrompt must be a non-empty string.');
  }

  const startHistory: Content[] = [];
  const personaPrompt = buildChatSystemPrompt(
    promptConfig,
    outputConfig,
    context,
  );

  const runtimeDecls = buildRuntimeFunctionDeclarations(
    runtimeContext.tools,
    toolConfig,
  );
  const scopeLocalDecls = getScopeLocalFuncDefs(outputConfig);
  const combinedDeclarations = [...runtimeDecls, ...scopeLocalDecls];

  const systemInstruction = await buildSystemInstruction(
    environmentContextLoader,
    runtimeContext,
    modelConfig,
    combinedDeclarations,
    config,
    personaPrompt,
    logger,
  );

  return instantiateChat(
    modelConfig,
    systemInstruction,
    combinedDeclarations,
    startHistory,
    runtimeContext,
    contentGenerator,
    logger,
  );
}

async function buildSystemInstruction(
  environmentContextLoader: EnvironmentContextLoader,
  runtimeContext: AgentRuntimeContext,
  modelConfig: ModelConfig,
  combinedDeclarations: FunctionDeclaration[],
  config: Config,
  personaPrompt: string,
  logger: { debug: (fn: () => string) => void },
): Promise<string> {
  const envParts = await environmentContextLoader(runtimeContext);
  const envContextText = envParts
    .map((part) => ('text' in part ? part.text : ''))
    .join('\n')
    .trim();

  const toolNames = Array.from(
    new Set(
      combinedDeclarations
        .map((d) => (d as Partial<FunctionDeclaration>).name?.trim())
        .filter((name): name is string => Boolean(name && name.length > 0)),
    ),
  );

  const mcpInstructions = config.getMcpClientManager()?.getMcpInstructions();
  const coreSystemPrompt: unknown = await getCoreSystemPromptAsync({
    mcpInstructions,
    model: modelConfig.model,
    tools: toolNames,
    includeSubagentDelegation: false,
    interactionMode: 'subagent',
  });
  const corePromptText =
    typeof coreSystemPrompt === 'string' ? coreSystemPrompt.trim() : '';

  const instructionSections = [
    envContextText,
    corePromptText,
    personaPrompt.trim(),
  ].filter((section) => section.length > 0);

  const systemInstruction =
    instructionSections.length > 0 ? instructionSections.join('\n\n') : '';

  logger.debug(() => {
    const preview =
      systemInstruction && systemInstruction.length > 0
        ? systemInstruction.slice(0, 1200)
        : '<empty>';
    return `System instruction preview: ${preview}`;
  });

  return systemInstruction;
}

function instantiateChat(
  modelConfig: ModelConfig,
  systemInstruction: string,
  combinedDeclarations: FunctionDeclaration[],
  startHistory: Content[],
  runtimeContext: AgentRuntimeContext,
  contentGenerator: ContentGenerator,
  _logger: { debug: (fn: () => string) => void },
): ChatSession | null {
  try {
    const generationConfig: GenerateContentConfig & {
      systemInstruction?: string | Content;
    } = {
      temperature: modelConfig.temp,
      topP: modelConfig.top_p,
      systemInstruction: systemInstruction || undefined,
      tools:
        combinedDeclarations.length > 0
          ? [{ functionDeclarations: combinedDeclarations }]
          : undefined,
    };

    return new ChatSession(
      runtimeContext,
      contentGenerator,
      generationConfig,
      startHistory,
    );
  } catch (error) {
    void reportError(
      error,
      'Error initializing Gemini chat session.',
      startHistory,
      'startChat',
    );
    const missingChatObject: ChatSession | null = null;
    return missingChatObject;
  }
}
