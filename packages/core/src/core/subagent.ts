/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251028-STATELESS6.P08
 * @requirement REQ-STAT6-001.1, REQ-STAT6-003.1
 * @pseudocode agent-runtime-context.md lines 92-101
 */
import { reportError } from '../utils/errorReporting.js';
import { DebugLogger } from '../debug/DebugLogger.js';
import { Config, ApprovalMode } from '../config/config.js';
import { ToolCallRequestInfo, GeminiEventType, Turn } from './turn.js';
import {
  executeToolCall,
  type ToolExecutionConfig,
} from './nonInteractiveToolExecutor.js';
import {
  Content,
  Part,
  FunctionCall,
  GenerateContentConfig,
  FunctionDeclaration,
  Type,
} from '@google/genai';
import { GeminiChat, StreamEventType } from './geminiChat.js';
import type {
  AgentRuntimeContext,
  ReadonlySettingsSnapshot,
  ToolRegistryView,
  ToolMetadata,
} from '../runtime/AgentRuntimeContext.js';
import type { AgentRuntimeLoaderResult } from '../runtime/AgentRuntimeLoader.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import { GemmaToolCallParser } from '../parsers/TextToolCallParser.js';
import { TodoStore } from '../tools/todo-store.js';
import { ToolResultDisplay } from '../tools/tools.js';
import {
  CoreToolScheduler,
  type CompletedToolCall,
  type OutputUpdateHandler,
} from './coreToolScheduler.js';
import type { SubagentSchedulerFactory } from './subagentScheduler.js';
import { ToolErrorType } from '../tools/tool-error.js';
import { getCoreSystemPromptAsync } from './prompts.js';

/**
 * @fileoverview Defines the configuration interfaces for a subagent.
 *
 * These interfaces specify the structure for defining the subagent's prompt,
 * the model parameters, and the execution settings.
 */

/**
 * Describes the possible termination modes for a subagent.
 * This enum provides a clear indication of why a subagent's execution might have ended.
 */
export enum SubagentTerminateMode {
  /**
   * Indicates that the subagent's execution terminated due to an unrecoverable error.
   */
  ERROR = 'ERROR',
  /**
   * Indicates that the subagent's execution terminated because it exceeded the maximum allowed working time.
   */
  TIMEOUT = 'TIMEOUT',
  /**
   * Indicates that the subagent's execution successfully completed all its defined goals.
   */
  GOAL = 'GOAL',
  /**
   * Indicates that the subagent's execution terminated because it exceeded the maximum number of turns.
   */
  MAX_TURNS = 'MAX_TURNS',
}

/**
 * Represents the output structure of a subagent's execution.
 * This interface defines the data that a subagent will return upon completion,
 * including any emitted variables and the reason for its termination.
 */
export interface OutputObject {
  /**
   * A record of key-value pairs representing variables emitted by the subagent
   * during its execution. These variables can be used by the calling agent.
   */
  emitted_vars: Record<string, string>;
  /**
   * The final natural language response produced by the subagent (if any).
   */
  final_message?: string;
  /**
   * The reason for the subagent's termination, indicating whether it completed
   * successfully, timed out, or encountered an error.
   */
  terminate_reason: SubagentTerminateMode;
}

/**
 * Configures the initial prompt for the subagent.
 */
export interface PromptConfig {
  /**
   * A single system prompt string that defines the subagent's persona and instructions.
   * Note: You should use either `systemPrompt` or `initialMessages`, but not both.
   */
  systemPrompt?: string;

  /**
   * An array of user/model content pairs to seed the chat history for few-shot prompting.
   * Note: You should use either `systemPrompt` or `initialMessages`, but not both.
   */
  initialMessages?: Content[];
}

/**
 * Configures the tools available to the subagent during its execution.
 */
export interface ToolConfig {
  /**
   * A list of tool names (from the tool registry) or full function declarations
   * that the subagent is permitted to use.
   */
  tools: Array<string | FunctionDeclaration>;
}

/**
 * Configures the expected outputs for the subagent.
 */
export interface OutputConfig {
  /**
   * A record describing the variables the subagent is expected to emit.
   * The subagent will be prompted to generate these values before terminating.
   */
  outputs: Record<string, string>;
}

export interface SubAgentRuntimeOverrides {
  settingsSnapshot?: ReadonlySettingsSnapshot;
  toolRegistry?: ToolRegistry;
  environmentContextLoader?: (runtime: AgentRuntimeContext) => Promise<Part[]>;
  runtimeBundle?: AgentRuntimeLoaderResult;
}

type EnvironmentContextLoader = (
  runtime: AgentRuntimeContext,
) => Promise<Part[]>;

type ToolExecutionConfigShim = ToolExecutionConfig;

const defaultEnvironmentContextLoader: EnvironmentContextLoader =
  async () => [];

/**
 * Configures the generative model parameters for the subagent.
 * This interface specifies the model to be used and its associated generation settings,
 * such as temperature and top-p values, which influence the creativity and diversity of the model's output.
 */
export interface ModelConfig {
  /**
   * The name or identifier of the model to be used (e.g., 'gemini-2.5-pro').
   *
   * TODO: In the future, this needs to support 'auto' or some other string to support routing use cases.
   */
  model: string;
  /**
   * The temperature for the model's sampling process.
   */
  temp: number;
  /**
   * The top-p value for nucleus sampling.
   */
  top_p: number;
}

/**
 * Configures the execution environment and constraints for the subagent.
 * This interface defines parameters that control the subagent's runtime behavior,
 * such as maximum execution time, to prevent infinite loops or excessive resource consumption.
 *
 * TODO: Consider adding max_tokens as a form of budgeting.
 */
export interface RunConfig {
  /** The maximum execution time for the subagent in minutes. */
  max_time_minutes: number;
  /**
   * The maximum number of conversational turns (a user message + model response)
   * before the execution is terminated. Helps prevent infinite loops.
   */
  max_turns?: number;
}

/**
 * Manages the runtime context state for the subagent.
 * This class provides a mechanism to store and retrieve key-value pairs
 * that represent the dynamic state and variables accessible to the subagent
 * during its execution.
 */
export class ContextState {
  private state: Record<string, unknown> = {};

  /**
   * Retrieves a value from the context state.
   *
   * @param key - The key of the value to retrieve.
   * @returns The value associated with the key, or undefined if the key is not found.
   */
  get(key: string): unknown {
    return this.state[key];
  }

  /**
   * Sets a value in the context state.
   *
   * @param key - The key to set the value under.
   * @param value - The value to set.
   */
  set(key: string, value: unknown): void {
    this.state[key] = value;
  }

  /**
   * Retrieves all keys in the context state.
   *
   * @returns An array of all keys in the context state.
   */
  get_keys(): string[] {
    return Object.keys(this.state);
  }
}

