/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Interactive tool scheduler capability.
 *
 * Encapsulates the construction and lifecycle of the CoreToolScheduler so that
 * React/UI code never references {@link ToolSchedulerContract},
 * {@link getOrCreateScheduler}, {@link ToolRegistry}, or the scheduler singleton
 * directly. The UI layer holds React display state (tracked tool calls, pending
 * history items) and feeds this capability swappable display hooks; the
 * capability owns the scheduler instance, the pending-request queue, agentId
 * normalization, and the interactive subagent-scheduler factory registration.
 *
 * Lifecycle choice (option (a) from the Phase 3 design):
 *   The capability is cheap to construct, but the underlying scheduler is
 *   ref-counted by the scheduler singleton (see
 *   packages/core/src/config/schedulerSingleton.ts). To preserve the existing
 *   per-React-mount create/dispose semantics, the capability lazily creates the
 *   scheduler when {@link InteractiveToolScheduler.attach} is called and
 *   disposes it (decrementing the ref count) when the returned detach function
 *   runs. {@link InteractiveToolScheduler.schedule} queues pending requests
 *   until the scheduler is ready, then flushes them in arrival order.
 */

import {
  type Config,
  type ToolCallRequestInfo,
  type CompletedToolCall,
  type EditorType,
  type ToolCall,
  type AnsiOutput,
  type MessageBus,
  type OutputUpdateHandler,
  type ToolCallsUpdateHandler,
  type SubagentSchedulerFactory,
  type ToolSchedulerContract,
  hasInteractiveSubagentScheduler,
  DEFAULT_AGENT_ID,
  DebugLogger,
} from '@vybestack/llxprt-code-core';

const logger = DebugLogger.getLogger('llxprt:cli:interactive-tool-scheduler');

/**
 * Narrow Config shape that exposes the scheduler-construction primitives. Only
 * this runtime module references it; UI code consumes
 * {@link InteractiveToolScheduler} instead.
 */
type SchedulerConfigWithExplicitMessageBus = Config & {
  getOrCreateScheduler(
    sessionId: string,
    callbacks: {
      outputUpdateHandler?: OutputUpdateHandler;
      onAllToolCallsComplete?: (
        calls: CompletedToolCall[],
      ) => Promise<void> | void;
      onToolCallsUpdate?: ToolCallsUpdateHandler;
      getPreferredEditor?: () => EditorType | undefined;
      onEditorClose?: () => void;
      onEditorOpen?: () => void;
    },
    options?: Record<string, unknown>,
    dependencies?: {
      messageBus?: MessageBus;
    },
  ): Promise<ToolSchedulerContract>;
};

type PendingScheduleRequests = Array<{
  request: ToolCallRequestInfo | ToolCallRequestInfo[];
  signal: AbortSignal;
}>;

/**
 * Display hooks the React layer provides so the capability can drive per-main-
 * scheduler React state. Mirrors the subset of the hook's SchedulerRefs that the
 * main scheduler callbacks need.
 */
export interface MainSchedulerDisplayHooks {
  outputUpdateHandler: (toolCallId: string, chunk: string | AnsiOutput) => void;
  onAllToolCallsComplete: (
    completedToolCalls: CompletedToolCall[],
  ) => Promise<void> | void;
  onToolCallsUpdate: (calls: ToolCall[]) => void;
  getPreferredEditor: () => EditorType | undefined;
  onEditorClose: () => void;
  onEditorOpen: () => void;
  setLastToolOutputTime: (time: number) => void;
  /** Returns false once the owning React component has unmounted. */
  isMounted: () => boolean;
}

/**
 * Display hooks for per-subagent-scheduler React state. The capability binds a
 * fresh symbol per subagent scheduler and routes display updates through these.
 */
export interface SubagentDisplayHooks {
  updateToolCallOutput: (
    schedulerId: symbol,
    toolCallId: string,
    chunk: string | AnsiOutput,
  ) => void;
  replaceToolCalls: (schedulerId: symbol, calls: ToolCall[]) => void;
  onComplete: (
    schedulerId: symbol,
    tools: CompletedToolCall[],
    options: { isPrimary: boolean },
  ) => Promise<void> | void;
  getPreferredEditor: () => EditorType | undefined;
  onEditorClose: () => void;
  onEditorOpen: () => void;
  setLastToolOutputTime: (time: number) => void;
}

/**
 * Result of {@link InteractiveToolScheduler.attach}. Calling it disposes the
 * scheduler (decrementing the singleton ref count) and de-registers the
 * subagent factory, mirroring the prior useEffect-cleanup behavior.
 */
