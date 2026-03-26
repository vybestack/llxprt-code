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
import { DebugLogger } from '../debug/DebugLogger.js';
import {
  Config,
  type SchedulerCallbacks,
  type SchedulerOptions,
} from '../config/config.js';
import {
  type ToolCallRequestInfo,
  GeminiEventType,
  Turn,
} from './turn.js';
import {
  type ToolExecutionConfig,
} from './nonInteractiveToolExecutor.js';
import {
  type Content,
  type Part,
  type FunctionCall,
  type FunctionDeclaration,
} from '@google/genai';
import { StreamEventType } from './geminiChat.js';
import type {
  AgentRuntimeContext,
  ReadonlySettingsSnapshot,
} from '../runtime/AgentRuntimeContext.js';
import { GemmaToolCallParser } from '../parsers/TextToolCallParser.js';
import type { SubagentSchedulerFactory } from './subagentScheduler.js';
import {
  type CompletedToolCall,
  type OutputUpdateHandler,
} from './coreToolScheduler.js';
import { type EmojiFilter } from '../filters/EmojiFilter.js';
import {
  validateToolsAgainstRuntime,
  createToolExecutionConfig,
  createEmojiFilter,
  buildRuntimeFunctionDeclarations,
  getScopeLocalFuncDefs,
  createSchedulerConfig,
  createChatObject,
} from './subagentRuntimeSetup.js';
import {
  isFatalToolError,
  buildToolUnavailableMessage,
  resolveToolName,
  finalizeOutput,
  handleEmitValueCall,
  buildPartsFromCompletedCalls,
  processFunctionCalls,
  buildTodoCompletionPrompt,
} from './subagentToolProcessing.js';

// --- Re-exports from subagentTypes.ts for backward compatibility (Issue #1581) ---
// Value re-exports (backward-compatible — existed before decomposition)
export {
  SubagentTerminateMode,
  ContextState,
  templateString,
} from './subagentTypes.js';
// Type-only re-exports (backward-compatible)
export type {
  OutputObject,
  PromptConfig,
  ToolConfig,
  OutputConfig,
  SubAgentRuntimeOverrides,
  ModelConfig,
  RunConfig,
} from './subagentTypes.js';
// Additive exports (not previously public — no existing consumers)
export { defaultEnvironmentContextLoader } from './subagentTypes.js';
export type { EnvironmentContextLoader } from './subagentTypes.js';

// --- Internal imports from subagentTypes.ts (used within this file) ---
import {
  SubagentTerminateMode,
  ContextState,
  defaultEnvironmentContextLoader,
  type OutputObject,
  type PromptConfig,
  type ToolConfig,
  type OutputConfig,
  type SubAgentRuntimeOverrides,
  type EnvironmentContextLoader,
  type ModelConfig,
  type RunConfig,
} from './subagentTypes.js';