const normalizeToolName = (name: string): string => name.trim().toLowerCase();

function convertMetadataToFunctionDeclaration(
  fallbackName: string,
  metadata: ToolMetadata,
): FunctionDeclaration {
  const rawSchema =
    metadata.parameterSchema && typeof metadata.parameterSchema === 'object'
      ? { ...(metadata.parameterSchema as Record<string, unknown>) }
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

async function validateToolsAgainstRuntime(params: {
  toolConfig: ToolConfig;
  toolRegistry: ToolRegistry;
  toolsView: ToolRegistryView;
}): Promise<void> {
  const { toolConfig, toolRegistry, toolsView } = params;
  const allowedNames = new Set(
    (typeof toolsView.listToolNames === 'function'
      ? toolsView.listToolNames()
      : []
    ).map(normalizeToolName),
  );

  for (const toolEntry of toolConfig.tools) {
    if (typeof toolEntry !== 'string') {
      continue;
    }

    if (
      allowedNames.size > 0 &&
      !allowedNames.has(normalizeToolName(toolEntry))
    ) {
      throw new Error(
        `Tool "${toolEntry}" is not permitted for this runtime bundle.`,
      );
    }

    const tool = toolRegistry.getTool(toolEntry);
    if (!tool) {
      continue;
    }
  }
}

function createToolExecutionConfig(
  runtimeBundle: AgentRuntimeLoaderResult,
  toolRegistry: ToolRegistry,
  settingsSnapshot?: ReadonlySettingsSnapshot,
  toolConfig?: ToolConfig,
): ToolExecutionConfig {
  const ephemerals = buildEphemeralSettings(settingsSnapshot);

  if (toolConfig && Array.isArray(toolConfig.tools)) {
    const normalizedWhitelist = toolConfig.tools
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => entry.toLowerCase());

    if (normalizedWhitelist.length > 0) {
      const existingAllowed = Array.isArray(ephemerals['tools.allowed'])
        ? (ephemerals['tools.allowed'] as string[])
            .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
            .filter((entry) => entry.length > 0)
            .map((entry) => entry.toLowerCase())
        : [];

      const allowedSet =
        existingAllowed.length > 0
          ? normalizedWhitelist.filter((entry) =>
              existingAllowed.includes(entry),
            )
          : normalizedWhitelist;

      ephemerals['tools.allowed'] = Array.from(new Set(allowedSet));
    }
  }

  return {
    getToolRegistry: () => toolRegistry,
    getEphemeralSettings: () => ({ ...ephemerals }),
    getEphemeralSetting: (key: string) => ephemerals[key],
    getExcludeTools: () => [],
    getSessionId: () => runtimeBundle.runtimeContext.state.sessionId,
    getTelemetryLogPromptsEnabled: () =>
      Boolean(settingsSnapshot?.telemetry?.enabled),
  };
}