export type DetachScheduler = () => void;

/**
 * Interactive tool scheduler capability. UI code interacts only through this
 * interface; the scheduler-construction primitives stay encapsulated.
 */
export interface InteractiveToolScheduler {
  /**
   * Lazily creates the underlying scheduler (ref-counted via the singleton),
   * registers the interactive subagent scheduler factory, flushes any queued
   * pending requests, and returns a detach function that disposes everything.
   * Safe to call once per capability instance (per React mount).
   */
  attach(
    mainHooks: MainSchedulerDisplayHooks,
    subagentHooks: SubagentDisplayHooks,
  ): Promise<DetachScheduler>;

  /**
   * Schedules a tool call request (or array). Normalizes agentId to
   * {@link DEFAULT_AGENT_ID}. Queues the request until the scheduler is ready,
   * preserving arrival order, then delegates to the scheduler. Swallows
   * scheduling rejections (matches prior behavior).
   */
  schedule(
    request: ToolCallRequestInfo | ToolCallRequestInfo[],
    signal: AbortSignal,
  ): Promise<void>;

  /** Cancels all in-flight tool calls on the main scheduler, if ready. */
  cancelAll(): void;

  /** True once the scheduler is ready AND the subagent factory is registered. */
  isReady(): boolean;
}

/**
 * Ensures a request has an agentId, defaulting to {@link DEFAULT_AGENT_ID}.
 */
function ensureAgentId(req: ToolCallRequestInfo): ToolCallRequestInfo {
  return { ...req, agentId: req.agentId ?? DEFAULT_AGENT_ID };
}

/**
 * Normalizes a request to ensure all requests have agentId.
 */
function normalizeRequest(
  request: ToolCallRequestInfo | ToolCallRequestInfo[],
): ToolCallRequestInfo | ToolCallRequestInfo[] {
  return Array.isArray(request)
    ? request.map(ensureAgentId)
    : ensureAgentId(request);
}

/**
 * Flushes queued pending requests against a ready scheduler instance.
 */
function processPendingRequests(
  instance: ToolSchedulerContract,
  requests: PendingScheduleRequests,
): void {
  for (const { request, signal } of requests) {
    if (signal.aborted) continue;
    instance.schedule(request, signal).catch(() => {});
  }
}

/**
 * Factory: creates a new {@link InteractiveToolScheduler} bound to the given
 * config and runtime message bus. Does not construct the scheduler eagerly —
 * that happens on {@link InteractiveToolScheduler.attach}.
 */
export function createInteractiveToolScheduler(
  config: Config,
  runtimeMessageBus: MessageBus | undefined,
): InteractiveToolScheduler {
  return new InteractiveToolSchedulerImpl(config, runtimeMessageBus);
}

class InteractiveToolSchedulerImpl implements InteractiveToolScheduler {
  private readonly schedulerConfig: SchedulerConfigWithExplicitMessageBus;
  private readonly sessionId: string;
  private scheduler: ToolSchedulerContract | null = null;
  private readonly pendingRequests: PendingScheduleRequests = [];
  private externalSchedulerRegistered = false;

  constructor(
    private readonly config: Config,
    private readonly runtimeMessageBus: MessageBus | undefined,
  ) {
    this.schedulerConfig = config as SchedulerConfigWithExplicitMessageBus;
    this.sessionId = config.getSessionId();
  }

