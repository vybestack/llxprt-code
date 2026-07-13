/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { reportError } from '@vybestack/llxprt-code-core/utils/errorReporting.js';
import { ChatSession } from '../core/chatSession.js';
import { loadAgentRuntime } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import { type ReadonlySettingsSnapshot } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { createSettingsProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/settingsRuntimeAdapter.js';
import { createAgentRuntimeStateFromConfig } from '@vybestack/llxprt-code-core/runtime/runtimeStateFactory.js';
import type {
  Content,
  FunctionCall,
  GenerateContentConfig,
  FunctionDeclaration,
} from '@google/genai';
import { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { AnyDeclarativeTool } from '@vybestack/llxprt-code-tools';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { CoreMessageBusAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreMessageBusAdapter.js';
import { CoreToolRegistryHostAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreToolRegistryHostAdapter.js';

import type {
  AgentDefinition,
  AgentInputs,
  OutputObject,
  SubagentActivityEvent,
} from './types.js';
import { AgentTerminateMode } from './types.js';
import { validateToolsForNonInteractiveUse } from './executor-validation.js';
import {
  buildAgentSystemPrompt,
  applyTemplateToInitialMessages,
} from './executor-prompt-builder.js';
import { checkAgentTermination } from './executor-termination.js';
import {
  type RecoveryState,
  type EmitActivityFn,
  resolveGracePeriodSeconds,
  recoveryFailureResult,
  markRecoveryResponseUsed,
  checkRecoveryToolCalls,
  handleTerminationReason,
  handleProtocolViolation,
} from './recovery.js';
import { templateString } from './utils.js';
import { type z } from 'zod';
import {
  processFunctionCalls as processFunctionCallsDispatch,
  buildCompleteTaskDeclaration,
} from './executor-tool-dispatch.js';
import { callModelAndConsumeStream } from './executor-stream-processor.js';

/** Result type for a single agent loop iteration. */
type AgentLoopIterationResult =
  | {
      kind: 'continue';
      recoveryState: RecoveryState;
      currentMessage: Content;
      recoveryModelResponseUsed: boolean | undefined;
      turnCounter: number;
      finalResult: string | null;
    }
  | {
      kind: 'done';
      result: {
        terminateReason: AgentTerminateMode;
        finalResult: string | null;
      };
    };

/** A callback function to report on agent activity. */
export type ActivityCallback = (activity: SubagentActivityEvent) => void;

/**
 * Register tools from the agent's tool config into the isolated agent registry.
 *
 * String references are resolved from the parent registry; tool instances with
 * a `build` method are registered directly; raw `FunctionDeclaration` objects
 * are skipped (their schemas are passed to the model later).
 */
function registerToolsFromConfig(
  tools: Array<string | FunctionDeclaration | AnyDeclarativeTool>,
  parentToolRegistry: ToolRegistry,
  agentToolRegistry: ToolRegistry,
): void {
  for (const toolRef of tools) {
    if (typeof toolRef === 'string') {
      // If the tool is referenced by name, retrieve it from the parent
      // registry and register it with the agent's isolated registry.
      const toolFromParent = parentToolRegistry.getTool(toolRef);
      if (toolFromParent) {
        agentToolRegistry.registerTool(toolFromParent);
      }
    } else if (
      typeof toolRef === 'object' &&
      'name' in toolRef &&
      'build' in toolRef
    ) {
      agentToolRegistry.registerTool(toolRef);
    }
    // Note: Raw `FunctionDeclaration` objects in the config don't need to be
    // registered; their schemas are passed directly to the model later.
  }
}

/**
 * Executes an agent loop based on an {@link AgentDefinition}.
 *
 * This executor runs the agent in a loop, calling tools until it calls the
 * mandatory `complete_task` tool to signal completion.
 */
export class AgentExecutor<TOutput extends z.ZodTypeAny> {
  readonly definition: AgentDefinition<TOutput>;

  private readonly agentId: string;
  private readonly toolRegistry: ToolRegistry;
  private readonly runtimeContext: Config;
  private readonly messageBus: MessageBus;
  private readonly onActivity?: ActivityCallback;

  /**
   * Creates and validates a new `AgentExecutor` instance.
   *
   * This method ensures that all tools specified in the agent's definition are
   * safe for non-interactive use before creating the executor.
   *
   * @param definition The definition object for the agent.
   * @param runtimeContext The global runtime configuration.
   * @param onActivity An optional callback to receive activity events.
   * @returns A promise that resolves to a new `AgentExecutor` instance.
   */
  /**
   * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P05
   * @requirement REQ-D01-001.2
   * @pseudocode lines 56-72
   */
  static async create<TOutput extends z.ZodTypeAny>(
    definition: AgentDefinition<TOutput>,
    runtimeContext: Config,
    messageBus: MessageBus,
    onActivity?: ActivityCallback,
  ): Promise<AgentExecutor<TOutput>> {
    /**
     * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P05
     * @requirement REQ-D01-001.2
     * @pseudocode lines 56-72
     */
    const agentToolRegistry = new ToolRegistry(
      new CoreToolRegistryHostAdapter(runtimeContext),
      new CoreMessageBusAdapter(messageBus),
    );
    const parentToolRegistry = runtimeContext.getToolRegistry();

    if (definition.toolConfig) {
      registerToolsFromConfig(
        definition.toolConfig.tools,
        parentToolRegistry,
        agentToolRegistry,
      );

      agentToolRegistry.sortTools();
      // Validate that all registered tools are safe for non-interactive
      // execution.
      await validateToolsForNonInteractiveUse(
        agentToolRegistry,
        definition.name,
      );
    }

    return new AgentExecutor(
      definition,
      runtimeContext,
      agentToolRegistry,
      messageBus,
      onActivity,
    );
  }

  /**
   * Constructs a new AgentExecutor instance.
   *
   * @private This constructor is private. Use the static `create` method to
   * instantiate the class.
   */
  private constructor(
    definition: AgentDefinition<TOutput>,
    runtimeContext: Config,
    toolRegistry: ToolRegistry,
    messageBus: MessageBus,
    onActivity?: ActivityCallback,
  ) {
    this.definition = definition;
    this.runtimeContext = runtimeContext;
    this.toolRegistry = toolRegistry;
    this.messageBus = messageBus;
    this.onActivity = onActivity;

    const randomIdPart = Math.random().toString(36).slice(2, 8);
    this.agentId = `${this.definition.name}-${randomIdPart}`;
  }

  /**
   * Runs the agent.
   *
   * @param inputs The validated input parameters for this invocation.
   * @param signal An `AbortSignal` for cancellation.
   * @returns A promise that resolves to the agent's final output.
   */
  async run(inputs: AgentInputs, signal: AbortSignal): Promise<OutputObject> {
    const startTime = Date.now();

    try {
      const chat = await this.createChatObject(inputs);
      const tools = this.prepareToolsList();

      const query = this.definition.promptConfig.query
        ? templateString(this.definition.promptConfig.query, inputs)
        : 'Get Started!';
      const initialMessage: Content = {
        role: 'user',
        parts: [{ text: query }],
      };

      const { terminateReason, finalResult } = await this.runAgentLoop(
        chat,
        tools,
        initialMessage,
        signal,
        startTime,
        0,
      );

      if (terminateReason === AgentTerminateMode.GOAL) {
        return {
          result: finalResult ?? 'Task completed.',
          terminate_reason: terminateReason,
        };
      }

      return {
        result:
          finalResult ?? 'Agent execution was terminated before completion.',
        terminate_reason: terminateReason,
      };
    } catch (error) {
      this.emitActivity('ERROR', { error: String(error) });
      throw error;
    }
  }

  /** Runs the agent loop until termination, returning the reason and result. */
  private async runAgentLoop(
    chat: ChatSession,
    tools: FunctionDeclaration[],
    initialMessage: Content,
    signal: AbortSignal,
    startTime: number,
    turnCounter: number,
  ): Promise<{
    terminateReason: AgentTerminateMode;
    finalResult: string | null;
  }> {
    let finalResult: string | null = null;
    let currentMessage: Content = initialMessage;
    let recoveryState: RecoveryState = { phase: 'none' };
    let recoveryModelResponseUsed = false;

    for (;;) {
      const outcome = await this.runAgentLoopIteration(
        chat,
        tools,
        signal,
        startTime,
        turnCounter,
        finalResult,
        currentMessage,
        recoveryState,
        recoveryModelResponseUsed,
      );
      if (outcome.kind === 'continue') {
        recoveryState = outcome.recoveryState;
        currentMessage = outcome.currentMessage;
        if (outcome.recoveryModelResponseUsed !== undefined) {
          recoveryModelResponseUsed = outcome.recoveryModelResponseUsed;
        }
        turnCounter = outcome.turnCounter;
        finalResult = outcome.finalResult;
      } else {
        return outcome.result;
      }
    }
  }

  /** Single iteration of the agent loop. */
  private async runAgentLoopIteration(
    chat: ChatSession,
    tools: FunctionDeclaration[],
    signal: AbortSignal,
    startTime: number,
    turnCounter: number,
    finalResult: string | null,
    currentMessage: Content,
    recoveryState: RecoveryState,
    recoveryModelResponseUsed: boolean,
  ): Promise<AgentLoopIterationResult> {
    const recoveryDeadlineMs =
      recoveryState.phase === 'active' ? recoveryState.deadlineMs : undefined;
    const reason = this.checkTermination(
      startTime,
      turnCounter,
      recoveryDeadlineMs,
    );

    if (reason !== null) {
      const termOutcome = this.handleTerminationReason(
        reason,
        recoveryState,
        finalResult,
      );
      if (termOutcome.handled) {
        return {
          kind: 'continue',
          recoveryState: termOutcome.newState,
          currentMessage: termOutcome.currentMessage,
          recoveryModelResponseUsed: undefined,
          turnCounter,
          finalResult,
        };
      }
      return { kind: 'done', result: termOutcome.result };
    }

    return this.runAgentLoopIterationBody(
      chat,
      tools,
      signal,
      startTime,
      turnCounter,
      finalResult,
      currentMessage,
      recoveryState,
      recoveryModelResponseUsed,
    );
  }

  /** Body of the agent loop iteration (after termination checks). */
  private async runAgentLoopIterationBody(
    chat: ChatSession,
    tools: FunctionDeclaration[],
    signal: AbortSignal,
    startTime: number,
    turnCounter: number,
    finalResult: string | null,
    currentMessage: Content,
    recoveryState: RecoveryState,
    recoveryModelResponseUsed: boolean,
  ): Promise<AgentLoopIterationResult> {
    if (signal.aborted) {
      return {
        kind: 'done',
        result: { terminateReason: AgentTerminateMode.ABORTED, finalResult },
      };
    }

    const promptId = `${this.runtimeContext.getSessionId()}#${this.agentId}#${turnCounter}`;
    const nextTurnCounter = turnCounter + 1;

    const modelOutcome = await this.executeModelCall(
      chat,
      tools,
      signal,
      currentMessage,
      recoveryState,
      recoveryModelResponseUsed,
      finalResult,
      promptId,
    );
    if (modelOutcome.kind === 'error') {
      return modelOutcome.result;
    }

    return this.handleModelResponse(
      modelOutcome.functionCalls,
      signal,
      promptId,
      nextTurnCounter,
      finalResult,
      recoveryState,
      recoveryModelResponseUsed,
    );
  }

  /** Execute the model call, handling recovery-abort and error paths. */
  private async executeModelCall(
    chat: ChatSession,
    tools: FunctionDeclaration[],
    signal: AbortSignal,
    currentMessage: Content,
    recoveryState: RecoveryState,
    recoveryModelResponseUsed: boolean,
    finalResult: string | null,
    promptId: string,
  ): Promise<
    | { kind: 'ok'; functionCalls: FunctionCall[] }
    | { kind: 'error'; result: AgentLoopIterationResult }
  > {
    const recoveryAbort =
      recoveryState.phase === 'active' && !recoveryModelResponseUsed
        ? this.createRecoveryAbortController(recoveryState.deadlineMs, signal)
        : undefined;

    try {
      const toolsConfig =
        tools.length > 0 ? [{ functionDeclarations: tools }] : undefined;
      const modelResult = await callModelAndConsumeStream(
        chat,
        currentMessage,
        toolsConfig,
        recoveryAbort?.signal ?? signal,
        promptId,
        this.runtimeContext,
        (type, data) => this.emitActivity(type, data),
      );
      return { kind: 'ok', functionCalls: modelResult.functionCalls };
    } catch (error) {
      const errorResult = this.handleModelCallError(
        error,
        recoveryState,
        signal,
        finalResult,
      );
      if (errorResult !== null) {
        return { kind: 'error', result: errorResult };
      }
      throw error;
    } finally {
      recoveryAbort?.abort();
    }
  }

  /** Handle an error from callModel during recovery or re-throw. */
  private handleModelCallError(
    error: unknown,
    recoveryState: RecoveryState,
    signal: AbortSignal,
    finalResult: string | null,
  ): AgentLoopIterationResult | null {
    if (recoveryState.phase !== 'active') {
      return null;
    }
    // If the parent signal was aborted, terminate as ABORTED rather than
    // emitting a misleading recovery-timeout outcome. Using this.isAborted
    // avoids TS narrowing the flag to false after the early return above,
    // since signal.aborted can flip during the awaited callModel.
    if (this.isAborted(signal)) {
      return {
        kind: 'done',
        result: {
          terminateReason: AgentTerminateMode.ABORTED,
          finalResult,
        },
      };
    }
    this.emitRecoveryOutcome(
      recoveryState.originalReason,
      'failure',
      recoveryState.originalReason,
      recoveryState.gracePeriodSeconds,
    );
    return {
      kind: 'done',
      result: {
        terminateReason: recoveryState.originalReason,
        finalResult: finalResult ?? 'Recovery turn timed out.',
      },
    };
  }

  /** Handle the model's response: recovery checks, protocol violation, tool dispatch. */
  private async handleModelResponse(
    functionCalls: FunctionCall[],
    signal: AbortSignal,
    promptId: string,
    nextTurnCounter: number,
    finalResult: string | null,
    recoveryState: RecoveryState,
    recoveryModelResponseUsed: boolean,
  ): Promise<AgentLoopIterationResult> {
    const newRecoveryModelResponseUsed = markRecoveryResponseUsed(
      recoveryState,
      recoveryModelResponseUsed,
    );

    if (this.isAborted(signal)) {
      return {
        kind: 'done',
        result: { terminateReason: AgentTerminateMode.ABORTED, finalResult },
      };
    }

    const gracePeriodSeconds = resolveGracePeriodSeconds(
      this.definition.runConfig.grace_period_seconds,
    );
    const emitFn: EmitActivityFn = (type, data) =>
      this.emitActivity(type, data);

    const checkResult = checkRecoveryToolCalls(
      recoveryState,
      newRecoveryModelResponseUsed,
      functionCalls,
      finalResult,
      emitFn,
    );
    if (checkResult) {
      return { kind: 'done', result: checkResult };
    }

    if (functionCalls.length === 0) {
      return this.handleEmptyFunctionCalls(
        recoveryState,
        finalResult,
        nextTurnCounter,
        gracePeriodSeconds,
        emitFn,
      );
    }

    return this.processToolCalls(
      functionCalls,
      signal,
      promptId,
      nextTurnCounter,
      finalResult,
      recoveryState,
      newRecoveryModelResponseUsed,
      emitFn,
    );
  }

  /** Handle the protocol-violation path when the model returned no tool calls. */
  private handleEmptyFunctionCalls(
    recoveryState: RecoveryState,
    finalResult: string | null,
    nextTurnCounter: number,
    gracePeriodSeconds: number,
    emitFn: EmitActivityFn,
  ): AgentLoopIterationResult {
    const enterResult = handleProtocolViolation(
      recoveryState,
      finalResult,
      gracePeriodSeconds,
      emitFn,
    );
    if (enterResult.entered) {
      return {
        kind: 'continue',
        recoveryState: enterResult.state,
        currentMessage: enterResult.warningMessage,
        recoveryModelResponseUsed: false,
        turnCounter: nextTurnCounter,
        finalResult,
      };
    }
    const activeGrace =
      recoveryState.phase === 'active' ? recoveryState.gracePeriodSeconds : 0;
    this.emitRecoveryOutcome(
      enterResult.result.terminateReason,
      'failure',
      enterResult.result.terminateReason,
      activeGrace,
    );
    return { kind: 'done', result: enterResult.result };
  }

  /** Dispatch tool calls and handle task completion / recovery-failure paths. */
  private async processToolCalls(
    functionCalls: FunctionCall[],
    signal: AbortSignal,
    promptId: string,
    nextTurnCounter: number,
    finalResult: string | null,
    recoveryState: RecoveryState,
    newRecoveryModelResponseUsed: boolean,
    emitFn: EmitActivityFn,
  ): Promise<AgentLoopIterationResult> {
    const { nextMessage, submittedOutput, taskCompleted, partialResult } =
      await processFunctionCallsDispatch(
        functionCalls,
        this.toolRegistry,
        this.runtimeContext,
        this.messageBus,
        this.definition as unknown as AgentDefinition<z.ZodTypeAny>,
        emitFn,
        signal,
        promptId,
      );

    if (taskCompleted) {
      if (recoveryState.phase === 'active') {
        this.emitRecoveryOutcome(
          recoveryState.originalReason,
          'success',
          AgentTerminateMode.GOAL,
          recoveryState.gracePeriodSeconds,
        );
      }
      const completedResult = submittedOutput ?? 'Task completed successfully.';
      return {
        kind: 'done',
        result: {
          terminateReason: AgentTerminateMode.GOAL,
          finalResult: completedResult,
        },
      };
    }

    if (recoveryState.phase === 'active' && newRecoveryModelResponseUsed) {
      const fail = recoveryFailureResult(
        recoveryState.originalReason,
        finalResult,
      );
      this.emitRecoveryOutcome(
        recoveryState.originalReason,
        'failure',
        fail.terminateReason,
        recoveryState.gracePeriodSeconds,
      );
      return { kind: 'done', result: fail };
    }

    const nextFinalResult = partialResult ?? finalResult;
    return {
      kind: 'continue',
      recoveryState,
      currentMessage: nextMessage,
      recoveryModelResponseUsed: newRecoveryModelResponseUsed,
      turnCounter: nextTurnCounter,
      finalResult: nextFinalResult,
    };
  }

  /** Handle termination-reason checks: enter recovery or return immediately. */
  private handleTerminationReason(
    reason: AgentTerminateMode,
    recoveryState: RecoveryState,
    finalResult: string | null,
  ) {
    const gracePeriodSeconds = resolveGracePeriodSeconds(
      this.definition.runConfig.grace_period_seconds,
    );
    return handleTerminationReason(
      reason,
      recoveryState,
      finalResult,
      gracePeriodSeconds,
      (type, data) => this.emitActivity(type, data),
    );
  }

  private isAborted(signal: AbortSignal): boolean {
    return signal.aborted;
  }

  /** Create an AbortController that fires when the recovery deadline passes. */
  private createRecoveryAbortController(
    deadlineMs: number,
    parentSignal: AbortSignal,
  ): AbortController {
    const controller = new AbortController();
    const remaining = deadlineMs - Date.now();
    const timer = setTimeout(() => controller.abort(), Math.max(0, remaining));
    const onParentAbort = () => controller.abort();
    parentSignal.addEventListener('abort', onParentAbort, { once: true });
    // Clean up both when our controller fires
    controller.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        parentSignal.removeEventListener('abort', onParentAbort);
      },
      { once: true },
    );
    return controller;
  }

  /** Emit a RECOVERY_OUTCOME telemetry event. */
  private emitRecoveryOutcome(
    originalReason: AgentTerminateMode,
    outcome: 'success' | 'failure',
    terminateReason: AgentTerminateMode,
    gracePeriodSeconds: number,
  ): void {
    this.emitActivity('RECOVERY_OUTCOME', {
      originalReason,
      outcome,
      terminateReason,
      gracePeriodSeconds,
    });
  }

  /** Initializes a `ChatSession` instance for the agent run. */
  private async createChatObject(inputs: AgentInputs): Promise<ChatSession> {
    const { promptConfig, modelConfig } = this.definition;

    if (!promptConfig.systemPrompt && !promptConfig.initialMessages) {
      throw new Error(
        'PromptConfig must define either `systemPrompt` or `initialMessages`.',
      );
    }

    const startHistory = this.applyTemplateToInitialMessages(
      promptConfig.initialMessages ?? [],
      inputs,
    );

    const systemInstruction = promptConfig.systemPrompt
      ? await this.buildSystemPrompt(inputs)
      : undefined;

    try {
      const generationConfig = this.buildGenerationConfig(
        modelConfig,
        systemInstruction,
      );
      const runtimeBundle = await this.buildRuntimeBundle();

      return new ChatSession(
        runtimeBundle.runtimeContext,
        runtimeBundle.contentGenerator,
        generationConfig,
        startHistory,
      );
    } catch (error) {
      await reportError(
        error,
        `Error initializing Gemini chat for agent ${this.definition.name}.`,
        startHistory,
        'startChat',
      );
      throw new Error(`Failed to create chat object: ${error}`);
    }
  }

  /** Builds the generation config from model config and optional system instruction. */
  private buildGenerationConfig(
    modelConfig: AgentDefinition<z.ZodTypeAny>['modelConfig'],
    systemInstruction?: string,
  ): GenerateContentConfig {
    const generationConfig: GenerateContentConfig = {
      temperature: modelConfig.temp,
      topP: modelConfig.top_p,
      thinkingConfig: {
        includeThoughts: true,
        thinkingBudget: modelConfig.thinkingBudget ?? -1,
      },
    };

    if (systemInstruction) {
      generationConfig.systemInstruction = systemInstruction;
    }

    return generationConfig;
  }

  /** Builds the runtime bundle for the ChatSession instance. */
  private async buildRuntimeBundle() {
    const settings = this.resolveSettingsSnapshot();
    const runtimeState = createAgentRuntimeStateFromConfig(this.runtimeContext);

    const providerRuntime = createSettingsProviderRuntimeContext({
      settingsService: this.runtimeContext.getSettingsService(),
      config: this.runtimeContext,
      runtimeId: runtimeState.runtimeId,
      metadata: { source: 'AgentExecutor.createChatObject' },
    });

    return loadAgentRuntime({
      profile: {
        config: this.runtimeContext,
        state: runtimeState,
        settings,
        providerRuntime,
        contentGeneratorConfig: this.runtimeContext.getContentGeneratorConfig(),
        toolRegistry: this.toolRegistry,
        providerManager: this.runtimeContext.getProviderManager(),
      },
      overrides: {
        contentGenerator: this.tryGetContentGenerator(),
      },
    });
  }

  /** Resolves the settings snapshot from ephemeral config. */
  private resolveSettingsSnapshot(): ReadonlySettingsSnapshot {
    const rawCompressionThreshold = this.runtimeContext.getEphemeralSetting(
      'compression-threshold',
    );
    const compressionThreshold =
      typeof rawCompressionThreshold === 'number'
        ? rawCompressionThreshold
        : 0.8;

    const rawContextLimit =
      this.runtimeContext.getEphemeralSetting('context-limit');
    const contextLimit =
      typeof rawContextLimit === 'number' &&
      Number.isFinite(rawContextLimit) &&
      rawContextLimit > 0
        ? rawContextLimit
        : undefined;

    const rawPreserveThreshold = this.runtimeContext.getEphemeralSetting(
      'compression-preserve-threshold',
    );
    const preserveThreshold =
      typeof rawPreserveThreshold === 'number' ? rawPreserveThreshold : 0.2;

    return {
      compressionThreshold,
      contextLimit,
      preserveThreshold,
      telemetry: {
        enabled: true,
        target: null,
      },
    };
  }

  /** Attempts to get the content generator from the runtime context. */
  private tryGetContentGenerator() {
    try {
      return this.runtimeContext.getAgentClient().getContentGenerator();
    } catch {
      return undefined;
    }
  }

  /**
   * Prepares the list of tool function declarations to be sent to the model.
   */
  private prepareToolsList(): FunctionDeclaration[] {
    const toolsList: FunctionDeclaration[] = [];
    const { toolConfig, outputConfig } = this.definition;

    if (toolConfig) {
      const toolNamesToLoad: string[] = [];
      for (const toolRef of toolConfig.tools) {
        if (typeof toolRef === 'string') {
          toolNamesToLoad.push(toolRef);
        } else if (typeof toolRef === 'object' && 'schema' in toolRef) {
          // Tool instance with an explicit schema property.
          toolsList.push(toolRef.schema);
        } else {
          // Raw `FunctionDeclaration` object.
          toolsList.push(toolRef);
        }
      }
      // Add schemas from tools that were registered by name.
      toolsList.push(
        ...this.toolRegistry.getFunctionDeclarationsFiltered(toolNamesToLoad),
      );
    }

    // Always inject complete_task.
    toolsList.push(buildCompleteTaskDeclaration(outputConfig));

    return toolsList;
  }

  /** Builds the system prompt from the agent definition and inputs. */
  private async buildSystemPrompt(inputs: AgentInputs): Promise<string> {
    const { promptConfig } = this.definition;
    if (!promptConfig.systemPrompt) {
      return '';
    }
    return buildAgentSystemPrompt(
      inputs,
      this.runtimeContext,
      promptConfig.systemPrompt,
    );
  }

  /**
   * Applies template strings to initial messages.
   *
   * @param initialMessages The initial messages from the prompt config.
   * @param inputs The validated input parameters for this invocation.
   * @returns A new array of `Content` with templated strings.
   */
  private applyTemplateToInitialMessages(
    initialMessages: Content[],
    inputs: AgentInputs,
  ): Content[] {
    return applyTemplateToInitialMessages(initialMessages, inputs);
  }

  /**
   * Checks if the agent should terminate due to exceeding configured limits.
   *
   * @param startTime The timestamp (ms) when execution started.
   * @param turnCounter The current turn number.
   * @param recoveryDeadlineMs If in a recovery turn, the absolute deadline (ms)
   *   that overrides normal max_time_minutes. Pass `undefined` when not recovering.
   * @returns The reason for termination, or `null` if execution can continue.
   */
  private checkTermination(
    startTime: number,
    turnCounter: number,
    recoveryDeadlineMs?: number,
  ): AgentTerminateMode | null {
    return checkAgentTermination(
      this.definition.runConfig,
      startTime,
      turnCounter,
      recoveryDeadlineMs,
    );
  }

  /** Emits an activity event to the configured callback. */
  private emitActivity(
    type: SubagentActivityEvent['type'],
    data: Record<string, unknown>,
  ): void {
    if (this.onActivity) {
      const event: SubagentActivityEvent = {
        isSubagentActivityEvent: true,
        agentName: this.definition.name,
        type,
        data,
      };
      this.onActivity(event);
    }
  }
}