function buildEphemeralSettings(
  snapshot?: ReadonlySettingsSnapshot,
): Record<string, unknown> {
  const ephemerals: Record<string, unknown> = {
    emojifilter: 'auto',
  };

  if (!snapshot) {
    return ephemerals;
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
 * Replaces `${...}` placeholders in a template string with values from a context.
 *
 * This function identifies all placeholders in the format `${key}`, validates that
 * each key exists in the provided `ContextState`, and then performs the substitution.
 *
 * @param template The template string containing placeholders.
 * @param context The `ContextState` object providing placeholder values.
 * @returns The populated string with all placeholders replaced.
 * @throws {Error} if any placeholder key is not found in the context.
 */
function templateString(template: string, context: ContextState): string {
  const placeholderRegex = /\$\{(\w+)\}/g;

  // First, find all unique keys required by the template.
  const requiredKeys = new Set(
    Array.from(template.matchAll(placeholderRegex), (match) => match[1]),
  );

  // Check if all required keys exist in the context.
  const contextKeys = new Set(context.get_keys());
  const missingKeys = Array.from(requiredKeys).filter(
    (key) => !contextKeys.has(key),
  );

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing context values for the following keys: ${missingKeys.join(
        ', ',
      )}`,
    );
  }

  // Perform the replacement using a replacer function.
  return template.replace(placeholderRegex, (_match, key) =>
    String(context.get(key)),
  );
}

/**
 * Represents the scope and execution environment for a subagent.
 * This class orchestrates the subagent's lifecycle, managing its chat interactions,
 * runtime context, and the collection of its outputs.
 *
 * @plan PLAN-20251028-STATELESS6.P08
 * @requirement REQ-STAT6-001.1, REQ-STAT6-001.2, REQ-STAT6-003.1, REQ-STAT6-003.2
 * @pseudocode agent-runtime-context.md line 93 (step 007.1)
 */
export class SubAgentScope {
  output: OutputObject = {
    terminate_reason: SubagentTerminateMode.ERROR,
    emitted_vars: {},
  };
  private readonly subagentId: string;
  private readonly logger = new DebugLogger('llxprt:subagent');
  private readonly textToolParser = new GemmaToolCallParser();
  private activeAbortController: AbortController | null = null;

  /** Optional callback for streaming text messages during execution */
  onMessage?: (message: string) => void;

  /**
   * Constructs a new SubAgentScope instance.
   *
   * @plan PLAN-20251028-STATELESS6.P08
   * @requirement REQ-STAT6-001.1
   * @pseudocode agent-runtime-context.md line 93 (step 007.1)
   *
   * @param name - The name for the subagent, used for logging and identification.
   * @param runtimeContext - Immutable runtime context (replaces Config parameter).
   * @param modelConfig - Configuration for the generative model parameters.
   * @param runConfig - Configuration for the subagent's execution environment.
   * @param promptConfig - Configuration for the subagent's prompt and behavior.
   * @param contentGenerator - Pre-initialized content generator for this subagent.
   * @param toolRegistry - Active tool registry for execution and validation.
   * @param toolExecutorContext - Stateless execution context used for tool invocations.
   * @param environmentContextLoader - Function that resolves environment context for prompts.
   * @param toolConfig - Optional configuration for tools available to the subagent.
   * @param outputConfig - Optional configuration for the subagent's expected outputs.
   */
  private constructor(
    readonly name: string,
    readonly runtimeContext: AgentRuntimeContext,
    private readonly modelConfig: ModelConfig,
    private readonly runConfig: RunConfig,
    private readonly promptConfig: PromptConfig,
    private readonly contentGenerator: import('./contentGenerator.js').ContentGenerator,
    private readonly toolExecutorContext: ToolExecutionConfigShim,
    private readonly environmentContextLoader: EnvironmentContextLoader,
    private readonly config: Config,
    private readonly toolConfig?: ToolConfig,
    private readonly outputConfig?: OutputConfig,
  ) {
    const randomPart = Math.random().toString(36).slice(2, 8);
    this.subagentId = `${this.name}-${randomPart}`;
  }

  /**
   * Returns the unique agent identifier assigned to this subagent scope.
   */
  getAgentId(): string {
    return this.subagentId;
  }

  /**
   * Creates and validates a new SubAgentScope instance.
   * This factory method ensures that all tools provided in the prompt configuration
   * are valid for non-interactive use before creating the subagent instance.
   *
   * @plan PLAN-20251028-STATELESS6.P08
   * @requirement REQ-STAT6-001.1, REQ-STAT6-003.1, REQ-STAT6-003.2
   * @pseudocode agent-runtime-context.md lines 94-98 (steps 007.2-007.6)
   *
   * @param {string} name - The name of the subagent.
   * @param {Config} foregroundConfig - Foreground configuration used for shared scheduler plumbing.
   * @param {PromptConfig} promptConfig - Configuration for the subagent's prompt and behavior.
   * @param {ModelConfig} modelConfig - Configuration for the generative model parameters.
   * @param {RunConfig} runConfig - Configuration for the subagent's execution environment.
   * @param {ToolConfig} [toolConfig] - Optional configuration for tools.
   * @param {OutputConfig} [outputConfig] - Optional configuration for expected outputs.
   * @param {SubAgentRuntimeOverrides} [overrides] - Optional stateless runtime inputs (provider runtime, adapters, settings) to bypass Config usage.
   * @returns {Promise<SubAgentScope>} A promise that resolves to a valid SubAgentScope instance.
   * @throws {Error} If any tool requires user confirmation.
   */
  static async create(
    name: string,
    foregroundConfig: Config,
    promptConfig: PromptConfig,
    modelConfig: ModelConfig,
    runConfig: RunConfig,
    toolConfig?: ToolConfig,
    outputConfig?: OutputConfig,
    overrides: SubAgentRuntimeOverrides = {},
  ): Promise<SubAgentScope> {
    const runtimeBundle = overrides.runtimeBundle;
    if (!runtimeBundle) {
      throw new Error(
        'SubAgentScope.create requires a runtime bundle after initialization.',
      );
    }

    const toolsView =
      runtimeBundle.runtimeContext.tools ?? runtimeBundle.toolsView;
    if (!toolsView) {
      throw new Error(
        'SubAgentScope.create requires a ToolRegistryView from the runtime bundle.',
      );
    }

    const toolRegistry = overrides.toolRegistry ?? runtimeBundle.toolRegistry;
    if (!toolRegistry) {
      throw new Error(
        'SubAgentScope.create requires a ToolRegistry in the runtime bundle or overrides.',
      );
    }

    if (toolConfig) {
      await validateToolsAgainstRuntime({
        toolConfig,
        toolRegistry,
        toolsView,
      });
    }

    const settingsSnapshot =
      overrides.settingsSnapshot ?? runtimeBundle.settingsSnapshot;

    const toolExecutorContext = createToolExecutionConfig(
      runtimeBundle,
      toolRegistry,
      settingsSnapshot,
      toolConfig,
    );

    const environmentContextLoader =
      overrides.environmentContextLoader ?? defaultEnvironmentContextLoader;

    return new SubAgentScope(
      name,
      runtimeBundle.runtimeContext,
      modelConfig,
      runConfig,
      promptConfig,
      runtimeBundle.contentGenerator,
      toolExecutorContext,
      environmentContextLoader,
      foregroundConfig,
      toolConfig,
      outputConfig,
    );
  }

  private buildInitialMessages(context: ContextState): Content[] {
    const behaviourPrompts =
      (context.get('task_behaviour_prompts') as string[] | undefined) ?? [];
    const initialInstruction =
      behaviourPrompts.length > 0
        ? behaviourPrompts.join('\n')
        : 'Follow the task directives provided in the system prompt.';

    return [
      {
        role: 'user',
        parts: [{ text: initialInstruction }],
      },
    ];
  }

  /**
   * Executes the subagent in interactive mode by routing tool calls through the
   * shared CoreToolScheduler. Tests may supply a custom schedulerFactory to
   * observe scheduling behaviour without touching the real scheduler.
   */
  async runInteractive(
    context: ContextState,
    options?: {
      schedulerFactory?: SubagentSchedulerFactory;
    },
  ): Promise<void> {
    const chat = await this.createChatObject(context);

    if (!chat) {
      this.output.terminate_reason = SubagentTerminateMode.ERROR;
      return;
    }

    const abortController = new AbortController();
    this.activeAbortController = abortController;

    const functionDeclarations = this.buildRuntimeFunctionDeclarations();
    if (this.outputConfig && this.outputConfig.outputs) {
      functionDeclarations.push(...this.getScopeLocalFuncDefs());
    }

    const schedulerConfig = this.createSchedulerConfig({ interactive: true });
    let pendingCompletedCalls: CompletedToolCall[] | null = null;
    let completionResolver: ((calls: CompletedToolCall[]) => void) | null =
      null;

    const awaitCompletedCalls = () => {
      if (pendingCompletedCalls) {
        const calls = pendingCompletedCalls;
        pendingCompletedCalls = null;
        return Promise.resolve(calls);
      }
      return new Promise<CompletedToolCall[]>((resolve) => {
        completionResolver = resolve;
      });
    };

    const outputUpdateHandler: OutputUpdateHandler = (_toolCallId, output) => {
      if (output && this.onMessage) {
        this.onMessage(output);
      }
    };

    const handleCompletion = async (calls: CompletedToolCall[]) => {
      if (completionResolver) {
        completionResolver(calls);
        completionResolver = null;
      } else {
        pendingCompletedCalls = calls;
      }
    };

    const scheduler = options?.schedulerFactory
      ? options.schedulerFactory({
          schedulerConfig,
          onAllToolCallsComplete: handleCompletion,
          outputUpdateHandler,
          onToolCallsUpdate: undefined,
        })
      : new CoreToolScheduler({
          config: schedulerConfig,
          outputUpdateHandler,
          onAllToolCallsComplete: handleCompletion,
          onToolCallsUpdate: undefined,
          getPreferredEditor: () => undefined,
          onEditorClose: () => {},
        });

    const startTime = Date.now();
    let turnCounter = 0;
    let currentMessages = this.buildInitialMessages(context);

    try {
      while (true) {
        if (
          this.runConfig.max_turns &&
          turnCounter >= this.runConfig.max_turns
        ) {
          this.output.terminate_reason = SubagentTerminateMode.MAX_TURNS;
          this.logger.warn(
            () =>
              `Subagent ${this.subagentId} reached max turns (${this.runConfig.max_turns})`,
          );
          break;
        }

        let durationMin = (Date.now() - startTime) / (1000 * 60);
        if (durationMin >= this.runConfig.max_time_minutes) {
          this.output.terminate_reason = SubagentTerminateMode.TIMEOUT;
          this.logger.warn(
            () =>
              `Subagent ${this.subagentId} reached time limit (${this.runConfig.max_time_minutes} minutes)`,
          );
          break;
        }

        const currentTurn = turnCounter++;
        const promptId = `${this.runtimeContext.state.sessionId}#${this.subagentId}#${currentTurn}`;
        const providerName = this.runtimeContext.state.provider ?? 'backend';
        const turn = new Turn(chat, promptId, this.subagentId, providerName);

        let textResponse = '';
        const parts = currentMessages[0]?.parts ?? [];

        const stream = turn.run(parts, abortController.signal);
        for await (const event of stream) {
          if (abortController.signal.aborted) {
            return;
          }
          if (event.type === GeminiEventType.Content && event.value) {
            textResponse += event.value;
            if (this.onMessage) {
              this.onMessage(event.value);
            }
          } else if (
            event.type === GeminiEventType.Error &&
            event.value?.error
          ) {
            this.output.terminate_reason = SubagentTerminateMode.ERROR;
            throw new Error(event.value.error.message);
          }
        }

        if (textResponse.trim()) {
          this.output.final_message = textResponse.trim();
        }

        const toolRequests = [...turn.pendingToolCalls];
        if (toolRequests.length > 0) {
          const manualParts: Part[] = [];
          const schedulerRequests: ToolCallRequestInfo[] = [];

          for (const request of toolRequests) {
            if (request.name === 'self_emitvalue') {
              manualParts.push(...this.handleEmitValueCall(request));
            } else {
              schedulerRequests.push(request);
            }
          }

          let responseParts: Part[] = [...manualParts];

          if (schedulerRequests.length > 0) {
            const completionPromise = awaitCompletedCalls();
            await scheduler.schedule(schedulerRequests, abortController.signal);
            const completedCalls = await completionPromise;
            responseParts = responseParts.concat(
              this.buildPartsFromCompletedCalls(completedCalls),
            );
            const fatalCall = completedCalls.find(
              (call) =>
                call.status === 'error' &&
                this.isFatalToolError(call.response.errorType),
            );
            if (fatalCall) {
              const fatalMessage = this.buildToolUnavailableMessage(
                fatalCall.request.name,
                fatalCall.response.resultDisplay,
                fatalCall.response.error,
              );
              this.logger.warn(
                () =>
                  `Subagent ${this.subagentId} cannot use tool '${fatalCall.request.name}': ${fatalMessage}`,
              );
              responseParts.push({ text: fatalMessage });
              this.output.final_message = fatalMessage;
            }
          }

          if (responseParts.length === 0) {
            responseParts.push({
              text: 'All tool calls failed. Please analyze the errors and try an alternative approach.',
            });
          }

          currentMessages = [{ role: 'user', parts: responseParts }];
          continue;
        }

        durationMin = (Date.now() - startTime) / (1000 * 60);
        if (durationMin >= this.runConfig.max_time_minutes) {
          this.output.terminate_reason = SubagentTerminateMode.TIMEOUT;
          this.logger.warn(
            () =>
              `Subagent ${this.subagentId} reached time limit after turn ${currentTurn}`,
          );
          break;
        }

        const todoReminder = await this.buildTodoCompletionPrompt();
        if (todoReminder) {
          this.logger.debug(
            () =>
              `Subagent ${this.subagentId} postponing completion until outstanding todos are addressed`,
          );
          currentMessages = [
            {
              role: 'user',
              parts: [{ text: todoReminder }],
            },
          ];
          continue;
        }

        if (
          !this.outputConfig ||
          Object.keys(this.outputConfig.outputs).length === 0
        ) {
          this.output.terminate_reason = SubagentTerminateMode.GOAL;
          break;
        }

        const remainingVars = Object.keys(this.outputConfig.outputs).filter(
          (key) => !(key in this.output.emitted_vars),
        );

        if (remainingVars.length === 0) {
          this.output.terminate_reason = SubagentTerminateMode.GOAL;
          this.logger.debug(
            () =>
              `Subagent ${this.subagentId} satisfied output requirements on turn ${currentTurn}`,
          );
          break;
        }

        const nudgeMessage = `You have stopped calling tools but have not emitted the following required variables: ${remainingVars.join(
          ', ',
        )}. Please use the 'self_emitvalue' tool to emit them now, or continue working if necessary.`;

        this.logger.debug(
          () =>
            `Subagent ${this.subagentId} nudging for outputs: ${remainingVars.join(', ')}`,
        );

        currentMessages = [
          {
            role: 'user',
            parts: [{ text: nudgeMessage }],
          },
        ];
      }
      this.finalizeOutput();
    } catch (error) {
      this.logger.warn(
        () =>
          `Error during subagent execution for ${this.subagentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.output.terminate_reason = SubagentTerminateMode.ERROR;
      if (!this.output.final_message) {
        this.output.final_message =
          error instanceof Error ? error.message : String(error);
      }
      this.finalizeOutput();
      throw error;
    } finally {
      this.activeAbortController = null;
    }
  }

  /**
   * Runs the subagent in a non-interactive mode.
   * This method orchestrates the subagent's execution loop, including prompt templating,
   * tool execution, and termination conditions.
   *
   * @plan PLAN-20251028-STATELESS6.P08
   * @requirement REQ-STAT6-001.1
   *
   * @param {ContextState} context - The current context state containing variables for prompt templating.
   * @returns {Promise<void>} A promise that resolves when the subagent has completed its execution.
   */
  async runNonInteractive(context: ContextState): Promise<void> {
    const chat = await this.createChatObject(context);

    if (!chat) {
      this.output.terminate_reason = SubagentTerminateMode.ERROR;
      return;
    }

    const abortController = new AbortController();
    this.activeAbortController = abortController;

    const toolsList: FunctionDeclaration[] =
      this.buildRuntimeFunctionDeclarations();
    if (this.outputConfig && this.outputConfig.outputs) {
      toolsList.push(...this.getScopeLocalFuncDefs());
    }

    this.logger.debug(
      () =>
        `Subagent ${this.subagentId} (${this.name}) starting run with toolCount=${toolsList.length} requestedOutputs=${
          this.outputConfig
            ? Object.keys(this.outputConfig.outputs).join(', ')
            : 'none'
        } runConfig=${JSON.stringify(this.runConfig)}`,
    );

    let currentMessages: Content[] = this.buildInitialMessages(context);

    const startTime = Date.now();
    let turnCounter = 0;
    try {
      while (true) {
        // Check termination conditions.
        if (
          this.runConfig.max_turns &&
          turnCounter >= this.runConfig.max_turns
        ) {
          this.output.terminate_reason = SubagentTerminateMode.MAX_TURNS;
          this.logger.warn(
            () =>
              `Subagent ${this.subagentId} reached max turns (${this.runConfig.max_turns})`,
          );
          break;
        }
        let durationMin = (Date.now() - startTime) / (1000 * 60);
        if (durationMin >= this.runConfig.max_time_minutes) {
          this.output.terminate_reason = SubagentTerminateMode.TIMEOUT;
          this.logger.warn(
            () =>
              `Subagent ${this.subagentId} reached time limit (${this.runConfig.max_time_minutes} minutes)`,
          );
          break;
        }

        // @plan PLAN-20251028-STATELESS6.P08
        // @requirement REQ-STAT6-001.1
        const currentTurn = turnCounter++;
        const promptId = `${this.runtimeContext.state.sessionId}#${this.subagentId}#${currentTurn}`;
        this.logger.debug(
          () =>
            `Subagent ${this.subagentId} turn=${currentTurn} promptId=${promptId}`,
        );
        const messageParams = {
          message: currentMessages[0]?.parts || [],
          config: {
            abortSignal: abortController.signal,
            tools: [{ functionDeclarations: toolsList }],
          },
        };

        const responseStream = await chat.sendMessageStream(
          messageParams,
          promptId,
        );

        durationMin = (Date.now() - startTime) / (1000 * 60);
        if (durationMin >= this.runConfig.max_time_minutes) {
          this.output.terminate_reason = SubagentTerminateMode.TIMEOUT;
          this.logger.warn(
            () =>
              `Subagent ${this.subagentId} reached time limit (${this.runConfig.max_time_minutes} minutes) while waiting for model response`,
          );
          break;
        }

        let functionCalls: FunctionCall[] = [];
        let textResponse = '';
        for await (const resp of responseStream) {
          if (abortController.signal.aborted) return;
          if (resp.type === StreamEventType.CHUNK && resp.value.functionCalls) {
            const chunkCalls = resp.value.functionCalls ?? [];
            if (chunkCalls.length > 0) {
              functionCalls.push(...chunkCalls);
              this.logger.debug(
                () =>
                  `Subagent ${this.subagentId} received ${chunkCalls.length} function calls on turn ${currentTurn}`,
              );
            }
          }
          if (resp.type === StreamEventType.CHUNK && resp.value.text) {
            textResponse += resp.value.text;
          }
        }

        if (textResponse) {
          if (this.onMessage) {
            this.onMessage(textResponse);
          }

          let cleanedText = textResponse;
          try {
            const parsedResult = this.textToolParser.parse(textResponse);
            cleanedText = parsedResult.cleanedContent;
            if (parsedResult.toolCalls.length > 0) {
              const synthesizedCalls: FunctionCall[] = [];
              parsedResult.toolCalls.forEach((call, index) => {
                const normalizedName = this.normalizeToolName(call.name);
                if (!normalizedName) {
                  this.logger.debug(
                    () =>
                      `Subagent ${this.subagentId} could not map textual tool name '${call.name}' to a registered tool`,
                  );
                  return;
                }
                synthesizedCalls.push({
                  id: `parsed_${this.subagentId}_${Date.now()}_${index}`,
                  name: normalizedName,
                  args: call.arguments ?? {},
                });
              });

              if (synthesizedCalls.length > 0) {
                functionCalls = [...functionCalls, ...synthesizedCalls];
                this.logger.debug(
                  () =>
                    `Subagent ${this.subagentId} extracted ${synthesizedCalls.length} tool call(s) from text: ${synthesizedCalls
                      .map((call) => call.name)
                      .join(', ')}`,
                );
              }
            }
          } catch (error) {
            this.logger.warn(
              () =>
                `Subagent ${this.subagentId} failed to parse textual tool calls: ${error instanceof Error ? error.message : String(error)}`,
            );
          }

          textResponse = cleanedText;
          const trimmedText = textResponse.trim();
          if (trimmedText.length > 0) {
            this.output.final_message = trimmedText;
          }
          const preview =
            textResponse.length > 200
              ? `${textResponse.slice(0, 200)}…`
              : textResponse;
          this.logger.debug(
            () =>
              `Subagent ${this.subagentId} model response (truncated): ${preview}`,
          );
        }

        durationMin = (Date.now() - startTime) / (1000 * 60);
        if (durationMin >= this.runConfig.max_time_minutes) {
          this.output.terminate_reason = SubagentTerminateMode.TIMEOUT;
          this.logger.warn(
            () =>
              `Subagent ${this.subagentId} reached time limit after turn ${currentTurn}`,
          );
          break;
        }

        if (functionCalls.length > 0) {
          currentMessages = await this.processFunctionCalls(
            functionCalls,
            abortController,
            promptId,
          );
        } else {
          // Model stopped calling tools. Check if goal is met.
          const todoReminder = await this.buildTodoCompletionPrompt();
          if (todoReminder) {
            this.logger.debug(
              () =>
                `Subagent ${this.subagentId} postponing completion until outstanding todos are addressed`,
            );
            currentMessages = [
              {
                role: 'user',
                parts: [{ text: todoReminder }],
              },
            ];
            continue;
          }

          if (
            !this.outputConfig ||
            Object.keys(this.outputConfig.outputs).length === 0
          ) {
            this.output.terminate_reason = SubagentTerminateMode.GOAL;
            break;
          }

          const remainingVars = Object.keys(this.outputConfig.outputs).filter(
            (key) => !(key in this.output.emitted_vars),
          );

          if (remainingVars.length === 0) {
            this.output.terminate_reason = SubagentTerminateMode.GOAL;
            this.logger.debug(
              () =>
                `Subagent ${this.subagentId} satisfied output requirements on turn ${currentTurn}`,
            );
            break;
          }

          const nudgeMessage = `You have stopped calling tools but have not emitted the following required variables: ${remainingVars.join(
            ', ',
          )}. Please use the 'self_emitvalue' tool to emit them now, or continue working if necessary.`;

          this.logger.debug(
            () =>
              `Subagent ${this.subagentId} nudging for outputs: ${remainingVars.join(', ')}`,
          );

          currentMessages = [
            {
              role: 'user',
              parts: [{ text: nudgeMessage }],
            },
          ];
        }
      }
      this.finalizeOutput();
    } catch (error) {
      this.logger.warn(
        () =>
          `Error during subagent execution for ${this.subagentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.output.terminate_reason = SubagentTerminateMode.ERROR;
      if (!this.output.final_message) {
        this.output.final_message =
          error instanceof Error ? error.message : String(error);
      }
      this.finalizeOutput();
      throw error;
    } finally {
      this.activeAbortController = null;
    }
  }

  cancel(reason?: string): void {
    if (this.activeAbortController?.signal.aborted) {
      return;
    }
    if (!this.activeAbortController) {
      return;
    }
    this.logger.warn(() => {
      const suffix = reason ? `: ${reason}` : '';
      return `Subagent ${this.subagentId} cancellation requested${suffix}`;
    });
    this.activeAbortController.abort();
  }

  /**
   * Processes a list of function calls, executing each one and collecting their responses.
   * This method iterates through the provided function calls, executes them using the
   * `executeToolCall` function (or handles `self_emitvalue` internally), and aggregates
   * their results. It also manages error reporting for failed tool executions.
   * @param {FunctionCall[]} functionCalls - An array of `FunctionCall` objects to process.
   * @param {ToolRegistry} toolRegistry - The tool registry to look up and execute tools.
   * @param {AbortController} abortController - An `AbortController` to signal cancellation of tool executions.
   * @returns {Promise<Content[]>} A promise that resolves to an array of `Content` parts representing the tool responses,
   *          which are then used to update the chat history.
   */
  private async processFunctionCalls(
    functionCalls: FunctionCall[],
    abortController: AbortController,
    promptId: string,
  ): Promise<Content[]> {
    const toolResponseParts: Part[] = [];

    for (const functionCall of functionCalls) {
      const callId = functionCall.id ?? `${functionCall.name}-${Date.now()}`;
      const requestInfo: ToolCallRequestInfo = {
        callId,
        name: functionCall.name as string,
        args: (functionCall.args ?? {}) as Record<string, unknown>,
        isClientInitiated: true,
        prompt_id: promptId,
        agentId: this.subagentId,
      };

      this.logger.debug(
        () =>
          `Subagent ${this.subagentId} executing tool '${requestInfo.name}' with args=${JSON.stringify(requestInfo.args)}`,
      );

      let toolResponse;

      // Handle scope-local tools first.
      if (functionCall.name === 'self_emitvalue') {
        const valName = String(requestInfo.args['emit_variable_name']);
        const valVal = String(requestInfo.args['emit_variable_value']);
        this.output.emitted_vars[valName] = valVal;

        toolResponse = {
          callId,
          responseParts: [{ text: `Emitted variable ${valName} successfully` }],
          resultDisplay: `Emitted variable ${valName} successfully`,
          error: undefined,
          errorType: undefined,
          agentId: requestInfo.agentId,
        };
      } else {
        // @plan PLAN-20251028-STATELESS6.P08
        // @requirement REQ-STAT6-001.1
        toolResponse = await executeToolCall(
          this.toolExecutorContext,
          requestInfo,
          abortController.signal,
        );
      }

      if (toolResponse.error) {
        console.error(
          `Error executing tool ${functionCall.name}: ${toolResponse.resultDisplay || toolResponse.error.message}`,
        );
      }
      if (toolResponse.error) {
        this.logger.warn(
          () =>
            `Subagent ${this.subagentId} tool '${functionCall.name}' failed: ${toolResponse.error?.message}`,
        );
      } else {
        this.logger.debug(
          () =>
            `Subagent ${this.subagentId} tool '${functionCall.name}' completed successfully`,
        );
      }

      if (this.isFatalToolError(toolResponse.errorType)) {
        const fatalMessage = this.buildToolUnavailableMessage(
          functionCall.name as string,
          toolResponse.resultDisplay,
          toolResponse.error,
        );
        this.logger.warn(
          () =>
            `Subagent ${this.subagentId} cannot use tool '${functionCall.name}': ${fatalMessage}`,
        );
        toolResponseParts.push({ text: fatalMessage });
        this.output.final_message = fatalMessage;
        continue;
      }

      if (toolResponse.responseParts) {
        toolResponseParts.push(...toolResponse.responseParts);
      }
    }
    // If all tool calls failed, inform the model so it can re-evaluate.
    if (functionCalls.length > 0 && toolResponseParts.length === 0) {
      toolResponseParts.push({
        text: 'All tool calls failed. Please analyze the errors and try an alternative approach.',
      });
    }

    return [{ role: 'user', parts: toolResponseParts }];
  }

  private createSchedulerConfig(options?: { interactive?: boolean }): Config {
    const isInteractive = options?.interactive ?? false;

    const whitelist =
      !isInteractive && this.toolConfig
        ? this.toolConfig.tools.filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : [];

    const getEphemeralSettings =
      typeof this.toolExecutorContext.getEphemeralSettings === 'function'
        ? () => ({
            ...this.toolExecutorContext.getEphemeralSettings!(),
          })
        : () => this.config.getEphemeralSettings();

    const getExcludeTools =
      typeof this.toolExecutorContext.getExcludeTools === 'function'
        ? () => this.toolExecutorContext.getExcludeTools()
        : () => this.config.getExcludeTools?.() ?? [];

    const getTelemetryLogPromptsEnabled =
      typeof this.toolExecutorContext.getTelemetryLogPromptsEnabled ===
      'function'
        ? () => this.toolExecutorContext.getTelemetryLogPromptsEnabled()
        : () => this.config.getTelemetryLogPromptsEnabled();

    const allowedTools = isInteractive
      ? typeof this.config.getAllowedTools === 'function'
        ? this.config.getAllowedTools()
        : undefined
      : whitelist.length > 0
        ? whitelist
        : typeof this.config.getAllowedTools === 'function'
          ? this.config.getAllowedTools()
          : undefined;

    return {
      getToolRegistry: () => this.toolExecutorContext.getToolRegistry(),
      getSessionId: () => this.toolExecutorContext.getSessionId(),
      getEphemeralSettings,
      getExcludeTools,
      getTelemetryLogPromptsEnabled,
      getAllowedTools: () => allowedTools,
      getApprovalMode: () =>
        typeof this.config.getApprovalMode === 'function'
          ? this.config.getApprovalMode()
          : ApprovalMode.DEFAULT,
    } as unknown as Config;
  }

  private finalizeOutput(): void {
    const message = this.output.final_message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return;
    }

    const emittedVars = this.output.emitted_vars ?? {};
    const emittedEntries = Object.entries(emittedVars)
      .filter(
        ([, value]) =>
          value !== undefined &&
          value !== null &&
          String(value).trim().length > 0,
      )
      .map(([key, value]) => `${key}=${String(value)}`);

    let baseMessage: string;
    switch (this.output.terminate_reason) {
      case SubagentTerminateMode.GOAL:
        baseMessage = 'Completed the requested task.';
        break;
      case SubagentTerminateMode.TIMEOUT:
        baseMessage = 'Stopped because the time limit was reached.';
        break;
      case SubagentTerminateMode.MAX_TURNS:
        baseMessage =
          'Stopped because the maximum number of turns was reached.';
        break;
      case SubagentTerminateMode.ERROR:
      default:
        baseMessage = 'Stopped due to an unrecoverable error.';
        break;
    }

    const varsSuffix =
      emittedEntries.length > 0
        ? ` Emitted variables: ${emittedEntries.join(', ')}.`
        : '';

    this.output.final_message = `${baseMessage}${varsSuffix}`.trim();
  }

  private isFatalToolError(errorType: ToolErrorType | undefined): boolean {
    return (
      errorType === ToolErrorType.TOOL_DISABLED ||
      errorType === ToolErrorType.TOOL_NOT_REGISTERED
    );
  }

  private buildToolUnavailableMessage(
    toolName: string,
    resultDisplay?: ToolResultDisplay,
    error?: Error,
  ): string {
    const detail = this.extractToolDetail(resultDisplay, error);
    const baseMessage = `Tool "${toolName}" is not available in this environment.`;
    return detail
      ? `${baseMessage} ${detail}`
      : `${baseMessage} Please continue without using it.`;
  }

  private extractToolDetail(
    resultDisplay?: ToolResultDisplay,
    error?: Error,
  ): string | undefined {
    if (error?.message) {
      return error.message;
    }
    if (typeof resultDisplay === 'string') {
      return resultDisplay;
    }
    if (
      resultDisplay &&
      typeof resultDisplay === 'object' &&
      'message' in resultDisplay &&
      typeof (resultDisplay as { message?: unknown }).message === 'string'
    ) {
      return (resultDisplay as { message: string }).message;
    }
    return undefined;
  }

  private handleEmitValueCall(request: ToolCallRequestInfo): Part[] {
    const args = request.args ?? {};
    const variableName =
      typeof args.emit_variable_name === 'string'
        ? args.emit_variable_name
        : typeof args.emitVariableName === 'string'
          ? args.emitVariableName
          : '';
    const variableValue =
      typeof args.emit_variable_value === 'string'
        ? args.emit_variable_value
        : typeof args.emitVariableValue === 'string'
          ? args.emitVariableValue
          : '';

    if (variableName && variableValue) {
      this.output.emitted_vars[variableName] = variableValue;
      const message = `Emitted variable ${variableName} successfully`;
      if (this.onMessage) {
        this.onMessage(`[${this.subagentId}] ${message}`);
      }
      return [
        {
          functionCall: {
            id: request.callId,
            name: request.name,
            args: request.args,
          },
        },
        {
          functionResponse: {
            id: request.callId,
            name: request.name,
            response: {
              emit_variable_name: variableName,
              emit_variable_value: variableValue,
              message,
            },
          },
        },
      ];
    }

    const errorMessage =
      'self_emitvalue requires emit_variable_name and emit_variable_value arguments.';
    this.logger.warn(
      () => `Subagent ${this.subagentId} failed to emit value: ${errorMessage}`,
    );
    return [
      {
        functionCall: {
          id: request.callId,
          name: request.name,
          args: request.args,
        },
      },
      {
        functionResponse: {
          id: request.callId,
          name: request.name,
          response: { error: errorMessage },
        },
      },
    ];
  }

  private buildPartsFromCompletedCalls(
    completedCalls: CompletedToolCall[],
  ): Part[] {
    const aggregate: Part[] = [];
    for (const call of completedCalls) {
      if (call.response?.responseParts?.length) {
        aggregate.push(...call.response.responseParts);
      } else {
        aggregate.push({
          text: `Tool ${call.request.name} completed without response.`,
        });
      }

      if (call.status === 'error') {
        const errorMessage =
          call.response?.error?.message ??
          call.response?.resultDisplay ??
          'Tool execution failed.';
        this.logger.warn(
          () =>
            `Subagent ${this.subagentId} tool '${call.request.name}' failed: ${errorMessage}`,
        );
      } else if (call.status === 'cancelled') {
        this.logger.warn(
          () =>
            `Subagent ${this.subagentId} tool '${call.request.name}' was cancelled.`,
        );
      }

      const display = call.response?.resultDisplay;
      if (typeof display === 'string' && this.onMessage && display.trim()) {
        this.onMessage(display);
      }
    }
    return aggregate;
  }

  private async buildTodoCompletionPrompt(): Promise<string | null> {
    const sessionId = this.runtimeContext.state.sessionId;
    if (!sessionId) {
      return null;
    }

    try {
      let todos = await new TodoStore(sessionId, this.subagentId).readTodos();
      if (todos.length === 0) {
        todos = await new TodoStore(sessionId).readTodos();
      }

      if (todos.length === 0) {
        return null;
      }

      const outstanding = todos.filter((todo) => todo.status !== 'completed');

      if (outstanding.length === 0) {
        return null;
      }

      const previewCount = Math.min(3, outstanding.length);
      const previewLines = outstanding
        .slice(0, previewCount)
        .map((todo) => `- ${todo.content}`);
      if (outstanding.length > previewCount) {
        previewLines.push(
          `- ... and ${outstanding.length - previewCount} more`,
        );
      }

      return [
        'You still have todos in your todo list. Complete them before finishing.',
        previewLines.length > 0
          ? `Outstanding items:\n${previewLines.join('\n')}`
          : undefined,
      ]
        .filter(Boolean)
        .join('\n\n');
    } catch (error) {
      this.logger.warn(
        () =>
          `Subagent ${this.subagentId} could not inspect todos: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Creates a GeminiChat instance for this subagent.
   *
   * @plan PLAN-20251028-STATELESS6.P08
   * @requirement REQ-STAT6-001.1, REQ-STAT6-003.1
   * @pseudocode agent-runtime-context.md line 99 (step 007.7)
   *
   * Step 007.7: Update GeminiChat instantiation to use AgentRuntimeContext
   * Step 007.8: REMOVE Config mutation (no setModel call)
   */
  private async createChatObject(context: ContextState) {
    if (!this.promptConfig.systemPrompt && !this.promptConfig.initialMessages) {
      throw new Error(
        'PromptConfig must have either `systemPrompt` or `initialMessages` defined.',
      );
    }
    if (this.promptConfig.systemPrompt && this.promptConfig.initialMessages) {
      throw new Error(
        'PromptConfig cannot have both `systemPrompt` and `initialMessages` defined.',
      );
    }

    const start_history = [...(this.promptConfig.initialMessages ?? [])];

    // Build system instruction with environment context
    const personaPrompt = this.promptConfig.systemPrompt
      ? this.buildChatSystemPrompt(context)
      : '';

    const runtimeFunctionDeclarations = this.buildRuntimeFunctionDeclarations();
    const scopeLocalDeclarations =
      this.outputConfig && this.outputConfig.outputs
        ? this.getScopeLocalFuncDefs()
        : [];
    const combinedDeclarations = [
      ...runtimeFunctionDeclarations,
      ...scopeLocalDeclarations,
    ];

    const envParts = await this.environmentContextLoader(this.runtimeContext);

    // Extract environment context text
    const envContextText = envParts
      .map((part) => ('text' in part ? part.text : ''))
      .join('\n')
      .trim();

    const toolNames = Array.from(
      new Set(
        combinedDeclarations
          .map((declaration) => declaration?.name?.trim())
          .filter((name): name is string => Boolean(name && name.length > 0)),
      ),
    );

    const coreSystemPrompt = await getCoreSystemPromptAsync(
      undefined,
      this.modelConfig.model,
      toolNames,
    );

    const instructionSections = [
      envContextText,
      coreSystemPrompt?.trim() ?? '',
      personaPrompt?.trim() ?? '',
    ].filter((section) => section.length > 0);

    const systemInstruction =
      instructionSections.length > 0 ? instructionSections.join('\n\n') : '';

    this.logger.debug(() => {
      const preview =
        systemInstruction && systemInstruction.length > 0
          ? systemInstruction.slice(0, 1200)
          : '<empty>';
      return `System instruction preview: ${preview}`;
    });

    try {
      // Step 007.7: Build generation config from runtime view ephemerals
      // @plan PLAN-20251028-STATELESS6.P08
      // @requirement REQ-STAT6-002.2
      const generationConfig: GenerateContentConfig & {
        systemInstruction?: string | Content;
      } = {
        temperature: this.modelConfig.temp,
        topP: this.modelConfig.top_p,
        systemInstruction: systemInstruction || undefined,
        tools:
          combinedDeclarations.length > 0
            ? [{ functionDeclarations: combinedDeclarations }]
            : undefined,
      };

      // Step 007.7: Instantiate GeminiChat with runtime view
      // @plan PLAN-20251028-STATELESS6.P10
      // @requirement REQ-STAT6-001.2, REQ-STAT6-003.1, REQ-STAT6-003.2
      // @pseudocode agent-runtime-context.md line 99 (step 007.7)
      // NOTE: NO Config.setModel() call - REQ-STAT6-003.1 (step 007.8)
      // NOTE: GeminiChat operates solely on runtime context
      return new GeminiChat(
        this.runtimeContext, // AgentRuntimeContext (replaces runtimeState+config+history)
        this.contentGenerator,
        generationConfig,
        start_history,
      );
    } catch (error) {
      await reportError(
        error,
        'Error initializing Gemini chat session.',
        start_history,
        'startChat',
      );
      // The calling function will handle the undefined return.
      return undefined;
    }
  }

  private buildRuntimeFunctionDeclarations(): FunctionDeclaration[] {
    if (!this.toolConfig || this.toolConfig.tools.length === 0) {
      return [];
    }

    const toolsView = this.runtimeContext.tools;
    const listedNames =
      typeof toolsView.listToolNames === 'function'
        ? toolsView.listToolNames()
        : [];
    const allowedNames = new Set(listedNames.map(normalizeToolName));

    const declarations: FunctionDeclaration[] = [];
    for (const entry of this.toolConfig.tools) {
      if (typeof entry !== 'string') {
        declarations.push(entry);
        continue;
      }

      if (
        allowedNames.size > 0 &&
        !allowedNames.has(normalizeToolName(entry))
      ) {
        console.warn(
          `Tool "${entry}" is not permitted by the runtime view and will be skipped.`,
        );
        continue;
      }

      const metadata = toolsView.getToolMetadata(entry);
      if (!metadata) {
        console.warn(
          `Tool "${entry}" is not available in the runtime view and will be skipped.`,
        );
        continue;
      }

      declarations.push(convertMetadataToFunctionDeclaration(entry, metadata));
    }
    return declarations;
  }

  /**
   * Returns an array of FunctionDeclaration objects for tools that are local to the subagent's scope.
   * Currently, this includes the `self_emitvalue` tool for emitting variables.
   * @returns An array of `FunctionDeclaration` objects.
   */
  private getScopeLocalFuncDefs() {
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
            description:
              'This is the _value_ to be returned for this variable.',
            type: Type.STRING,
          },
        },
        required: ['emit_variable_name', 'emit_variable_value'],
      },
    };

    return [emitValueTool];
  }

  private normalizeToolName(rawName: string | undefined): string | null {
    if (!rawName) {
      return null;
    }

    const candidates = new Set<string>();
    const trimmed = rawName.trim();
    if (trimmed) {
      candidates.add(trimmed);
      candidates.add(trimmed.toLowerCase());
    }

    if (trimmed.endsWith('Tool')) {
      const withoutSuffix = trimmed.slice(0, -4);
      if (withoutSuffix) {
        candidates.add(withoutSuffix);
        candidates.add(withoutSuffix.toLowerCase());
        candidates.add(this.toSnakeCase(withoutSuffix));
      }
    }

    candidates.add(this.toSnakeCase(trimmed));

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      if (this.runtimeContext.tools.getToolMetadata(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private toSnakeCase(value: string): string {
    return value
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[\s-]+/g, '_')
      .toLowerCase();
  }

  /**
   * Builds the system prompt for the chat based on the provided configurations.
   * It templates the base system prompt and appends instructions for emitting
   * variables if an `OutputConfig` is provided.
   * @param {ContextState} context - The context for templating.
   * @returns {string} The complete system prompt.
   */
  private buildChatSystemPrompt(context: ContextState): string {
    if (!this.promptConfig.systemPrompt) {
      // This should ideally be caught in createChatObject, but serves as a safeguard.
      return '';
    }

    let finalPrompt = templateString(this.promptConfig.systemPrompt, context);

    // Add instructions for emitting variables if needed.
    if (this.outputConfig && this.outputConfig.outputs) {
      let outputInstructions =
        '\n\nAfter you have achieved all other goals, you MUST emit the required output variables. For each expected output, make one final call to the `self_emitvalue` tool.';

      for (const [key, value] of Object.entries(this.outputConfig.outputs)) {
        outputInstructions += `\n* Use 'self_emitvalue' to emit the '${key}' key, with a value described as: '${value}'`;
      }
      finalPrompt += outputInstructions;
    }

    // Add general non-interactive instructions.
    finalPrompt += `

Important Rules:
 * You are running in a non-interactive mode. You CANNOT ask the user for input or clarification. You must proceed with the information you have.
 * Once you believe all goals have been met and all required outputs have been emitted, stop calling tools.`;

    return finalPrompt;
  }
}
