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
import type { Agent, AgentEvent } from '@vybestack/llxprt-code-agents';
import { REFUSAL_NOTICE_MESSAGE } from '@vybestack/llxprt-code-core';
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
import {
  createTaskAgent,
  loadEnvironment,
  setTargetDir,
} from '../config/config.js';
import { loadSettings } from '../config/settings.js';
import { loadExtensions } from '../config/extension.js';
import { Task } from './task.js';
import { requestStorage } from '../http/requestStorage.js';

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('Execution aborted');
  }
}

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
export interface CoderAgentExecutorDependencies {
  createTaskAgent?: typeof createTaskAgent;
  loadEnvironment?: typeof loadEnvironment;
  setTargetDir?: typeof setTargetDir;
  loadSettings?: typeof loadSettings;
  loadExtensions?: typeof loadExtensions;
  createTask?: typeof Task.create;
}

export class CoderAgentExecutor implements AgentExecutor {
  private tasks: Map<string, TaskWrapper> = new Map();
  // Track tasks with an active execution loop.
  private executingTasks = new Set<string>();

  constructor(
    private taskStore?: TaskStore,
    private readonly dependencies: CoderAgentExecutorDependencies = {},
  ) {}

  /**
   * Builds the public Agent for a task from declarative interface input
   * (env, settings, extensions). No runtime assembly happens here — the
   * Agent owns Config construction, wiring, and activation (#3221).
   */
  async #createTaskAgent(
    agentSettings: AgentSettings,
    taskId: string,
  ): Promise<Agent> {
    const workspaceRoot = (this.dependencies.setTargetDir ?? setTargetDir)(
      agentSettings,
    );
    (this.dependencies.loadEnvironment ?? loadEnvironment)();
    const settings = (this.dependencies.loadSettings ?? loadSettings)(
      workspaceRoot,
    );
    const extensions = (this.dependencies.loadExtensions ?? loadExtensions)(
      workspaceRoot,
      { folderTrust: settings.folderTrust },
    );
    return (this.dependencies.createTaskAgent ?? createTaskAgent)(
      settings,
      extensions,
      taskId,
    );
  }

  /**
   * Reconstructs TaskWrapper from SDKTask.
   */
  async reconstruct(
    sdkTask: SDKTask,
    eventBus?: ExecutionEventBus,
  ): Promise<TaskWrapper> {
    const metadata = sdkTask.metadata ?? {};
    const persistedState = getPersistedState(metadata);

    if (!persistedState) {
      throw new Error(
        `Cannot reconstruct task ${sdkTask.id}: missing persisted state in metadata.`,
      );
    }

    const agentSettings = persistedState._agentSettings;
    const agent = await this.#createTaskAgent(agentSettings, sdkTask.id);
    const contextId = (metadata['_contextId'] as string) || sdkTask.contextId;
    const runtimeTask = await (this.dependencies.createTask ?? Task.create)(
      sdkTask.id,
      contextId,
      agent,
      eventBus,
      agentSettings.autoExecute,
    );
    runtimeTask.taskState = persistedState._taskState;

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
    const agentSettings = agentSettingsInput ?? ({} as AgentSettings);
    const agent = await this.#createTaskAgent(agentSettings, taskId);
    const runtimeTask = await (this.dependencies.createTask ?? Task.create)(
      taskId,
      contextId,
      agent,
      eventBus,
      agentSettings.autoExecute,
    );

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
      // Aborts the active Agent turn; pending tool cancellation is owned by
      // the agent loop.
      task.cancelTurn();

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

  /**
   * Processes one user turn against the public Agent stream.
   *
   * The Agent owns the full turn — LLM streaming, tool scheduling, tool
   * result feedback, and retries — and emits public AgentEvents. This loop
   * only maps them onto the a2a protocol.
   *
   * Publication semantics preserved from the legacy loop: model content is
   * buffered per attempt and published only at commit points (a tool call
   * commits the attempt, the end of the stream commits the turn) because the
   * event bus has no retraction primitive; a Retry clears the buffer to drop
   * abandoned partial output; an abort throws before publication,
   * intentionally discarding buffered partial output for the same reason.
   */
  async #processAgentTurnLoop(
    task: Task,
    requestContext: RequestContext,
    abortSignal: AbortSignal,
  ): Promise<void> {
    logger.info(`[CoderAgentExecutor] Task ${task.id}: Processing user turn.`);
    const agentEvents: AsyncGenerator<AgentEvent, void, unknown> =
      task.acceptUserMessage(requestContext, abortSignal);

    const {
      buffer,
      flushBuffered,
      discardBuffered,
      publishWorkingOnce,
      publishedToolStatuses,
    } = this.#createTurnPublicationSequencer(task);
    publishWorkingOnce();

    for await (const event of agentEvents) {
      if (abortSignal.aborted) {
        logger.warn(
          `[CoderAgentExecutor] Task ${task.id}: Abort signal received during agent event processing.`,
        );
        throw new Error('Execution aborted');
      }
      const stopAtApprovalBoundary = this.#dispatchAgentEvent(task, event, {
        buffer,
        flushBuffered,
        discardBuffered,
        publishWorkingOnce,
        publishedToolStatuses,
      });
      if (stopAtApprovalBoundary) {
        return;
      }
    }

    throwIfAborted(abortSignal);

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

  /**
   * Maps one public AgentEvent onto a2a publications. Returns true when the
   * caller must end the request at an approval boundary.
   */
  #dispatchAgentEvent(
    task: Task,
    event: AgentEvent,
    sequencer: {
      buffer: (publish: () => void) => void;
      flushBuffered: () => void;
      discardBuffered: () => void;
      publishWorkingOnce: () => void;
      publishedToolStatuses: Set<string>;
    },
  ): boolean {
    switch (event.type) {
      case 'retry':
        logger.warn(
          `[CoderAgentExecutor] Task ${task.id}: Provider retry — discarding buffered partial output.`,
        );
        sequencer.discardBuffered();
        return false;
      case 'text':
        sequencer.buffer(() => task.sendTextContent(event.text));
        return false;
      case 'thinking':
        sequencer.buffer(() => task.sendThought(event.thought));
        return false;
      case 'tool-call':
        // A tool call commits the current attempt: publish buffered model
        // content, then mark the task working while the loop executes tools.
        sequencer.flushBuffered();
        sequencer.publishWorkingOnce();
        return false;
      case 'tool-confirmation':
      case 'tool-status':
        return this.#handleApprovalAndStatusEvent(
          task,
          event,
          sequencer.flushBuffered,
          sequencer.publishWorkingOnce,
          sequencer.publishedToolStatuses,
        );
      case 'model-info':
        task.handleModelInfo(event.info);
        return false;
      case 'idle-timeout':
      case 'invalid-stream':
      case 'error':
        sequencer.flushBuffered();
        this.#handleStreamSignal(task, event);
        return false;
      case 'done':
        sequencer.flushBuffered();
        if (event.reason === 'refusal') {
          task.sendTextContent(`\n\n[safety notice] ${REFUSAL_NOTICE_MESSAGE}`);
        }
        return false;
      default:
        // usage, compression, context-warning, citation, loop-detected,
        // notice, hook-blocked, tool-result: informational in the legacy
        // loop as well; log nothing further.
        return false;
    }
  }

  /**
   * Builds the per-turn publication sequencer: model content is buffered per
   * attempt and published only at commit points (a tool call commits the
   * attempt, the end of the stream commits the turn) because the event bus
   * has no retraction primitive. A retry discards the buffer to drop
   * abandoned partial output.
   */
  #createTurnPublicationSequencer(task: Task): {
    buffer: (publish: () => void) => void;
    flushBuffered: () => void;
    discardBuffered: () => void;
    publishWorkingOnce: () => void;
    publishedToolStatuses: Set<string>;
  } {
    const bufferedPublications: Array<() => void> = [];
    const buffer = (publish: () => void): void => {
      bufferedPublications.push(publish);
    };
    const flushBuffered = (): void => {
      for (const publish of bufferedPublications) {
        publish();
      }
      bufferedPublications.length = 0;
    };
    const discardBuffered = (): void => {
      bufferedPublications.length = 0;
    };
    // Legacy parity: the turn opens with a 'working' state change; tool
    // scheduling re-asserts it only if it was never published.
    let workingPublished = false;
    const publishWorkingOnce = (): void => {
      if (!workingPublished) {
        task.setTaskStateAndPublishUpdate('working', {
          kind: CoderAgentEvent.StateChangeEvent,
        });
        workingPublished = true;
      }
    };
    // Tool status transitions published by this request; replays of an
    // already-published (id, status) pair are dropped.
    const publishedToolStatuses = new Set<string>();
    return {
      buffer,
      flushBuffered,
      discardBuffered,
      publishWorkingOnce,
      publishedToolStatuses,
    };
  }

  /**
   * Handles the approval- and status-relevant agent events. Returns true when
   * the caller must end the request at an approval boundary.
   */
  #handleApprovalAndStatusEvent(
    task: Task,
    event:
      | Extract<AgentEvent, { type: 'tool-confirmation' }>
      | Extract<AgentEvent, { type: 'tool-status' }>,
    flushBuffered: () => void,
    publishWorkingOnce: () => void,
    publishedToolStatuses: Set<string>,
  ): boolean {
    if (event.type === 'tool-confirmation') {
      flushBuffered();
      publishWorkingOnce();
      const confirmation = event.confirmation;
      // Stale replay guard: while a paused turn resumes, the scheduler's
      // awaiting_approval snapshot can re-emit confirmations for calls
      // this task already resolved. They are not new approval requests.
      if (task.isToolCallResolved(confirmation.toolCallId)) {
        return false;
      }
      if (task.shouldAutoApproveToolCalls()) {
        task.autoApproveConfirmation(confirmation);
        return false;
      }
      task.recordPendingConfirmation(confirmation);
      task.publishToolUpdate({
        id: confirmation.toolCallId,
        name: confirmation.name,
        status: 'awaiting-approval',
        output: confirmation.details,
      });
      task.setTaskStateAndPublishUpdate(
        'input-required',
        { kind: CoderAgentEvent.StateChangeEvent },
        undefined,
        undefined,
        true,
      );
      // End THIS request at the approval boundary (legacy parity: the
      // awaiting response closes after the final input-required). The
      // Task retains the paused agent stream; the confirming request
      // resumes it and receives the continuation events on its own bus.
      return true;
    }

    const update = event.update;
    // Facade contract: only incremental chunks (projectToolOutput) and
    // final-result echoes project with an empty name; real status
    // transitions always carry the tool name. Chunks append to the output
    // artifact; the echo needs nothing — the terminal named status event
    // carries the result (legacy published only chunks here).
    if (update.name === '') {
      if (update.status === 'executing' && typeof update.output === 'string') {
        task.publishToolOutput(update.id, update.output);
      }
      return false;
    }
    if (update.status === 'executing') {
      publishWorkingOnce();
    }
    // The tool-confirmation case is the authoritative awaiting-approval
    // publication (it carries the confirmation details); skip the
    // scheduler's duplicate status projection.
    if (update.status === 'awaiting-approval') {
      return false;
    }
    // Status transitions move forward; a repeat (id, status) pair is a
    // scheduler snapshot replay of an already-published transition.
    const statusKey = `${update.id}:${update.status}`;
    if (publishedToolStatuses.has(statusKey)) {
      return false;
    }
    publishedToolStatuses.add(statusKey);
    task.publishToolUpdate(update);
    return false;
  }

  /** Publishes the terminal degraded-stream signals onto the task. */
  #handleStreamSignal(
    task: Task,
    event:
      | Extract<AgentEvent, { type: 'idle-timeout' }>
      | Extract<AgentEvent, { type: 'invalid-stream' }>
      | Extract<AgentEvent, { type: 'error' }>,
  ): void {
    if (event.type === 'idle-timeout') {
      task.handleStreamIdleTimeout(event.error, {
        kind: CoderAgentEvent.StateChangeEvent,
      });
      return;
    }
    if (event.type === 'invalid-stream') {
      task.handleInvalidStream({
        kind: CoderAgentEvent.StateChangeEvent,
      });
      return;
    }
    task.handleStreamError(event.error, {
      kind: CoderAgentEvent.StateChangeEvent,
    });
  }

  #handleExecutionError(
    task: Task,
    abortSignal: AbortSignal,
    error: unknown,
  ): void {
    // Legacy parity: both error branches first cancel whatever the turn
    // still has pending (confirmations/streams) — the modern equivalent of
    // the legacy cancelPendingTools calls.
    task.cancelTurn();
    if (abortSignal.aborted) {
      logger.warn(`[CoderAgentExecutor] Task ${task.id} execution aborted.`);
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

    const taskId = sdkTask?.id ?? userMessage.taskId ?? uuidv4();
    const contextId: string =
      userMessage.contextId ??
      sdkTask?.contextId ??
      (sdkTask?.metadata?.['_contextId'] as string | undefined) ??
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

      for await (const _event of currentTask.acceptUserMessage(
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