// Types, interfaces, enums, and ContextState are now in subagentTypes.ts
// Runtime setup helpers are now in subagentRuntimeSetup.ts

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
  private readonly parentAbortSignal?: AbortSignal;
  private parentAbortCleanup?: () => void;

  /** Emoji filter instance for subagent output */
  private readonly emojiFilter?: EmojiFilter;

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
   * @param settingsSnapshot - Runtime settings snapshot containing emojifilter setting.
   */
  /**
   * @plan PLAN-20260303-MESSAGEBUS.P01
   * MessageBus optional parameter added (Phase 1)
   */
  private constructor(
    readonly name: string,
    readonly runtimeContext: AgentRuntimeContext,
    private readonly modelConfig: ModelConfig,
    private readonly runConfig: RunConfig,
    private readonly promptConfig: PromptConfig,
    private readonly contentGenerator: import('./contentGenerator.js').ContentGenerator,
    private readonly toolExecutorContext: ToolExecutionConfig,
    private readonly environmentContextLoader: EnvironmentContextLoader,
    private readonly config: Config,
    private readonly messageBus?: import('../index.js').MessageBus,
    private readonly toolConfig?: ToolConfig,
    private readonly outputConfig?: OutputConfig,
    settingsSnapshot?: ReadonlySettingsSnapshot,
    parentAbortSignal?: AbortSignal,
  ) {
    const randomPart = Math.random().toString(36).slice(2, 8);
    this.subagentId = `${this.name}-${randomPart}`;
    this.parentAbortSignal = parentAbortSignal;

    // Initialize emoji filter based on subagent and foreground settings
    this.emojiFilter = this.createEmojiFilter(settingsSnapshot);
  }

  /**
   * Creates an emoji filter based on the provided settings snapshot
   */
  private createEmojiFilter(
    settingsSnapshot?: ReadonlySettingsSnapshot,
  ): EmojiFilter | undefined {
    return createEmojiFilter(settingsSnapshot);
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
   * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P05
   * @requirement REQ-D01-001.1
   * @pseudocode lines 56-72
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
    parentSignal?: AbortSignal,
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
      foregroundConfig,
      overrides.messageBus,
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
      overrides.messageBus,
      toolConfig,
      outputConfig,
      settingsSnapshot,
      parentSignal,
    );
  }

  private bindParentSignal(abortController: AbortController): void {
    if (!this.parentAbortSignal) {
      return;
    }
    if (this.parentAbortCleanup) {
      this.parentAbortCleanup();
    }
    const relayAbort = () => abortController.abort();
    if (this.parentAbortSignal.aborted) {
      relayAbort();
      return;
    }
    this.parentAbortSignal.addEventListener('abort', relayAbort, {
      once: true,
    });
    this.parentAbortCleanup = () => {
      this.parentAbortSignal?.removeEventListener('abort', relayAbort);
    };
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
    this.bindParentSignal(abortController);

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
        // For subagents, we convert AnsiOutput to string for simple text display
        const textOutput =
          typeof output === 'string'
            ? output
            : output
                .map((line) => line.map((token) => token.text).join(''))
                .join('\n');
        this.onMessage(textOutput);
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

    const schedulerPromise = options?.schedulerFactory
      ? Promise.resolve(
          options.schedulerFactory({
            schedulerConfig,
            onAllToolCallsComplete: handleCompletion,
            outputUpdateHandler,
            onToolCallsUpdate: undefined,
          }),
        )
      : (async () => {
          const sessionId = schedulerConfig.getSessionId();
          return (
            schedulerConfig as Config & {
              getOrCreateScheduler(
                sessionId: string,
                callbacks: SchedulerCallbacks,
                options?: SchedulerOptions,
                dependencies?: {
                  messageBus?: import('../index.js').MessageBus;
                },
              ): ReturnType<Config['getOrCreateScheduler']>;
            }
          ).getOrCreateScheduler(
            sessionId,
            {
              outputUpdateHandler,
              onAllToolCallsComplete: handleCompletion,
              onToolCallsUpdate: undefined,
              getPreferredEditor: () => undefined,
              onEditorClose: () => {},
            },
            undefined,
            {
              messageBus: this.messageBus,
            },
          );
        })();

    let scheduler: Awaited<typeof schedulerPromise>;
    try {
      scheduler = await schedulerPromise;
    } catch (error) {
      this.logger.error(
        () =>
          `Subagent ${this.subagentId} failed to create scheduler: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
      throw error;
    }

    const schedulerDispose = options?.schedulerFactory
      ? typeof scheduler.dispose === 'function'
        ? async () => scheduler.dispose?.()
        : async () => {}
      : async () =>
          schedulerConfig.disposeScheduler(schedulerConfig.getSessionId());

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

            let messageToSend = event.value;
            if (this.emojiFilter) {
              const filterResult = this.emojiFilter.filterText(messageToSend);
              if (filterResult.blocked) {
                this.output.terminate_reason = SubagentTerminateMode.ERROR;
                throw new Error(
                  filterResult.error ?? 'Content blocked by emoji filter',
                );
              }
              messageToSend =
                typeof filterResult.filtered === 'string'
                  ? filterResult.filtered
                  : '';

              // In warn mode, include system feedback
              if (filterResult.systemFeedback && this.onMessage) {
                this.onMessage(filterResult.systemFeedback);
              }
            }

            if (this.onMessage && messageToSend) {
              this.onMessage(messageToSend);
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
          let finalMessage = textResponse.trim();
          if (this.emojiFilter) {
            const filterResult = this.emojiFilter.filterText(finalMessage);
            if (filterResult.blocked) {
              this.output.terminate_reason = SubagentTerminateMode.ERROR;
              throw new Error(
                filterResult.error ?? 'Content blocked by emoji filter',
              );
            }
            finalMessage =
              typeof filterResult.filtered === 'string'
                ? filterResult.filtered
                : '';
          }
          this.output.final_message = finalMessage;
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
                isFatalToolError(call.response.errorType),
            );
            if (fatalCall) {
              const fatalMessage = buildToolUnavailableMessage(
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
      try {
        await schedulerDispose();
      } catch (error) {
        this.logger.warn(
          () =>
            `Subagent ${this.subagentId} failed to dispose scheduler: ${
              error instanceof Error ? error.message : String(error)
            }`,
        );
      }
      this.parentAbortCleanup?.();
      this.parentAbortCleanup = undefined;
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
    this.bindParentSignal(abortController);

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
          const messageToSend = textResponse;
          let messageToCallback = textResponse;

          if (this.emojiFilter) {
            const filterResult = this.emojiFilter.filterText(messageToSend);
            if (filterResult.blocked) {
              this.output.terminate_reason = SubagentTerminateMode.ERROR;
              throw new Error(
                filterResult.error ?? 'Content blocked by emoji filter',
              );
            }
            messageToCallback =
              typeof filterResult.filtered === 'string'
                ? filterResult.filtered
                : '';

            // Include system feedback in warn mode
            if (filterResult.systemFeedback && this.onMessage) {
              this.onMessage(filterResult.systemFeedback);
            }
          }

          if (this.onMessage && messageToCallback) {
            this.onMessage(messageToCallback);
          }

          let cleanedText = messageToSend;
          try {
            const parsedResult = this.textToolParser.parse(messageToSend);
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
            let finalMessage = trimmedText;
            if (this.emojiFilter) {
              const filterResult = this.emojiFilter.filterText(finalMessage);
              if (filterResult.blocked) {
                this.output.terminate_reason = SubagentTerminateMode.ERROR;
                throw new Error(
                  filterResult.error ?? 'Content blocked by emoji filter',
                );
              }
              finalMessage =
                typeof filterResult.filtered === 'string'
                  ? filterResult.filtered
                  : '';
            }
            this.output.final_message = finalMessage;
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
      this.parentAbortCleanup?.();
      this.parentAbortCleanup = undefined;
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
   * Dispose of the subagent scope, cleaning up resources and references.
   * Call this when the subagent is no longer needed to prevent memory leaks.
   *
   * Cleanup performed:
   * - Aborts any active operations
   * - Removes parent abort signal event listeners
   * - Nullifies references to allow garbage collection
   *
   * Safe to call multiple times.
   */
  dispose(): void {
    // 1. Cancel any active operations
    if (
      this.activeAbortController &&
      !this.activeAbortController.signal.aborted
    ) {
      this.logger.debug(
        () =>
          `Disposing subagent ${this.subagentId}, aborting active operations`,
      );
      this.activeAbortController.abort();
    }
    this.activeAbortController = null;

    // 2. Clean up parent abort signal event listeners
    if (this.parentAbortCleanup) {
      this.parentAbortCleanup();
      this.parentAbortCleanup = undefined;
    }

    this.logger.debug(() => `Subagent ${this.subagentId} disposed`);
  }

  private async processFunctionCalls(
    functionCalls: FunctionCall[],
    abortController: AbortController,
    promptId: string,
  ): Promise<Content[]> {
    return processFunctionCalls(functionCalls, abortController, promptId, {
      output: this.output,
      subagentId: this.subagentId,
      logger: this.logger,
      toolExecutorContext: this.toolExecutorContext,
      config: this.config,
      messageBus: this.messageBus,
    });
  }

  private createSchedulerConfig(options?: { interactive?: boolean }): Config {
    return createSchedulerConfig(
      this.toolExecutorContext,
      this.config,
      options,
    );
  }

  private finalizeOutput(): void {
    finalizeOutput(this.output);
  }



  private handleEmitValueCall(request: ToolCallRequestInfo): Part[] {
    return handleEmitValueCall(request, {
      output: this.output,
      onMessage: this.onMessage,
      subagentId: this.subagentId,
      logger: this.logger,
    });
  }

  private buildPartsFromCompletedCalls(
    completedCalls: CompletedToolCall[],
  ): Part[] {
    return buildPartsFromCompletedCalls(completedCalls, {
      onMessage: this.onMessage,
      subagentId: this.subagentId,
      logger: this.logger,
    });
  }

  private async buildTodoCompletionPrompt(): Promise<string | null> {
    return buildTodoCompletionPrompt(
      this.runtimeContext,
      this.subagentId,
      this.logger,
    );
  }

  /**
   * Creates a GeminiChat instance for this subagent.
   *
   * @plan PLAN-20251028-STATELESS6.P08
   * @requirement REQ-STAT6-001.1, REQ-STAT6-003.1
   * @pseudocode agent-runtime-context.md line 99 (step 007.7)
   */
  private async createChatObject(context: ContextState) {
    return createChatObject({
      promptConfig: this.promptConfig,
      modelConfig: this.modelConfig,
      outputConfig: this.outputConfig,
      toolConfig: this.toolConfig,
      runtimeContext: this.runtimeContext,
      contentGenerator: this.contentGenerator,
      environmentContextLoader: this.environmentContextLoader,
      foregroundConfig: this.config,
      context,
    });
  }

  private buildRuntimeFunctionDeclarations(): FunctionDeclaration[] {
    return buildRuntimeFunctionDeclarations(
      this.runtimeContext.tools,
      this.toolConfig,
    );
  }

  /**
   * Returns an array of FunctionDeclaration objects for tools that are local to the subagent's scope.
   * Currently, this includes the `self_emitvalue` tool for emitting variables.
   * @returns An array of `FunctionDeclaration` objects.
   */
  private getScopeLocalFuncDefs() {
    return getScopeLocalFuncDefs(this.outputConfig);
  }

  private normalizeToolName(rawName: string | undefined): string | null {
    return resolveToolName(rawName, this.runtimeContext.tools);
  }

}
