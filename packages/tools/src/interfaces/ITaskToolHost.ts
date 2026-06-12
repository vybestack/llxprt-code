/**
 * @plan:PLAN-20260608-ISSUE1585.P11
 * @requirement:REQ-INTERFACE-OWNERSHIP
 */

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tools-owned interface for task tool host dependencies.
 *
 * Encapsulates all behaviors that task tool needs from core
 * (orchestration, governance, async tasks, scheduler, tool registry,
 * settings, timeout) behind adapter interfaces.
 *
 * Historical task-host contract retained for compatibility with earlier P11 plans.
 * Current task execution uses ISubagentService, implemented by
 * CoreSubagentServiceAdapter in packages/core.
 */

/** Information about a launched subagent. */
export interface LaunchedSubagent {
  /** Unique agent identifier. */
  agentId: string;
  /** The subagent scope for interaction. */
  scope: ISubagentScope;
  /** Cleanup function. */
  dispose: () => Promise<void>;
}

/** Subagent scope interface for interaction. */
export interface ISubagentScope {
  /** Output from subagent execution. */
  output: ISubagentOutput | undefined;
  /** Message handler for streaming. */
  onMessage: ((message: string) => void) | undefined;
  /** Run the subagent interactively. */
  runInteractive(
    contextState: unknown,
    options?: { schedulerFactory?: unknown },
  ): Promise<void>;
  /** Run the subagent non-interactively. */
  runNonInteractive(contextState: unknown): Promise<void>;
  /** Cancel the subagent. */
  cancel?(reason?: string): void;
}

/** Output from subagent execution. */
export interface ISubagentOutput {
  /** Reason for termination. */
  terminate_reason: string;
  /** Emitted variables from the subagent. */
  emitted_vars: Record<string, unknown>;
  /** Final message from the subagent. */
  final_message?: string;
}

/** Launch request for a subagent. */
export interface TaskLaunchRequest {
  /** Name of the subagent. */
  name: string;
  /** Run configuration. */
  runConfig?: { max_time_minutes?: number };
  /** Behaviour prompts. */
  behaviourPrompts?: string[];
  /** Tool configuration. */
  toolConfig?: { tools: string[] };
  /** Output configuration. */
  outputConfig?: { outputs: Record<string, string> };
}

/** Timeout configuration for task execution. */
export interface TaskTimeoutConfig {
  /** Resolved timeout in seconds, undefined for no timeout. */
  timeoutSeconds: number | undefined;
  /** Default timeout in seconds. */
  defaultTimeoutSeconds: number;
}

/** Result of async settings check. */
export interface AsyncSettingsCheck {
  /** Whether async is enabled. */
  enabled: boolean;
  /** Reason if disabled. */
  reason?: string;
}

/** Async slot reservation result. */
export interface AsyncSlotResult {
  /** Reservation ID if slot was obtained. */
  bookingId: string | undefined;
}

/** Async task registration input. */
export interface AsyncTaskRegistration {
  id: string;
  subagentName: string;
  goalPrompt: string;
  abortController: AbortController;
}

/** Can-launch result for async tasks. */
export interface CanLaunchResult {
  /** Whether an async task can be launched. */
  reason?: string;
}

/** Governs tool access for the subagent. */
export interface IToolGovernance {
  /** Whether the given tool name is blocked. */
  isToolBlocked(canonicalName: string): boolean;
}

export interface ITaskToolHost {
  /**
   * Launch a subagent with the given request.
   */
  launchSubagent(
    request: TaskLaunchRequest,
    signal?: AbortSignal,
  ): Promise<LaunchedSubagent>;

  /**
   * Check if the environment is interactive.
   */
  isInteractiveEnvironment(): boolean;

  /**
   * Get the interactive subagent scheduler factory, if available.
   */
  getSchedulerFactory(): unknown | undefined;

  /**
   * Get timeout configuration for task execution.
   */
  getTimeoutConfig(
    requestedTimeoutSeconds: number | undefined,
  ): TaskTimeoutConfig;

  /**
   * Get async timeout configuration.
   */
  getAsyncTimeoutConfig(
    requestedTimeoutSeconds: number | undefined,
  ): TaskTimeoutConfig;

  /**
   * Check if async tasks are enabled in settings.
   */
  checkAsyncSettings(): AsyncSettingsCheck;

  /**
   * Check if async task manager is available.
   */
  hasAsyncTaskManager(): boolean;

  /**
   * Try to reserve an async slot.
   */
  tryReserveAsyncSlot(): string | undefined;

  /**
   * Register an async task.
   */
  registerAsyncTask(
    task: AsyncTaskRegistration,
    bookingId: string | undefined,
  ): void;

  /**
   * Cancel an async slot reservation.
   */
  cancelAsyncReservation(bookingId: string): void;

  /**
   * Check if an async task can be launched.
   */
  canLaunchAsync(): CanLaunchResult;

  /**
   * Get the session ID.
   */
  getSessionId(): string;

  /**
   * Build governed tool whitelist from candidates and registry.
   * Returns filtered list of tools that are allowed by governance.
   */
  buildGovernedToolWhitelist(
    candidateTools: string[] | undefined,
    hasExplicitWhitelist: boolean,
  ): string[] | undefined;

  /**
   * Get the default agent ID.
   */
  getDefaultAgentId(): string;

  /**
   * Complete an async task.
   */
  completeAsyncTask(agentId: string, output: ISubagentOutput): void;

  /**
   * Fail an async task.
   */
  failAsyncTask(agentId: string, error: string): void;

  /**
   * Get an async task by ID.
   */
  getAsyncTask(agentId: string): { status: string } | undefined;

  /**
   * Cancel async reservation on error.
   */
  cancelAsyncTaskReservation(
    bookingId: string | undefined,
    taskRegistered: boolean,
  ): void;
}
