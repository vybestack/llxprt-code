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

import { reportError } from '../utils/errorReporting.js';
import { DebugLogger } from '../debug/DebugLogger.js';
import {
  Config,
  ApprovalMode,
  type SchedulerCallbacks,
  type SchedulerOptions,
} from '../config/config.js';
import { type ToolExecutionConfig } from './nonInteractiveToolExecutor.js';
import {
  type Content,
  type FunctionDeclaration,
  type GenerateContentConfig,
  Type,
} from '@google/genai';
import { GeminiChat } from './geminiChat.js';
import type {
  AgentRuntimeContext,
  ReadonlySettingsSnapshot,
  ToolRegistryView,
  ToolMetadata,
} from '../runtime/AgentRuntimeContext.js';
import type { AgentRuntimeLoaderResult } from '../runtime/AgentRuntimeLoader.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import type { ContentGenerator } from './contentGenerator.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { getCoreSystemPromptAsync } from './prompts.js';
import { EmojiFilter, type EmojiFilterMode } from '../filters/EmojiFilter.js';
import { debugLogger } from '../utils/debugLogger.js';
import {
  ContextState,
  templateString,
  type ToolConfig,
  type OutputConfig,
  type ModelConfig,
  type PromptConfig,
  type EnvironmentContextLoader,
} from './subagentTypes.js';

// ---------------------------------------------------------------------------
// Simple utilities
// ---------------------------------------------------------------------------

/** Canonicalizes a tool name for whitelist matching (trim + lowercase). */
export const canonicalizeToolName = (name: string): string =>
  name.trim().toLowerCase();

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

  return {
    name: metadata.name ?? fallbackName,
    description: metadata.description ?? '',
    parameters: {
      ...rawSchema,
      type: (rawSchema.type as Type | undefined) ?? Type.OBJECT,
      properties,
    } as FunctionDeclaration['parameters'],
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export async function validateToolsAgainstRuntime(params: {
  toolConfig: ToolConfig;
  toolRegistry: ToolRegistry;
  toolsView: ToolRegistryView;
}): Promise<void> {
  const { toolConfig, toolsView } = params;
  const allowedNames = new Set(
    (typeof toolsView.listToolNames === 'function'
      ? toolsView.listToolNames()
      : []
    ).map(canonicalizeToolName),
  );

  for (const toolEntry of toolConfig.tools) {
    if (typeof toolEntry !== 'string') {
      continue;
    }

    if (
      allowedNames.size > 0 &&
      !allowedNames.has(canonicalizeToolName(toolEntry))
    ) {
      throw new Error(
        `Tool "${toolEntry}" is not permitted for this runtime bundle.`,
      );
    }
  }
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
    applyToolWhitelistToEphemerals(ephemerals, toolConfig);
  }

  return {
    getToolRegistry: () => toolRegistry,
    getEphemeralSettings: () => ({ ...ephemerals }),
    getEphemeralSetting: (key: string) => ephemerals[key],
    getExcludeTools: () => [],
    getSessionId: () => runtimeBundle.runtimeContext.state.sessionId,
    getTelemetryLogPromptsEnabled: () =>
      Boolean(settingsSnapshot?.telemetry?.enabled),
    getOrCreateScheduler: (sessionId, callbacks, options, dependencies) =>
      foregroundConfig.getOrCreateScheduler(sessionId, callbacks, options, {
        messageBus: dependencies?.messageBus ?? messageBus,
      }),
    disposeScheduler: (sessionId) =>
      foregroundConfig.disposeScheduler(sessionId),
  };
}

/** @internal — applies tool whitelist from toolConfig onto ephemeral settings */
function applyToolWhitelistToEphemerals(
  ephemerals: Record<string, unknown>,
  toolConfig: ToolConfig,
): void {
  const normalizedWhitelist = toolConfig.tools
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.toLowerCase());

  if (normalizedWhitelist.length === 0) return;

  const existingAllowed = Array.isArray(ephemerals['tools.allowed'])
    ? (ephemerals['tools.allowed'] as string[])
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0)
        .map((entry) => entry.toLowerCase())
    : [];

  const allowedSet =
    existingAllowed.length > 0
      ? normalizedWhitelist.filter((entry) => existingAllowed.includes(entry))
      : normalizedWhitelist;

  ephemerals['tools.allowed'] = Array.from(new Set(allowedSet));
}

// ---------------------------------------------------------------------------
// Emoji filter
// ---------------------------------------------------------------------------

export function createEmojiFilter(
  settingsSnapshot?: ReadonlySettingsSnapshot,
): EmojiFilter | undefined {
  const filterMode =
    (settingsSnapshot?.emojifilter as EmojiFilterMode) ?? 'auto';

  if (filterMode === 'allowed') {
    const noFilter: EmojiFilter | undefined = void 0;
    return noFilter;
  }

  return new EmojiFilter({ mode: filterMode });
}

// ---------------------------------------------------------------------------
// Function declarations
// ---------------------------------------------------------------------------