  async attach(
    mainHooks: MainSchedulerDisplayHooks,
    subagentHooks: SubagentDisplayHooks,
  ): Promise<DetachScheduler> {
    this.registerSubagentFactory(subagentHooks);

    const instance = await this.createMainScheduler(mainHooks);

    // If the component unmounted during async creation, dispose and bail.
    // Clear pending requests so stale entries don't fire on a later attach.
    if (!mainHooks.isMounted()) {
      if (instance) {
        this.config.disposeScheduler(this.sessionId);
      }
      this.deregisterSubagentFactory();
      this.pendingRequests.length = 0;
      return () => {};
    }

    if (instance) {
      this.scheduler = instance;
      processPendingRequests(instance, this.pendingRequests);
      this.pendingRequests.length = 0;
    } else {
      // Creation failed (createMainScheduler returned null). Clear pending
      // requests so they don't fire on a later attach.
      this.pendingRequests.length = 0;
    }

    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      this.deregisterSubagentFactory();
      this.pendingRequests.length = 0;
      if (this.scheduler) {
        this.config.disposeScheduler(this.sessionId);
        this.scheduler = null;
      }
    };
  }

  schedule(
    request: ToolCallRequestInfo | ToolCallRequestInfo[],
    signal: AbortSignal,
  ): Promise<void> {
    const normalizedRequest = normalizeRequest(request);
    if (!this.scheduler) {
      this.pendingRequests.push({ request: normalizedRequest, signal });
      return Promise.resolve();
    }
    return this.scheduler.schedule(normalizedRequest, signal).catch(() => {});
  }

  cancelAll(): void {
    this.scheduler?.cancelAll();
  }

  isReady(): boolean {
    return this.scheduler !== null && this.externalSchedulerRegistered;
  }

  private registerSubagentFactory(hooks: SubagentDisplayHooks): void {
    if (!hasInteractiveSubagentScheduler(this.config)) {
      this.externalSchedulerRegistered = true;
      return;
    }
    const factory = this.createSubagentFactory(hooks);
    this.config.setInteractiveSubagentSchedulerFactory(factory);
    this.externalSchedulerRegistered = true;
  }

  private deregisterSubagentFactory(): void {
    this.externalSchedulerRegistered = false;
    if (!hasInteractiveSubagentScheduler(this.config)) return;
    this.config.setInteractiveSubagentSchedulerFactory(undefined);
  }

  private createSubagentFactory(
    hooks: SubagentDisplayHooks,
  ): SubagentSchedulerFactory {
    return (args) => {
      const schedulerId = Symbol('subagent-scheduler');
      const schedulerSessionId = args.schedulerConfig.getSessionId();
      const subagentConfig =
        args.schedulerConfig as SchedulerConfigWithExplicitMessageBus;
      const callbacks = {
        outputUpdateHandler: (
          toolCallId: string,
          chunk: string | AnsiOutput,
        ) => {
          hooks.updateToolCallOutput(schedulerId, toolCallId, chunk);
          hooks.setLastToolOutputTime(Date.now());
        },
        onToolCallsUpdate: (calls: ToolCall[]) => {
          hooks.replaceToolCalls(schedulerId, calls);
          args.onToolCallsUpdate?.(calls);
        },
        onAllToolCallsComplete: async (calls: CompletedToolCall[]) => {
          if (calls.length > 0) {
            await hooks.onComplete(schedulerId, calls, { isPrimary: false });
            await args.onAllToolCallsComplete(calls);
          }
          hooks.replaceToolCalls(schedulerId, []);
        },
        getPreferredEditor: () => hooks.getPreferredEditor(),
        onEditorClose: () => hooks.onEditorClose(),
        onEditorOpen: () => hooks.onEditorOpen(),
      };
      const instanceP = subagentConfig.getOrCreateScheduler(
        schedulerSessionId,
        callbacks,
        undefined,
        { messageBus: this.runtimeMessageBus },
      );
      return Promise.resolve(instanceP).then((instance) => ({
        schedule: (
          req: ToolCallRequestInfo | ToolCallRequestInfo[],
          signal: AbortSignal,
        ) => instance.schedule(req, signal),
        dispose: () =>
          args.schedulerConfig.disposeScheduler(schedulerSessionId),
      }));
    };
  }

  private async createMainScheduler(
    hooks: MainSchedulerDisplayHooks,
  ): Promise<ToolSchedulerContract | null> {
    try {
      const callbacks = {
        outputUpdateHandler: (
          toolCallId: string,
          chunk: string | AnsiOutput,
        ) => {
          if (!hooks.isMounted()) return;
          hooks.outputUpdateHandler(toolCallId, chunk);
        },
        onAllToolCallsComplete: async (
          completedToolCalls: CompletedToolCall[],
        ) => {
          if (!hooks.isMounted()) return;
          await hooks.onAllToolCallsComplete(completedToolCalls);
        },
        onToolCallsUpdate: (calls: ToolCall[]) => {
          if (!hooks.isMounted()) return;
          hooks.onToolCallsUpdate(calls);
        },
        getPreferredEditor: () => hooks.getPreferredEditor(),
        onEditorClose: () => hooks.onEditorClose(),
        onEditorOpen: () => hooks.onEditorOpen(),
      };
      return await this.schedulerConfig.getOrCreateScheduler(
        this.sessionId,
        callbacks,
        undefined,
        { messageBus: this.runtimeMessageBus },
      );
    } catch (error) {
      logger.warn(
        () =>
          `Failed to initialize scheduler: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
      return null;
    }
  }
}
