/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Slice E interface contracts (issue #2615, PR 1). Types only: no behavior
 * and no construction change. Consumers receive these ports injected; the
 * implementations stay where they are and never import these names.
 * Every member traces to an existing consumer call site; members with no
 * consumer do not belong here.
 */

import type {
  ConfirmationOutcome,
  ConfirmationPayload,
  PolicyFunctionCall,
} from '@vybestack/llxprt-code-policy';
import type { ToolSchedulerContract } from '../core/toolSchedulerContract.js';
import type { OutputObject } from '../core/subagentTypes.js';
import type {
  MessageBusMessage,
  MessageBusType,
} from '../confirmation-bus/types.js';
import type { IContent } from '../services/history/IContent.js';
import type {
  AsyncTaskInfo,
  RegisterTaskInput,
} from '../services/asyncTaskManager.js';
import type {
  ShellJob,
  ShellJobLaunchInput,
  ShellJobPrefixLookup,
  ShellJobTailOptions,
  ShellJobTailResult,
} from '../services/shellJobManager.js';

/**
 * Per-session tool scheduling surface: run tool call requests, cancel
 * in-flight calls, and hand the scheduler back when the session releases
 * it. Exactly the operations existing scheduler consumers use.
 */
export type SchedulerHandle = Pick<
  ToolSchedulerContract,
  'schedule' | 'cancelAll' | 'setCallbacks' | 'dispose'
>;

/**
 * Async task ownership surface: reserve a slot, register, settle, and
 * query background tasks. Slot reservation is the atomic
 * reserve-then-register pair; terminal settles are idempotent.
 */
export interface TaskPort {
  canLaunchAsync(): { allowed: boolean; reason?: string };
  tryReserveAsyncSlot(): string | null;
  cancelReservation(bookingId: string): boolean;
  registerTask(input: RegisterTaskInput, bookingId?: string): AsyncTaskInfo;
  completeTask(id: string, output: OutputObject): boolean;
  failTask(id: string, error: string): boolean;
  cancelTask(id: string): boolean;
  getTask(id: string): AsyncTaskInfo | undefined;
  getTaskByPrefix(prefix: string): {
    task?: AsyncTaskInfo;
    candidates?: AsyncTaskInfo[];
  };
  getAllTasks(): AsyncTaskInfo[];
  getRunningTasks(): AsyncTaskInfo[];
}

/**
 * Background shell job surface: launch, inspect, tail, and cancel jobs.
 */
export interface ShellJobPort {
  launch(input: ShellJobLaunchInput): ShellJob;
  cancel(id: string): Promise<boolean>;
  get(id: string): ShellJob | undefined;
  getByPrefix(prefix: string): ShellJobPrefixLookup;
  list(): ShellJob[];
  getRunningJobs(): ShellJob[];
  tailOutput(
    id: string,
    options?: Partial<ShellJobTailOptions>,
  ): ShellJobTailResult;
}

/**
 * Shared session approval bus surface. Binding constraint (#2320): requests
 * carry the invocation identity (toolCall.id) and the owning agent, and
 * responses route by correlationId to that agent's pending wait; the
 * implicit bus fallback stays dead. No member may reintroduce global or
 * label-keyed bus lookup. respondToConfirmation's requiresUserConfirmation
 * flag re-surfaces decisions to the bus consumer.
 */
export interface ApprovalBusPort {
  publish(message: MessageBusMessage): void;
  subscribe<T extends MessageBusMessage>(
    type: MessageBusType,
    handler: (message: T) => void,
  ): () => void;
  requestConfirmation(
    toolCall: PolicyFunctionCall,
    args: Record<string, unknown>,
    serverName?: string,
  ): Promise<boolean>;
  respondToConfirmation(
    correlationId: string,
    outcome: ConfirmationOutcome,
    payload?: ConfirmationPayload,
    requiresUserConfirmation?: boolean,
  ): void;
}

/**
 * Session recording surface: record content events, flush pending writes,
 * and answer the queries recording consumers make on session shutdown and
 * resume.
 */
export interface RecordingPort {
  isActive(): boolean;
  getFilePath(): string | null;
  getSessionId(): string;
  getChatsDir(): string;
  getProjectHash(): string;
  getPendingByteCount(): number;
  flush(): Promise<void>;
  dispose(): Promise<void>;
  recordContent(content: IContent): void;
  recordSemanticMediaPurge(
    history: readonly IContent[],
    frontier: { readonly contentIndex: number; readonly blockIndex: number },
  ): void;
  recordSessionMetadata(title: string | null): void;
  getSessionMetadataTitle(): string | null | undefined;
}

/**
 * Port for the loop, task tool, tasks control, non-interactive execution,
 * and subagent setup. Exactly five members, no member wider than one
 * capability; split the port rather than widen it.
 */
export interface SessionExecutionServices {
  readonly scheduler: SchedulerHandle;
  readonly tasks: TaskPort;
  readonly shellJobs: ShellJobPort;
  readonly approvals: ApprovalBusPort;
  readonly recording: RecordingPort;
}
