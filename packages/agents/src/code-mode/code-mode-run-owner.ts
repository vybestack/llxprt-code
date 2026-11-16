/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Owns one `execute_tool_script` invocation (issue #4084): the QuickJS run,
 * a FIFO broker that serializes the script's nested calls, and a nested tool
 * execution owner of its own. Nested calls go through a fresh scheduler built
 * from the caller's composition (selection, policy, hooks, approval handler,
 * interactive mode); the parent scheduler, busy running this invocation, is
 * never reentered.
 *
 * Lifecycle: the runtime joins every invoke callback before it settles; each
 * callback settles once its call's signal aborts. Closing the owner closes
 * admission, cancels queued calls, cancels and joins in-flight executions,
 * and retires the approval subscription, so a late approval reply finds
 * nothing to resolve.
 *
 * Presentation (Phase D): the nested scheduler's call updates, live output
 * and completions go to an execution opened on the session's child display,
 * so a host that renders child calls (the CLI) shows a waiting nested call
 * with the ordinary confirmation prompt. A nested call may wait for approval
 * only when that display or the session's approval handler can answer it;
 * otherwise an ASK ends the run with APPROVAL_REQUIRED at once. Each run
 * also writes `tool_script_event` records and lifecycle telemetry through
 * its {@link ScriptRunJournal}.
 */

import { randomUUID } from 'node:crypto';
import type {
  ToolScriptApproval,
  ToolScriptEventPayload,
} from '@vybestack/llxprt-code-core';
import type { ToolCallRequestInfo } from '@vybestack/llxprt-code-core/core/turn.js';
import type {
  CompletedToolCall,
  ToolCall,
} from '@vybestack/llxprt-code-core/scheduler/types.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { AgentDisplayCallbacks } from '../api/agent.js';
import type {
  ToolExecutionScope,
  ToolResult,
} from '@vybestack/llxprt-code-tools';
import type {
  NestedExecutionPort,
  ToolResultDelivery,
} from '../scheduler/nested-execution.js';
import type { SchedulerLease } from '../session/sessionSchedulerOwner.js';
import { TurnToolExecutionOwner } from '../session/turn-tool-execution-owner.js';
import {
  CANCELLED_RESULT,
  classifyNestedCall,
  type NestedCallStatus,
} from './nested-call-outcome.js';
import type {
  CodeModeRuntime,
  ScriptCall,
  ScriptRunRequest,
  ScriptToolResult,
} from './runtime-contract.js';
import { ScriptRunJournal } from './script-run-journal.js';
import {
  fitModelOutputBudget,
  type CodeModeRunReport,
  type NestedCallRecord,
} from './script-result-envelope.js';
import type { ToolScriptRunView } from './tool-script-card.js';

const logger = new DebugLogger('llxprt:agents:code-mode');

/**
 * Where a run shows its nested calls and publishes its records: the
 * session's child display (`ChildToolDisplay` satisfies it).
 */
export interface ScriptRunDisplay {
  open(): AgentDisplayCallbacks;
  answersApprovals(): boolean;
  publishToolScriptEvent(event: ToolScriptEventPayload): void;
}

interface QueuedCall {
  readonly call: ScriptCall;
  readonly resolve: (result: ScriptToolResult) => void;
  readonly reject: (reason: unknown) => void;
}

export interface CodeModeRunOptions {
  readonly runtime: CodeModeRuntime;
  readonly request: ScriptRunRequest;
  readonly scope: ToolExecutionScope;
  readonly port: NestedExecutionPort;
  /** Absent where no session display is bound (records are not kept). */
  readonly display?: ScriptRunDisplay;
  /** Receives the run's folded view after every record (the live card). */
  readonly onProgress?: (view: ToolScriptRunView) => void;
}

function approvalOf(
  done: CompletedToolCall,
  status: NestedCallStatus,
  awaited: boolean,
): ToolScriptApproval {
  if (status === 'approval_required') return 'unavailable';
  if (!awaited) return 'not_required';
  return done.status === 'success' || done.status === 'error'
    ? 'approved'
    : 'denied';
}

