/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Message, Task as SDKTask } from '@a2a-js/sdk';
import type {
  TaskStore,
  AgentExecutor,
  AgentExecutionEvent,
  RequestContext,
  ExecutionEventBus,
} from '@a2a-js/sdk/server';
import type {
  ToolCallRequestInfo,
  CompletedToolCall,
  Config,
  ServerGeminiStreamEvent,
} from '@vybestack/llxprt-code-core';
import { GeminiEventType } from '@vybestack/llxprt-code-core';
import { v4 as uuidv4 } from 'uuid';

import { logger } from '../utils/logger.js';
import type {
  StateChange,
  AgentSettings,
  PersistedStateMetadata,
} from '../types.js';
import {
  CoderAgentEvent,
  getPersistedState,
  setPersistedState,
} from '../types.js';
import { loadConfig, loadEnvironment, setTargetDir } from '../config/config.js';
import { loadSettings } from '../config/settings.js';
import { loadExtensions } from '../config/extension.js';
import { Task } from './task.js';
import { requestStorage } from '../http/requestStorage.js';

/**
 * Provides a wrapper for Task. Passes data from Task to SDKTask.
 * The idea is to use this class inside CoderAgentExecutor to replace Task.
 */
class TaskWrapper {
  task: Task;
  agentSettings: AgentSettings;

  constructor(task: Task, agentSettings: AgentSettings) {
    this.task = task;
    this.agentSettings = agentSettings;
  }

  get id() {
    return this.task.id;
  }

  toSDKTask(): SDKTask {
    const persistedState: PersistedStateMetadata = {
      _agentSettings: this.agentSettings,
      _taskState: this.task.taskState,
    };

    const sdkTask: SDKTask = {
      id: this.task.id,
      contextId: this.task.contextId,
      kind: 'task',
      status: {
        state: this.task.taskState,
        timestamp: new Date().toISOString(),
      },
      metadata: setPersistedState({}, persistedState),
      history: [],
      artifacts: [],
    };
    sdkTask.metadata!['_contextId'] = this.task.contextId;
    return sdkTask;
  }
}

/**
 * CoderAgentExecutor implements the agent's core logic for code generation.
 */
export class CoderAgentExecutor implements AgentExecutor {
  private tasks: Map<string, TaskWrapper> = new Map();
  // Track tasks with an active execution loop.
  private executingTasks = new Set<string>();

  constructor(private taskStore?: TaskStore) {}

  private async getConfig(
    agentSettings: AgentSettings,
    taskId: string,
  ): Promise<Config> {
    const workspaceRoot = setTargetDir(agentSettings);
    loadEnvironment(); // Will override any global env with workspace envs
    const settings = loadSettings(workspaceRoot);
    const extensions = loadExtensions(workspaceRoot);
    return loadConfig(settings, extensions, taskId);
  }

  /**
   * Reconstructs TaskWrapper from SDKTask.
   */
  async reconstruct(
    sdkTask: SDKTask,
    eventBus?: ExecutionEventBus,
  ): Promise<TaskWrapper> {
    const metadata = sdkTask.metadata || {};
    const persistedState = getPersistedState(metadata);

    if (!persistedState) {
      throw new Error(
        `Cannot reconstruct task ${sdkTask.id}: missing persisted state in metadata.`,
      );
    }

    const agentSettings = persistedState._agentSettings;
    const config = await this.getConfig(agentSettings, sdkTask.id);
    const contextId = (metadata['_contextId'] as string) || sdkTask.contextId;
    const runtimeTask = await Task.create(
      sdkTask.id,
      contextId,
      config,
      eventBus,
      agentSettings.autoExecute,
    );
    runtimeTask.taskState = persistedState._taskState;
    const contentGeneratorConfig =
      runtimeTask.config.getContentGeneratorConfig();
    if (contentGeneratorConfig) {
      await runtimeTask.geminiClient.initialize(contentGeneratorConfig);
    }

    const wrapper = new TaskWrapper(runtimeTask, agentSettings);
    this.tasks.set(sdkTask.id, wrapper);
    logger.info(`Task ${sdkTask.id} reconstructed from store.`);
    return wrapper;
  }