export function buildRuntimeFunctionDeclarations(
  toolsView: ToolRegistryView,
  toolConfig: ToolConfig | undefined,
): FunctionDeclaration[] {
  if (!toolConfig || toolConfig.tools.length === 0) {
    const noFunctionDeclarations: FunctionDeclaration[] = [];
    return noFunctionDeclarations;
  }

  const listedNames =
    typeof toolsView.listToolNames === 'function'
      ? toolsView.listToolNames()
      : [];
  const allowedNames = new Set(listedNames.map(canonicalizeToolName));

  const declarations: FunctionDeclaration[] = [];
  for (const entry of toolConfig.tools) {
    if (typeof entry !== 'string') {
      declarations.push(entry);
      continue;
    }

    if (
      allowedNames.size > 0 &&
      !allowedNames.has(canonicalizeToolName(entry))
    ) {
      debugLogger.warn(
        `Tool "${entry}" is not permitted by the runtime view and is skipped.`,
      );
      continue;
    }

    const metadata = toolsView.getToolMetadata(entry);
    if (!metadata) {
      debugLogger.warn(
        `Tool "${entry}" is not available in the runtime view and is skipped.`,
      );
      continue;
    }

    declarations.push(convertMetadataToFunctionDeclaration(entry, metadata));
  }
  return declarations;
}

export function getScopeLocalFuncDefs(
  outputConfig?: OutputConfig,
): FunctionDeclaration[] {
  if (!outputConfig || !outputConfig.outputs) {
    return [];
  }

  const emitValueTool: FunctionDeclaration = {
    name: 'self_emitvalue',
    description: `* This tool emits A SINGLE return value from this execution, such that it can be collected and presented to the calling function.
        * You can only emit ONE VALUE each time you call this tool. You are expected to call this tool MULTIPLE TIMES if you have MULTIPLE OUTPUTS.`,
    parameters: {
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
  if (!promptConfig.systemPrompt) {
    return '';
  }

  let finalPrompt = templateString(promptConfig.systemPrompt, context);

  if (outputConfig && outputConfig.outputs) {
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

export function createSchedulerConfig(
  toolExecutorContext: ToolExecutionConfig,
  foregroundConfig: Config,
  options?: { interactive?: boolean },
): Config {
  const isInteractive = options?.interactive ?? false;

  const getEphemeralSettings =
    typeof toolExecutorContext.getEphemeralSettings === 'function'
      ? () => ({
          ...toolExecutorContext.getEphemeralSettings(),
        })
      : () => foregroundConfig.getEphemeralSettings();

  const getEphemeralSetting = (key: string): unknown => {
    const settings = getEphemeralSettings();
    return settings[key];
  };

  const getExcludeTools =
    typeof toolExecutorContext.getExcludeTools === 'function'
      ? () => toolExecutorContext.getExcludeTools()
      : () => foregroundConfig.getExcludeTools?.() ?? [];

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

  // Partial Config adapter for CoreToolScheduler — only the methods the
  // scheduler and tool-execution paths actually call are implemented.

  return {
    getToolRegistry: () => toolExecutorContext.getToolRegistry(),
    getSessionId: () => toolExecutorContext.getSessionId(),
    getEphemeralSettings,
    getEphemeralSetting,
    getExcludeTools,
    getTelemetryLogPromptsEnabled,
    getAllowedTools,
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
      },
    ) =>
      foregroundConfig.getOrCreateScheduler(
        sessionId,
        callbacks,
        { ...schedulerOptions, interactiveMode: isInteractive },
        dependencies,
      ),
    disposeScheduler: (sessionId: string) => {
      foregroundConfig.disposeScheduler(sessionId);
    },
    getEnableHooks: () => foregroundConfig.getEnableHooks?.() ?? false,
    getHooks: () => foregroundConfig.getHooks?.(),
    getHookSystem: () => foregroundConfig.getHookSystem?.(),
    getWorkingDir: () => foregroundConfig.getWorkingDir?.() ?? process.cwd(),
    getTargetDir: () => foregroundConfig.getTargetDir?.() ?? process.cwd(),
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
): Promise<GeminiChat | null> {
  const { promptConfig, modelConfig, outputConfig, toolConfig } = params;
  const { runtimeContext, contentGenerator, environmentContextLoader } = params;
  const { foregroundConfig: config, context } = params;
  const logger = new DebugLogger('llxprt:subagent');

  if (!promptConfig.systemPrompt && !promptConfig.initialMessages) {
    throw new Error(
      'PromptConfig must have either `systemPrompt` or `initialMessages` defined.',
    );
  }
  if (promptConfig.systemPrompt && promptConfig.initialMessages) {
    throw new Error(
      'PromptConfig cannot have both `systemPrompt` and `initialMessages` defined.',
    );
  }

  const startHistory = [...(promptConfig.initialMessages ?? [])];
  const personaPrompt = promptConfig.systemPrompt
    ? buildChatSystemPrompt(promptConfig, outputConfig, context)
    : '';

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
        .map((d) => d?.name?.trim())
        .filter((name): name is string => Boolean(name && name.length > 0)),
    ),
  );

  const mcpInstructions = config.getMcpClientManager()?.getMcpInstructions();
  const coreSystemPrompt = await getCoreSystemPromptAsync({
    mcpInstructions,
    model: modelConfig.model,
    tools: toolNames,
    includeSubagentDelegation: false,
    interactionMode: 'subagent',
  });

  const instructionSections = [
    envContextText,
    coreSystemPrompt?.trim() ?? '',
    personaPrompt?.trim() ?? '',
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
): GeminiChat | null {
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

    return new GeminiChat(
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
    const missingChatObject: GeminiChat | null = null;
    return missingChatObject;
  }
}