export class CodeModeRunOwner {
  readonly runId = randomUUID();
  private readonly queue: QueuedCall[] = [];
  private readonly completions = new Map<
    string,
    (call: CompletedToolCall) => void
  >();
  private readonly delivered = new Map<string, ToolResult>();
  private readonly admitted = new Set<string>();
  private readonly awaited = new Set<string>();
  private readonly records: NestedCallRecord[] = [];
  private readonly tools: TurnToolExecutionOwner;
  private readonly journal: ScriptRunJournal;
  private lease: SchedulerLease | undefined;
  private releaseApprovals: (() => void) | undefined;
  private pumping = false;
  private partial = false;
  private closing: Promise<void> | undefined;
  private started = false;

  constructor(private readonly options: CodeModeRunOptions) {
    const { composition } = options.port;
    const { display } = options;
    const promptsAvailable =
      composition.approval !== undefined ||
      display?.answersApprovals() === true;
    this.tools = new TurnToolExecutionOwner(
      composition.messageBus,
      composition.approval,
      (callbacks) =>
        composition.createScheduler(
          {
            ...callbacks,
            onToolResult: (delivery) => this.onDelivered(delivery),
          },
          { promptsAvailable },
        ),
    );
    this.journal = new ScriptRunJournal(
      {
        runId: this.runId,
        parentCallId: options.scope.callId,
        promptId: options.scope.promptId,
        agentId: options.scope.agentId,
        purpose: options.request.purpose,
        tools: options.request.tools,
      },
      {
        publish: (event) => display?.publishToolScriptEvent(event),
        progress: (view) => options.onProgress?.(view),
        logRun: (event) => composition.logScriptRun(event),
      },
    );
  }

  async run(signal: AbortSignal): Promise<CodeModeRunReport> {
    if (this.started) throw new Error('A code mode run owner runs once');
    this.started = true;
    this.journal.started();
    this.releaseApprovals = this.tools.begin();
    const view = this.options.display?.open();
    this.lease = this.tools.acquire({
      onAllToolCallsComplete: async (calls) => {
        this.onCompleted(calls);
        notifyCompletion(view, calls);
      },
      onToolCallsUpdate: (calls) => {
        this.observe(calls);
        view?.onToolCallsUpdate?.(calls);
      },
      outputUpdateHandler: (callId, update) =>
        view?.outputUpdateHandler?.(callId, update),
      getPreferredEditor: () => undefined,
      onEditorClose: () => undefined,
    });
    const closeOnAbort = (): void => void this.close();
    signal.addEventListener('abort', closeOnAbort, { once: true });
    try {
      const result = await this.options.runtime.run(
        this.options.request,
        (call) => this.enqueue(call),
        signal,
      );
      await this.close();
      const report = fitModelOutputBudget(
        { result, completedCalls: [...this.records], partial: this.partial },
        this.options.scope.modelOutputLimit,
      );
      this.journal.finished(report.result, report.partial);
      return report;
    } finally {
      signal.removeEventListener('abort', closeOnAbort);
      await this.close();
    }
  }

  /**
   * Closes admission, cancels queued calls, cancels and joins in-flight
   * nested executions, then retires the approval subscription.
   */
  close(): Promise<void> {
    this.closing ??= (async () => {
      for (const queued of this.queue.splice(0))
        queued.resolve(CANCELLED_RESULT);
      try {
        await this.lease?.release();
      } finally {
        this.releaseApprovals?.();
        this.tools.retire();
      }
    })();
    return this.closing;
  }

  private enqueue(call: ScriptCall): Promise<ScriptToolResult> {
    if (this.closing !== undefined || call.signal.aborted)
      return Promise.resolve(CANCELLED_RESULT);
    return new Promise<ScriptToolResult>((resolve, reject) => {
      const entry: QueuedCall = { call, resolve, reject };
      this.queue.push(entry);
      call.signal.addEventListener(
        'abort',
        () => {
          const index = this.queue.indexOf(entry);
          if (index >= 0) {
            this.queue.splice(index, 1);
            resolve(CANCELLED_RESULT);
          } else void this.close();
        },
        { once: true },
      );
      void this.pump();
    });
  }

