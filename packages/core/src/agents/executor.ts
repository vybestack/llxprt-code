/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import { reportError } from '../utils/errorReporting.js';
import {
  GeminiChat,
  StreamEventType,
  type StreamEvent,
} from '../core/geminiChat.js';
import { Type } from '@google/genai';
import { loadAgentRuntime } from '../runtime/AgentRuntimeLoader.js';
import { type ReadonlySettingsSnapshot } from '../runtime/AgentRuntimeContext.js';
import { createProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';
import { createAgentRuntimeStateFromConfig } from '../runtime/runtimeStateFactory.js';
import type {
  Content,
  Part,
  FunctionCall,
  GenerateContentConfig,
  GenerateContentResponse,
  FunctionDeclaration,
  Schema,
} from '@google/genai';
import { executeToolCall } from '../core/nonInteractiveToolExecutor.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';

import { type ToolCallRequestInfo } from '../core/turn.js';
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
import { templateString } from './utils.js';
import { parseThought } from '../utils/thoughtUtils.js';
import { type z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { debugLogger } from '../utils/debugLogger.js';
import { createAbortError } from '../utils/delay.js';
import {
  nextStreamEventWithIdleTimeout,
  resolveStreamIdleTimeoutMs,
} from '../utils/streamIdleTimeout.js';

/** A callback function to report on agent activity. */
export type ActivityCallback = (activity: SubagentActivityEvent) => void;

const TASK_COMPLETE_TOOL_NAME = 'complete_task';

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
    const agentToolRegistry = new ToolRegistry(runtimeContext, messageBus);
    const parentToolRegistry = runtimeContext.getToolRegistry();

    if (definition.toolConfig) {
      for (const toolRef of definition.toolConfig.tools) {
        if (typeof toolRef === 'string') {
          // If the tool is referenced by name, retrieve it from the parent
          // registry and register it with the agent's isolated registry.
          const toolFromParent = parentToolRegistry.getTool(toolRef);
          // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
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
    chat: GeminiChat,
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
    let currentMessage = initialMessage;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Agent/model streams are external runtime boundaries despite declared types.
    while (true) {
      const reason = this.checkTermination(startTime, turnCounter);
      if (reason !== null) {
        return { terminateReason: reason, finalResult };
      }
      if (signal.aborted) {
        return {
          terminateReason: AgentTerminateMode.ABORTED,
          finalResult,
        };
      }

      const promptId = `${this.runtimeContext.getSessionId()}#${this.agentId}#${turnCounter}`;
      turnCounter += 1;
      const { functionCalls } = await this.callModel(
        chat,
        currentMessage,
        tools,
        signal,
        promptId,
      );

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Agent/model streams are external runtime boundaries despite declared types.
      if (signal.aborted) {
        return {
          terminateReason: AgentTerminateMode.ABORTED,
          finalResult,
        };
      }

      if (functionCalls.length === 0) {
        finalResult = `Agent stopped calling tools but did not call '${TASK_COMPLETE_TOOL_NAME}' to finalize the session.`;
        this.emitActivity('ERROR', {
          error: finalResult,
          context: 'protocol_violation',
        });
        return {
          terminateReason: AgentTerminateMode.ERROR,
          finalResult,
        };
      }

      const { nextMessage, submittedOutput, taskCompleted } =
        await this.processFunctionCalls(functionCalls, signal, promptId);

      if (taskCompleted) {
        finalResult = submittedOutput ?? 'Task completed successfully.';
        return {
          terminateReason: AgentTerminateMode.GOAL,
          finalResult,
        };
      }

      currentMessage = nextMessage;
    }
  }

  /**
   * Calls the generative model with the current context and tools.
   *
   * @returns The model's response, including any tool calls or text.
   */
  private async callModel(
    chat: GeminiChat,
    message: Content,
    tools: FunctionDeclaration[],
    signal: AbortSignal,
    promptId: string,
  ): Promise<{ functionCalls: FunctionCall[]; textResponse: string }> {
    const timeoutController = new AbortController();
    const timeoutSignal = timeoutController.signal;
    const onAbort = () => timeoutController.abort();
    signal.addEventListener('abort', onAbort, { once: true });

    const messageParams = {
      message: message.parts ?? [],
      config: {
        abortSignal: timeoutSignal,
        tools: tools.length > 0 ? [{ functionDeclarations: tools }] : undefined,
      },
    };

    let streamIterator: AsyncIterator<StreamEvent> | undefined;
    const effectiveTimeoutMs = resolveStreamIdleTimeoutMs(this.runtimeContext);

    try {
      const responseStream = await chat.sendMessageStream(
        messageParams,
        promptId,
      );

      const functionCalls: FunctionCall[] = [];
      let textResponse = '';
      streamIterator = responseStream[Symbol.asyncIterator]();

      await this.consumeStream(
        streamIterator,
        effectiveTimeoutMs,
        signal,
        timeoutSignal,
        timeoutController,
        functionCalls,
        (text) => {
          textResponse += text;
        },
      );

      return { functionCalls, textResponse };
    } finally {
      streamIterator?.return?.().catch(() => {});
      timeoutController.abort();
      signal.removeEventListener('abort', onAbort);
    }
  }

  /** Consumes a response stream, accumulating function calls and text. */
  private async consumeStream(
    streamIterator: AsyncIterator<StreamEvent>,
    effectiveTimeoutMs: number,
    signal: AbortSignal,
    timeoutSignal: AbortSignal,
    timeoutController: AbortController,
    functionCalls: FunctionCall[],
    onText: (text: string) => void,
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, sonarjs/too-many-break-or-continue-in-loop -- Agent/model streams are external runtime boundaries despite declared types.
    while (true) {
      let result: IteratorResult<StreamEvent>;
      if (effectiveTimeoutMs > 0) {
        result = await nextStreamEventWithIdleTimeout({
          iterator: streamIterator,
          timeoutMs: effectiveTimeoutMs,
          signal: timeoutSignal,
          onTimeout: () => {
            if (signal.aborted) {
              return;
            }
            timeoutController.abort();
          },
          createTimeoutError: () => createAbortError(),
        });
      } else {
        result = await streamIterator.next();
      }
      if (result.done === true) {
        break;
      }

      const resp = result.value;
      if (signal.aborted) break;

      if (resp.type === StreamEventType.CHUNK) {
        this.processStreamChunk(resp.value, functionCalls, onText);
      }
    }
  }

  /** Processes a single stream chunk, extracting thoughts, function calls, and text. */
  private processStreamChunk(
    chunk: GenerateContentResponse,
    functionCalls: FunctionCall[],
    onText: (text: string) => void,
  ): void {
    const parts = chunk.candidates?.[0]?.content?.parts;

    const { subject } = parseThought(
      parts?.find((p: Part) => p.thought === true)?.text ?? '',
    );

    if (subject !== '') {
      this.emitActivity('THOUGHT_CHUNK', { text: subject });
    }

    if (chunk.functionCalls) {
      functionCalls.push(...chunk.functionCalls);
    }

    const text =
      parts
        ?.filter((p: Part) => p.thought !== true && typeof p.text === 'string')
        .map((p: Part) => p.text)
        .join('') ?? '';

    if (text.length > 0) {
      onText(text);
    }
  }

  /** Initializes a `GeminiChat` instance for the agent run. */
  private async createChatObject(inputs: AgentInputs): Promise<GeminiChat> {
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

      return new GeminiChat(
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

  /** Builds the runtime bundle for the GeminiChat instance. */
  private async buildRuntimeBundle() {
    const settings = this.resolveSettingsSnapshot();
    const runtimeState = createAgentRuntimeStateFromConfig(this.runtimeContext);

    const providerRuntime = createProviderRuntimeContext({
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
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Agent/model streams are external runtime boundaries despite declared types.
        providerManager: this.runtimeContext.getProviderManager?.(),
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
      return (
        this.runtimeContext
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Agent/model streams are external runtime boundaries despite declared types.
          .getGeminiClient?.()
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Agent/model streams are external runtime boundaries despite declared types.
          ?.getContentGenerator()
      );
    } catch {
      return undefined;
    }
  }

  /**
   * Executes function calls requested by the model and returns the results.
   *
   * @returns A new `Content` object for history, any submitted output, and completion status.
   */
  private async processFunctionCalls(
    functionCalls: FunctionCall[],
    signal: AbortSignal,
    promptId: string,
  ): Promise<{
    nextMessage: Content;
    submittedOutput: string | null;
    taskCompleted: boolean;
  }> {
    const allowedToolNames = new Set(this.toolRegistry.getAllToolNames());
    allowedToolNames.add(TASK_COMPLETE_TOOL_NAME);

    let submittedOutput: string | null = null;
    let taskCompleted = false;

    const toolExecutionPromises: Array<Promise<Part[] | void>> = [];
    const syncResponseParts: Part[] = [];

    // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    for (const [index, functionCall] of functionCalls.entries()) {
      const callId = functionCall.id ?? `${promptId}-${index}`;
      const args = functionCall.args ?? {};

      this.emitActivity('TOOL_CALL_START', { name: functionCall.name, args });

      if (functionCall.name === TASK_COMPLETE_TOOL_NAME) {
        const result = this.handleCompleteTaskCall(
          functionCall,
          callId,
          args,
          taskCompleted,
          submittedOutput,
        );
        taskCompleted = result.taskCompleted;
        submittedOutput = result.submittedOutput;
        syncResponseParts.push(...result.syncParts);
        continue;
      }

      if (!allowedToolNames.has(functionCall.name as string)) {
        this.handleUnauthorizedToolCall(
          functionCall,
          callId,
          syncResponseParts,
        );
        continue;
      }

      toolExecutionPromises.push(
        this.createToolExecutionPromise(
          functionCall,
          callId,
          args,
          signal,
          promptId,
        ),
      );
    }

    return this.assembleToolResponses(
      functionCalls,
      syncResponseParts,
      toolExecutionPromises,
      submittedOutput,
      taskCompleted,
    );
  }

  /** Handles a `complete_task` function call, returning updated state and response parts. */
  private handleCompleteTaskCall(
    functionCall: FunctionCall,
    callId: string,
    args: Record<string, unknown>,
    currentTaskCompleted: boolean,
    currentSubmittedOutput: string | null,
  ): {
    taskCompleted: boolean;
    submittedOutput: string | null;
    syncParts: Part[];
  } {
    const syncParts: Part[] = [];

    if (currentTaskCompleted) {
      const error =
        'Task already marked complete in this turn. Ignoring duplicate call.';
      syncParts.push({
        functionResponse: {
          name: TASK_COMPLETE_TOOL_NAME,
          response: { error },
          id: callId,
        },
      });
      this.emitActivity('ERROR', {
        context: 'tool_call',
        name: functionCall.name,
        error,
      });
      return {
        taskCompleted: currentTaskCompleted,
        submittedOutput: currentSubmittedOutput,
        syncParts,
      };
    }

    const { outputConfig } = this.definition;

    if (outputConfig) {
      const result = this.processCompleteTaskOutput(
        functionCall,
        callId,
        args,
        outputConfig,
      );
      syncParts.push(...result.syncParts);
      return {
        taskCompleted: result.taskCompleted,
        submittedOutput: result.submittedOutput,
        syncParts,
      };
    }

    syncParts.push({
      functionResponse: {
        name: TASK_COMPLETE_TOOL_NAME,
        response: { status: 'Task marked complete.' },
        id: callId,
      },
    });
    this.emitActivity('TOOL_CALL_END', {
      name: functionCall.name,
      output: 'Task marked complete.',
    });

    return {
      taskCompleted: true,
      submittedOutput: 'Task completed successfully.',
      syncParts,
    };
  }

  /** Processes the output argument of a `complete_task` call when outputConfig is present. */
  private processCompleteTaskOutput(
    functionCall: FunctionCall,
    callId: string,
    args: Record<string, unknown>,
    outputConfig: NonNullable<AgentDefinition<z.ZodTypeAny>['outputConfig']>,
  ): {
    taskCompleted: boolean;
    submittedOutput: string | null;
    syncParts: Part[];
  } {
    const syncParts: Part[] = [];
    const outputName = outputConfig.outputName;

    if (args[outputName] !== undefined) {
      const outputValue = args[outputName];
      const validationResult = outputConfig.schema.safeParse(outputValue);

      if (!validationResult.success) {
        const error = `Output validation failed: ${JSON.stringify(validationResult.error.flatten())}`;
        syncParts.push({
          functionResponse: {
            name: TASK_COMPLETE_TOOL_NAME,
            response: { error },
            id: callId,
          },
        });
        this.emitActivity('ERROR', {
          context: 'tool_call',
          name: functionCall.name,
          error,
        });
        return { taskCompleted: false, submittedOutput: null, syncParts };
      }

      const validatedOutput = validationResult.data;
      let submittedOutput: string;
      if (this.definition.processOutput) {
        submittedOutput = this.definition.processOutput(validatedOutput);
      } else if (typeof outputValue === 'string') {
        submittedOutput = outputValue;
      } else {
        submittedOutput = JSON.stringify(outputValue, null, 2);
      }

      syncParts.push({
        functionResponse: {
          name: TASK_COMPLETE_TOOL_NAME,
          response: { result: 'Output submitted and task completed.' },
          id: callId,
        },
      });
      this.emitActivity('TOOL_CALL_END', {
        name: functionCall.name,
        output: 'Output submitted and task completed.',
      });
      return { taskCompleted: true, submittedOutput, syncParts };
    }

    // Missing required output argument
    const error = `Missing required argument '${outputName}' for completion.`;
    syncParts.push({
      functionResponse: {
        name: TASK_COMPLETE_TOOL_NAME,
        response: { error },
        id: callId,
      },
    });
    this.emitActivity('ERROR', {
      context: 'tool_call',
      name: functionCall.name,
      error,
    });
    return { taskCompleted: false, submittedOutput: null, syncParts };
  }

  /** Handles an unauthorized tool call by pushing an error response. */
  private handleUnauthorizedToolCall(
    functionCall: FunctionCall,
    callId: string,
    syncResponseParts: Part[],
  ): void {
    const error = `Unauthorized tool call: '${functionCall.name}' is not available to this agent.`;

    debugLogger.warn(`[AgentExecutor] Blocked call: ${error}`);

    syncResponseParts.push({
      functionResponse: {
        name: functionCall.name as string,
        id: callId,
        response: { error },
      },
    });

    this.emitActivity('ERROR', {
      context: 'tool_call_unauthorized',
      name: functionCall.name,
      callId,
      error,
    });
  }

  /** Creates an async promise that executes a standard tool call. */
  private createToolExecutionPromise(
    functionCall: FunctionCall,
    callId: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
    promptId: string,
  ): Promise<Part[] | void> {
    const requestInfo: ToolCallRequestInfo = {
      callId,
      name: functionCall.name as string,
      args,
      isClientInitiated: true,
      prompt_id: promptId,
    };

    return (async () => {
      const completed = await executeToolCall(
        this.runtimeContext,
        requestInfo,
        signal,
        { messageBus: this.messageBus },
      );
      const toolResponse = completed.response;

      if (toolResponse.error) {
        this.emitActivity('ERROR', {
          context: 'tool_call',
          name: functionCall.name,
          error: toolResponse.error.message,
        });
      } else {
        this.emitActivity('TOOL_CALL_END', {
          name: functionCall.name,
          output: toolResponse.resultDisplay,
        });
      }

      return toolResponse.responseParts;
    })();
  }

  /** Assembles all tool response parts and returns the final result. */
  private async assembleToolResponses(
    functionCalls: FunctionCall[],
    syncResponseParts: Part[],
    toolExecutionPromises: Array<Promise<Part[] | void>>,
    submittedOutput: string | null,
    taskCompleted: boolean,
  ): Promise<{
    nextMessage: Content;
    submittedOutput: string | null;
    taskCompleted: boolean;
  }> {
    const asyncResults = await Promise.all(toolExecutionPromises);

    const toolResponseParts: Part[] = [...syncResponseParts];
    for (const result of asyncResults) {
      if (result) {
        toolResponseParts.push(...result);
      }
    }

    if (
      functionCalls.length > 0 &&
      toolResponseParts.length === 0 &&
      !taskCompleted
    ) {
      toolResponseParts.push({
        text: 'All tool calls failed or were unauthorized. Please analyze the errors and try an alternative approach.',
      });
    }

    return {
      nextMessage: { role: 'user', parts: toolResponseParts },
      submittedOutput,
      taskCompleted,
    };
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
    // Configure its schema based on whether output is expected.
    const completeTool: FunctionDeclaration = {
      name: TASK_COMPLETE_TOOL_NAME,
      description: outputConfig
        ? 'Call this tool to submit your final answer and complete the task. This is the ONLY way to finish.'
        : 'Call this tool to signal that you have completed your task. This is the ONLY way to finish.',
      parameters: {
        type: Type.OBJECT,
        properties: {},
        required: [],
      },
    };

    if (outputConfig) {
      const jsonSchema = zodToJsonSchema(outputConfig.schema);
      const {
        $schema: _$schema,
        definitions: _definitions,
        ...schema
      } = jsonSchema;
      completeTool.parameters!.properties![outputConfig.outputName] =
        schema as Schema;
      completeTool.parameters!.required!.push(outputConfig.outputName);
    }

    toolsList.push(completeTool);

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
   * @returns The reason for termination, or `null` if execution can continue.
   */
  private checkTermination(
    startTime: number,
    turnCounter: number,
  ): AgentTerminateMode | null {
    return checkAgentTermination(
      this.definition.runConfig,
      startTime,
      turnCounter,
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