  async createTask(
    taskId: string,
    contextId: string,
    agentSettingsInput?: AgentSettings,
    eventBus?: ExecutionEventBus,
  ): Promise<TaskWrapper> {
    const agentSettings = agentSettingsInput || ({} as AgentSettings);
    const config = await this.getConfig(agentSettings, taskId);
    const runtimeTask = await Task.create(
      taskId,
      contextId,
      config,
      eventBus,
      agentSettings.autoExecute,
    );
    const contentGeneratorConfig2 =
      runtimeTask.config.getContentGeneratorConfig();
    if (contentGeneratorConfig2) {
      await runtimeTask.geminiClient.initialize(contentGeneratorConfig2);
    }

    const wrapper = new TaskWrapper(runtimeTask, agentSettings);
    this.tasks.set(taskId, wrapper);
    logger.info(`New task ${taskId} created.`);
    return wrapper;
  }

  getTask(taskId: string): TaskWrapper | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): TaskWrapper[] {
    return Array.from(this.tasks.values());
  }

  #publishTaskNotFoundFailure(
    eventBus: ExecutionEventBus,
    taskId: string,
  ): void {
    logger.warn(
      `[CoderAgentExecutor] Task ${taskId} not found for cancellation.`,
    );
    eventBus.publish({
      kind: 'status-update',
      taskId,
      contextId: uuidv4(),
      status: {
        state: 'failed',
        message: {
          kind: 'message',
          role: 'agent',
          parts: [{ kind: 'text', text: `Task ${taskId} not found.` }],
          messageId: uuidv4(),
          taskId,
        },
      },
      final: true,
    });
  }

  #publishAlreadyFinalState(
    eventBus: ExecutionEventBus,
    taskId: string,
    task: Task,
  ): void {
    logger.info(
      `[CoderAgentExecutor] Task ${taskId} is already in a final state: ${task.taskState}. No action needed for cancellation.`,
    );
    eventBus.publish({
      kind: 'status-update',
      taskId,
      contextId: task.contextId,
      status: {
        state: task.taskState,
        message: {
          kind: 'message',
          role: 'agent',
          parts: [
            {
              kind: 'text',
              text: `Task ${taskId} is already ${task.taskState}.`,
            },
          ],
          messageId: uuidv4(),
          taskId,
        },
      },
      final: true,
    });
  }

  #publishCancellationError(
    eventBus: ExecutionEventBus,
    taskId: string,
    task: Task,
    errorMessage: string,
  ): void {
    logger.error(
      `[CoderAgentExecutor] Error during task cancellation for ${taskId}: ${errorMessage}`,
    );
    eventBus.publish({
      kind: 'status-update',
      taskId,
      contextId: task.contextId,
      status: {
        state: 'failed',
        message: {
          kind: 'message',
          role: 'agent',
          parts: [
            {
              kind: 'text',
              text: `Failed to process cancellation for task ${taskId}: ${errorMessage}`,
            },
          ],
          messageId: uuidv4(),
          taskId,
        },
      },
      final: true,
    });
  }

  cancelTask = async (
    taskId: string,
    eventBus: ExecutionEventBus,
  ): Promise<void> => {
    logger.info(
      `[CoderAgentExecutor] Received cancel request for task ${taskId}`,
    );
    const wrapper = this.tasks.get(taskId);

    if (!wrapper) {
      this.#publishTaskNotFoundFailure(eventBus, taskId);
      return;
    }

    const { task } = wrapper;

    if (task.taskState === 'canceled' || task.taskState === 'failed') {
      this.#publishAlreadyFinalState(eventBus, taskId, task);
      return;
    }

    try {
      logger.info(
        `[CoderAgentExecutor] Initiating cancellation for task ${taskId}.`,
      );
      task.cancelPendingTools('Task canceled by user request.');

      const stateChange: StateChange = {
        kind: CoderAgentEvent.StateChangeEvent,
      };
      task.setTaskStateAndPublishUpdate(
        'canceled',
        stateChange,
        'Task canceled by user request.',
        undefined,
        true,
      );
      logger.info(
        `[CoderAgentExecutor] Task ${taskId} cancellation processed. Saving state.`,
      );
      await this.taskStore?.save(wrapper.toSDKTask());
      logger.info(`[CoderAgentExecutor] Task ${taskId} state CANCELED saved.`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.#publishCancellationError(eventBus, taskId, task, errorMessage);
    }
  };

  #setupSocketCloseHandler(
    taskId: string,
    abortController: AbortController,
    abortSignal: AbortSignal,
  ): void {
    const store = requestStorage.getStore();
    if (!store) {
      logger.error(
        '[CoderAgentExecutor] Could not get request from async local storage. Cancellation on socket close will not be handled for this request.',
      );
      return;
    }

    const socket = store.req.socket;
    const onClientEnd = () => {
      logger.info(
        `[CoderAgentExecutor] Client socket closed for task ${taskId}. Cancelling execution.`,
      );
      if (!abortController.signal.aborted) {
        abortController.abort();
      }
      socket.removeListener('end', onClientEnd);
    };

    socket.on('end', onClientEnd);
    abortSignal.addEventListener('abort', () => {
      socket.removeListener('end', onClientEnd);
    });
    logger.info(
      `[CoderAgentExecutor] Socket close handler set up for task ${taskId}.`,
    );
  }

  #publishHydrationFailure(
    eventBus: ExecutionEventBus,
    taskId: string,
    contextId: string,
  ): void {
    const stateChange: StateChange = {
      kind: CoderAgentEvent.StateChangeEvent,
    };
    eventBus.publish({
      kind: 'status-update',
      taskId,
      contextId,
      status: {
        state: 'failed',
        message: {
          kind: 'message',
          role: 'agent',
          parts: [
            {
              kind: 'text',
              text: 'Internal error: Task state lost or corrupted.',
            },
          ],
          messageId: uuidv4(),
          taskId,
          contextId,
        },
      },
      final: true,
      metadata: { coderAgent: stateChange },
    });
  }

  async #resolveTaskWrapper(
    taskId: string,
    contextId: string,
    userMessage: Message,
    sdkTask: SDKTask | undefined,
    eventBus: ExecutionEventBus,
  ): Promise<TaskWrapper> {
    let wrapper = this.tasks.get(taskId);

    if (wrapper) {
      wrapper.task.eventBus = eventBus;
      logger.info(`[CoderAgentExecutor] Task ${taskId} found in memory cache.`);
      return wrapper;
    }

    if (sdkTask) {
      logger.info(
        `[CoderAgentExecutor] Task ${taskId} found in TaskStore. Reconstructing...`,
      );
      try {
        return await this.reconstruct(sdkTask, eventBus);
      } catch (e) {
        logger.error(
          `[CoderAgentExecutor] Failed to hydrate task ${taskId}:`,
          e,
        );
        this.#publishHydrationFailure(eventBus, taskId, sdkTask.contextId);
        throw new Error(`Failed to hydrate task ${taskId}`);
      }
    }

    logger.info(`[CoderAgentExecutor] Creating new task ${taskId}.`);
    const agentSettings = userMessage.metadata?.['coderAgent'] as AgentSettings;
    wrapper = await this.createTask(taskId, contextId, agentSettings, eventBus);
    const newTaskSDK = wrapper.toSDKTask();
    eventBus.publish({
      ...newTaskSDK,
      kind: 'task',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [userMessage],
    });
    try {
      await this.taskStore?.save(newTaskSDK);
      logger.info(`[CoderAgentExecutor] New task ${taskId} saved to store.`);
    } catch (saveError) {
      logger.error(
        `[CoderAgentExecutor] Failed to save new task ${taskId} to store:`,
        saveError,
      );
    }
    return wrapper;
  }

  async #processAgentTurnLoop(
    task: Task,
    requestContext: RequestContext,
    abortSignal: AbortSignal,
  ): Promise<void> {
    let agentTurnActive = true;
    logger.info(`[CoderAgentExecutor] Task ${task.id}: Processing user turn.`);
    let agentEvents: AsyncGenerator<ServerGeminiStreamEvent, void, unknown> =
      task.acceptUserMessage(requestContext, abortSignal);

    while (agentTurnActive) {
      logger.info(
        `[CoderAgentExecutor] Task ${task.id}: Processing agent turn (LLM stream).`,
      );
      const toolCallRequests: ToolCallRequestInfo[] = [];
      for await (const event of agentEvents) {
        if (abortSignal.aborted) {
          logger.warn(
            `[CoderAgentExecutor] Task ${task.id}: Abort signal received during agent event processing.`,
          );
          throw new Error('Execution aborted');
        }
        if (event.type === GeminiEventType.ToolCallRequest) {
          toolCallRequests.push(event.value);
          continue;
        }
        await task.acceptAgentMessage(event);
      }

      if (abortSignal.aborted) throw new Error('Execution aborted');

      if (toolCallRequests.length > 0) {
        logger.info(
          `[CoderAgentExecutor] Task ${task.id}: Found ${toolCallRequests.length} tool call requests. Scheduling as a batch.`,
        );
        await task.scheduleToolCalls(toolCallRequests, abortSignal);
      }

      logger.info(
        `[CoderAgentExecutor] Task ${task.id}: Waiting for pending tools if any.`,
      );
      await task.waitForPendingTools();
      logger.info(
        `[CoderAgentExecutor] Task ${task.id}: All pending tools completed or none were pending.`,
      );

      // Check abort signal after async operation - signal state may have changed.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (abortSignal.aborted) throw new Error('Execution aborted');

      const completedTools = task.getAndClearCompletedTools();

      if (completedTools.length > 0) {
        const result = await this.#processCompletedTools(
          task,
          completedTools,
          abortSignal,
        );
        if (result === false) {
          agentTurnActive = false;
        } else {
          agentEvents = result;
        }
      } else {
        logger.info(
          `[CoderAgentExecutor] Task ${task.id}: No more tool calls to process. Ending agent turn.`,
        );
        agentTurnActive = false;
      }
    }

    logger.info(
      `[CoderAgentExecutor] Task ${task.id}: Agent turn finished, setting to input-required.`,
    );
    task.setTaskStateAndPublishUpdate(
      'input-required',
      { kind: CoderAgentEvent.StateChangeEvent },
      undefined,
      undefined,
      true,
    );
  }

  async #processCompletedTools(
    task: Task,
    completedTools: CompletedToolCall[],
    abortSignal: AbortSignal,
  ): Promise<AsyncGenerator<ServerGeminiStreamEvent, void, unknown> | false> {
    if (completedTools.every((tool) => tool.status === 'cancelled')) {
      logger.info(
        `[CoderAgentExecutor] Task ${task.id}: All tool calls were cancelled. Updating history and ending agent turn.`,
      );
      task.addToolResponsesToHistory(completedTools);
      task.setTaskStateAndPublishUpdate(
        'input-required',
        { kind: CoderAgentEvent.StateChangeEvent },
        undefined,
        undefined,
        true,
      );
      return false;
    }

    logger.info(
      `[CoderAgentExecutor] Task ${task.id}: Found ${completedTools.length} completed tool calls. Sending results back to LLM.`,
    );
    return task.sendCompletedToolsToLlm(completedTools, abortSignal);
  }

  #handleExecutionError(
    task: Task,
    abortSignal: AbortSignal,
    error: unknown,
  ): void {
    if (abortSignal.aborted) {
      logger.warn(`[CoderAgentExecutor] Task ${task.id} execution aborted.`);
      task.cancelPendingTools('Execution aborted');
      if (task.taskState !== 'canceled' && task.taskState !== 'failed') {
        task.setTaskStateAndPublishUpdate(
          'input-required',
          { kind: CoderAgentEvent.StateChangeEvent },
          'Execution aborted by client.',
          undefined,
          true,
        );
      }
      return;
    }

    const errorMessage =
      error instanceof Error ? error.message : 'Agent execution error';
    logger.error(
      `[CoderAgentExecutor] Error executing agent for task ${task.id}:`,
      error,
    );
    task.cancelPendingTools(errorMessage);
    if (task.taskState !== 'failed') {
      task.setTaskStateAndPublishUpdate(
        'failed',
        { kind: CoderAgentEvent.StateChangeEvent },
        errorMessage,
        undefined,
        true,
      );
    }
  }

  async #saveFinalTaskState(wrapper: TaskWrapper): Promise<void> {
    logger.info(
      `[CoderAgentExecutor] Saving final state for task ${wrapper.id}.`,
    );
    try {
      await this.taskStore?.save(wrapper.toSDKTask());
      logger.info(`[CoderAgentExecutor] Task ${wrapper.id} state saved.`);
    } catch (saveError) {
      logger.error(
        `[CoderAgentExecutor] Failed to save task ${wrapper.id} state in finally block:`,
        saveError,
      );
    }
  }

  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const userMessage = requestContext.userMessage;
    const sdkTask = requestContext.task;

    const taskId = sdkTask?.id || userMessage.taskId || uuidv4();
    const contextId: string =
      userMessage.contextId ||
      sdkTask?.contextId ||
      (sdkTask?.metadata?.['_contextId'] as string | undefined) ||
      uuidv4();

    logger.info(
      `[CoderAgentExecutor] Executing for taskId: ${taskId}, contextId: ${contextId}`,
    );
    logger.info(
      `[CoderAgentExecutor] userMessage: ${JSON.stringify(userMessage)}`,
    );
    eventBus.on('event', (event: AgentExecutionEvent) =>
      logger.info('[EventBus event]: ', event),
    );

    const abortController = new AbortController();
    const abortSignal = abortController.signal;
    this.#setupSocketCloseHandler(taskId, abortController, abortSignal);

    const wrapper = await this.#resolveTaskWrapper(
      taskId,
      contextId,
      userMessage,
      sdkTask,
      eventBus,
    );

    const currentTask = wrapper.task;

    if (['canceled', 'failed', 'completed'].includes(currentTask.taskState)) {
      logger.warn(
        `[CoderAgentExecutor] Attempted to execute task ${taskId} which is already in state ${currentTask.taskState}. Ignoring.`,
      );
      return;
    }

    if (this.executingTasks.has(taskId)) {
      logger.info(
        `[CoderAgentExecutor] Task ${taskId} has a pending execution. Processing message and yielding.`,
      );
      currentTask.eventBus = eventBus;
      for await (const _ of currentTask.acceptUserMessage(
        requestContext,
        abortController.signal,
      )) {
        logger.info(
          `[CoderAgentExecutor] Processing user message ${userMessage.messageId} in secondary execution loop for task ${taskId}.`,
        );
      }
      return;
    }

    logger.info(
      `[CoderAgentExecutor] Starting main execution for message ${userMessage.messageId} for task ${taskId}.`,
    );
    this.executingTasks.add(taskId);

    try {
      await this.#processAgentTurnLoop(
        currentTask,
        requestContext,
        abortSignal,
      );
    } catch (error) {
      this.#handleExecutionError(currentTask, abortSignal, error);
    } finally {
      this.executingTasks.delete(taskId);
      await this.#saveFinalTaskState(wrapper);
    }
  }
}