  /** Runs queued calls one at a time, in the order the script made them. */
  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (
        let next = this.queue.shift();
        next !== undefined;
        next = this.queue.shift()
      ) {
        await this.execute(next.call).then(next.resolve, next.reject);
      }
    } finally {
      this.pumping = false;
    }
  }

  private async execute(call: ScriptCall): Promise<ScriptToolResult> {
    const lease = this.lease;
    if (lease === undefined || this.closing !== undefined)
      return CANCELLED_RESULT;
    const request = this.nestedRequest(call);
    const completion = new Promise<CompletedToolCall>((resolve) => {
      this.completions.set(request.callId, resolve);
    });
    try {
      await lease.schedule(request, call.signal, this.options.port.hookOwner);
    } catch (error) {
      if (!call.signal.aborted) throw error;
    }
    if (call.signal.aborted && !this.admitted.has(request.callId)) {
      this.completions.delete(request.callId);
      await this.close();
      return CANCELLED_RESULT;
    }
    if (!this.admitted.has(request.callId))
      throw new Error(
        `The scheduler did not admit nested call ${request.callId}.`,
      );
    return this.settle(call, await completion);
  }

  private async settle(
    call: ScriptCall,
    done: CompletedToolCall,
  ): Promise<ScriptToolResult> {
    const delivered = this.delivered.get(done.request.callId);
    this.delivered.delete(done.request.callId);
    const aborted = call.signal.aborted;
    if (aborted) await this.close();
    const outcome = classifyNestedCall(done, delivered, aborted);
    this.records.push({ tool: call.tool, status: outcome.status });
    this.journal.call({
      sequence: call.requestId,
      callId: done.request.callId,
      tool: call.tool,
      args: call.args,
      approval: approvalOf(
        done,
        outcome.status,
        this.awaited.has(done.request.callId),
      ),
      status: outcome.status,
      result: outcome.kind === 'result' ? outcome.result : undefined,
    });
    if (outcome.kind === 'termination') throw outcome.termination;
    if (outcome.result.ok && outcome.result.completeness === 'partial')
      this.partial = true;
    return outcome.result;
  }

  private nestedRequest(call: ScriptCall): ToolCallRequestInfo {
    const { scope } = this.options;
    return {
      callId: `${scope.callId}#script-${this.runId.slice(0, 8)}-${call.requestId}`,
      name: call.tool,
      args: structuredClone(call.args) as Record<string, unknown>,
      isClientInitiated: false,
      prompt_id: scope.promptId,
      agentId: scope.agentId,
      ...(scope.hookRestrictedAllowedTools === undefined
        ? {}
        : {
            hookRestrictedAllowedTools: [...scope.hookRestrictedAllowedTools],
          }),
      script: {
        parentCallId: scope.callId,
        runId: this.runId,
        purpose: this.options.request.purpose,
      },
    };
  }

  private observe(calls: readonly ToolCall[]): void {
    for (const call of calls) {
      this.admitted.add(call.request.callId);
      if (call.status === 'awaiting_approval')
        this.awaited.add(call.request.callId);
    }
  }

  private onDelivered(delivery: ToolResultDelivery): void {
    this.delivered.set(delivery.callId, delivery.result);
  }

  /**
   * The scheduler accepts a new batch only after this callback returns and
   * it leaves its finalizing state (queued requests are never drained), so
   * completions are handed to the broker on the next macrotask.
   */
  private onCompleted(calls: readonly CompletedToolCall[]): void {
    for (const call of calls) {
      const resolve = this.completions.get(call.request.callId);
      if (resolve === undefined) continue;
      this.completions.delete(call.request.callId);
      setImmediate(() => resolve(call));
    }
  }
}

/**
 * The display's completion handler is not awaited: the nested scheduler
 * accepts the run's next call only after its completion callback returns, so
 * a slow renderer must not hold the broker. A failure is logged, the same way
 * the agentic loop treats its display's completion callback.
 */
function notifyCompletion(
  view: AgentDisplayCallbacks | undefined,
  calls: CompletedToolCall[],
): void {
  const pending = view?.onAllToolCallsComplete?.(calls);
  if (pending === undefined) return;
  void Promise.resolve(pending).catch((error: unknown) => {
    logger.debug(
      () =>
        `script display completion failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
}
