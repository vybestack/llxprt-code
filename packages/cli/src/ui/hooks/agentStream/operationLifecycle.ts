/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Operation lifecycle registry + immutable identity snapshot (P06, issue #3167).
 *
 * A constructible CLI-owned registry keyed by AbortSignal that owns the
 * exactly-once lifecycle of a perf operation record. `begin` derives
 * operation_id, snapshots immutable identity/build/dimensions, and initializes
 * a mutable per-operation measurement state suitable for P07 phase accumulation.
 * `finalise` atomically claims the pending op, derives concurrent_instances
 * from non-stale claim files (D3), builds one schema-valid v1 record, and writes
 * through PerfSink. A superseded sweep on every new `begin` finalises displaced
 * still-active ops as `superseded` exactly once — the stale ownership finally
 * block in useSubmitQuery cannot reach them because isCurrentTurn is false.
 *
 * Disabled mode is achieved by the runtime not constructing this registry
 * (AC-2); there are no hidden global side effects.
 *
 * Decisions D1/D3 applied: operation_id is the sole join key (no child
 * prompt_ids/turn_ids arrays); concurrent_instances from claim-file lease
 * semantics.
 */

import {
  deriveOperationId,
  PERF_RECORD_TYPE_OPERATION,
  PERF_SCHEMA_VERSION,
} from '@vybestack/llxprt-code-telemetry/perf/perfRecords.js';
import type {
  PerfOperationRecord,
  PerfTerminalStatus,
} from '@vybestack/llxprt-code-telemetry/perf/perfRecords.js';
import type {
  PerfSink,
  PerfRetention,
} from '@vybestack/llxprt-code-telemetry/perf/index.js';
import type {
  OperationMemorySampler,
  MemoryColumns,
} from '../memoryTrend/memoryTelemetry.js';
import { IntervalUnion } from '@vybestack/llxprt-code-telemetry/telemetry/intervalUnion.js';
import type {
  PerfProviderAttemptEndInfo,
  PerfToolCallCompletedInfo,
} from '@vybestack/llxprt-code-telemetry/perf/perfPhaseObserver.js';
import {
  setPerfPhaseObserver,
  getPerfPhaseObserver,
} from '@vybestack/llxprt-code-telemetry/perf/perfPhaseObserver.js';
import {
  setInteractiveRenderObserver,
  setInteractiveStdoutObserver,
  getInteractiveRenderObserver,
  getInteractiveStdoutObserver,
} from '../../inkRenderOptions.js';

// ---------------------------------------------------------------------------
// Immutable identity snapshot contract (P12 constructs the provider)
// ---------------------------------------------------------------------------

/**
 * Narrow immutable snapshot of the identity/build/comparison-dimension fields
 * captured at operation `begin` time. All fields are non-empty strings or
 * schema-conformant numbers; P12 constructs the provider from actual
 * runtime/config/build APIs. No new CLI flags or env vars are invented here.
 */
export interface OperationIdentitySnapshot {
  readonly session_id: string;
  readonly runtime_id: string;
  readonly parent_runtime_id: string | null;
  readonly subagent_name: string | null;
  readonly project_hash: string;
  readonly llxprt_version: string;
  readonly git_sha: string;
  readonly runtime: string;
  readonly platform: string;
  readonly provider: string;
  readonly model: string;
  readonly terminal_cols: number;
  readonly terminal_rows: number;
  readonly render_mode: string;
}

/**
 * Provider that returns a fresh immutable identity snapshot. P12 wires this
 * from the real runtime/config/build identity APIs; tests supply a fixture.
 */
export interface OperationIdentityProvider {
  snapshot(): OperationIdentitySnapshot;
}

// ---------------------------------------------------------------------------
// Mutable per-operation measurement state (P07 accumulates into this)
// ---------------------------------------------------------------------------

/**
 * Mutable per-operation measurement state. All fields begin at zero/default in
 * P06; P07 accumulates directly-measured client phases, provider/tool sums and
 * unions, and token counts into this object through the typed handle before
 * finalization.
 */
export interface OperationMeasurement {
  client_prepare_ms: number;
  stream_handler_ms: number;
  ink_render_ms: number;
  ink_render_count: number;
  stdout_bytes: number;
  stdout_write_calls: number;
  stdout_write_sync_ms: number;
  client_finalize_ms: number;
  provider_attempts: number;
  provider_attempt_sum_ms: number;
  provider_union_ms: number;
  tool_calls: number;
  tool_call_sum_ms: number;
  tool_union_ms: number;
  agent_activity_union_ms: number;
  approval_wait_ms: number;
  context_tokens: number;
  output_tokens: number;
}

// ---------------------------------------------------------------------------
// Handle + status
// ---------------------------------------------------------------------------

/**
 * Handle returned by {@link OperationLifecycleRegistry.begin}. The
 * `measurement` field is the typed mutable state P07 accumulates into;
 * `sessionOperationIndex` is the monotonic per-session index assigned at begin.
 */
export interface OperationHandle {
  readonly signal: AbortSignal;
  readonly operationId: string;
  readonly measurement: OperationMeasurement;
  readonly sessionOperationIndex: number;
}

/**
 * The seven terminal operation statuses (spec §1.3), including `superseded`.
 */
export type OperationStatus = PerfTerminalStatus;

// ---------------------------------------------------------------------------
// Registry options
// ---------------------------------------------------------------------------

export interface OperationLifecycleRegistryOptions {
  readonly identityProvider: OperationIdentityProvider;
  readonly sink: PerfSink;
  readonly retention: PerfRetention;
  /** Wall-clock epoch millis for the record `ts`. Defaults to Date.now. */
  readonly wallNow?: () => number;
  /** Monotonic millis for elapsed/uptime. Defaults to performance.now. */
  readonly monotonicNow?: () => number;
  /**
   * Optional memory sampler (P10). Present only when memory telemetry is
   * enabled. At exactly-once finalisation, the registry marks operation-end
   * and samples process.memoryUsage() once to include the four memory columns.
   * Absent/disabled ⇒ all four fields are omitted (never zeros). P12 wires
   * this based on real settings.
   */
  readonly memorySampler?: OperationMemorySampler;
}

// ---------------------------------------------------------------------------
// Live phase tracking for granular cancellation classification (P07, AC-4)
// ---------------------------------------------------------------------------

/**
 * The live operation phase used to classify AbortSignal cancellation into the
 * granular `cancelled_during_*` statuses.
 *
 * Deterministic precedence for overlap: `approval` > `tool` > `api`. When a
 * cancellation occurs, the most-specific active phase wins. This is documented
 * and tested so concurrent phases resolve deterministically.
 */
type LivePhase = 'api' | 'tool' | 'approval';

const PHASE_PRECEDENCE: readonly LivePhase[] = ['approval', 'tool', 'api'];

function phaseToCancelledStatus(phase: LivePhase): OperationStatus {
  if (phase === 'approval') return 'cancelled_during_approval';
  if (phase === 'tool') return 'cancelled_during_tool';
  return 'cancelled_during_api';
}

/**
 * The tool-status lifecycle values projected by the Agent's public event
 * stream (ToolUpdate.status). Defined locally so the registry need not depend
 * on the agents package's type; the orchestration narrows the AgentEvent and
 * forwards the status string.
 */
type ToolStatusValue =
  | 'validating'
  | 'scheduled'
  | 'awaiting-approval'
  | 'executing'
  | 'success'
  | 'error'
  | 'cancelled';

/**
 * Minimal structural view of an AgentEvent for perf observation. The
 * orchestration narrows the real AgentEvent to this shape (structurally
 * compatible), so the registry need not depend on the agents package's types.
 * Only tool-status events carry phase-relevant state.
 */
export interface ObservableAgentEvent {
  readonly type: string;
  readonly update?: {
    readonly id: string;
    readonly status: ToolStatusValue;
  };
}

// ---------------------------------------------------------------------------
// Internal pending-op
// ---------------------------------------------------------------------------

interface PendingOp {
  readonly operationId: string;
  readonly identity: OperationIdentitySnapshot;
  readonly startedAtMonotonic: number;
  readonly index: number;
  readonly measurement: OperationMeasurement;
  /** Interval union of provider attempt boundaries (P07). */
  readonly providerIntervals: IntervalUnion;
  /** Interval union of tool call boundaries (P07). */
  readonly toolIntervals: IntervalUnion;
  /** Dedup set for provider attempt IDs (exactly-once). */
  readonly providerSeen: Set<string>;
  /** Dedup set for tool call IDs (exactly-once). */
  readonly toolSeen: Set<string>;
  /** The AbortSignal owning this op (for evidence persistence after removal). */
  readonly signal: AbortSignal;
  /** CallIds currently awaiting approval → approval-wait start monotonic. */
  readonly approvalStarts: Map<string, number>;
  /** CallIds currently in an active tool phase (scheduled/executing). */
  readonly activeToolCallIds: Set<string>;
  /** Whether the API/stream phase is active. */
  apiActive: boolean;
  /** Interval union of closed approval-wait intervals (overlapping-safe). */
  readonly approvalWaitIntervals: IntervalUnion;
  /** Retained cancellation evidence (only set by cancellation events). */
  cancellationEvidence: LivePhase | null;
}

function zeroMeasurement(): OperationMeasurement {
  return {
    client_prepare_ms: 0,
    stream_handler_ms: 0,
    ink_render_ms: 0,
    ink_render_count: 0,
    stdout_bytes: 0,
    stdout_write_calls: 0,
    stdout_write_sync_ms: 0,
    client_finalize_ms: 0,
    provider_attempts: 0,
    provider_attempt_sum_ms: 0,
    provider_union_ms: 0,
    tool_calls: 0,
    tool_call_sum_ms: 0,
    tool_union_ms: 0,
    agent_activity_union_ms: 0,
    approval_wait_ms: 0,
    context_tokens: 0,
    output_tokens: 0,
  };
}

// ---------------------------------------------------------------------------
// Frozen terminal snapshot (immutable record captured at claim time)
// ---------------------------------------------------------------------------

/**
 * Immutable terminal snapshot captured synchronously at exactly-once claim
 * time. Contains every field needed to build the final record EXCEPT
 * concurrent_instances (which requires async claim counting). The queued
 * async write path receives this frozen object and never touches the mutable
 * PendingOp/measurement, so mutations after finalise cannot affect the
 * persisted record.
 */
interface FrozenTerminalSnapshot {
  readonly operationId: string;
  readonly identity: OperationIdentitySnapshot;
  readonly index: number;
  readonly status: OperationStatus;
  readonly wallIso: string;
  readonly wallNowMs: number;
  readonly elapsedMs: number;
  readonly uptimeMs: number;
  readonly measurement: Readonly<OperationMeasurement>;
  readonly residual: number;
  readonly memoryColumns: MemoryColumns | null;
}

// ---------------------------------------------------------------------------
// OperationLifecycleRegistry
// ---------------------------------------------------------------------------

/**
 * Constructible CLI-owned registry keyed by AbortSignal.
 *
 * Not a global singleton: the runtime constructs and installs it only when perf
 * is enabled (AC-2). When perf is disabled, the registry is simply absent —
 * no hidden global side effects.
 */
export class OperationLifecycleRegistry {
  private readonly active = new Map<AbortSignal, PendingOp>();
  private readonly finalised = new WeakSet<AbortSignal>();
  /**
   * Retained terminal cancellation evidence keyed by signal. Populated ONLY by
   * a cancellation terminal signal/event (tool-status cancelled, provider
   * attempt aborted end). Persists after the op is removed from `active` so
   * classifyCancellation works even if the active marker cleared before the
   * catch (P07 AC-4). WeakMap so evidence is reclaimed once the caller drops
   * the AbortSignal/AbortController reference, yet survives active-map removal
   * as long as the caller still holds the signal. This is NOT a "highest phase
   * ever visited" record.
   */
  private readonly retainedCancellationEvidence = new WeakMap<
    AbortSignal,
    LivePhase
  >();
  private readonly identityProvider: OperationIdentityProvider;
  private readonly sink: PerfSink;
  private readonly retention: PerfRetention;
  private readonly wallNow: () => number;
  private readonly monotonicNow: () => number;
  private readonly memorySampler: OperationMemorySampler | null;

  private sessionIndex = -1;
  private lifecycleChain: Promise<void> = Promise.resolve();
  private observersInstalled = false;

  constructor(options: OperationLifecycleRegistryOptions) {
    this.identityProvider = options.identityProvider;
    this.sink = options.sink;
    this.retention = options.retention;
    this.wallNow = options.wallNow ?? (() => Date.now());
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.memorySampler = options.memorySampler ?? null;
  }

  /**
   * Begins a new operation for the given signal and prompt id.
   *
   * Derives operation_id via `deriveOperationId`, snapshots immutable identity,
   * initializes the monotonic per-session index, and creates a mutable
   * measurement state for P07. Before admitting the new op, every prior
   * still-active signal it displaces is claimed and finalised as `superseded`
   * exactly once (the stale ownership finally cannot reach them).
   *
   * Returns a typed handle. No prompt_ids/turn_ids are collected (D1).
   */
  begin(signal: AbortSignal, promptId: string): OperationHandle {
    // Superseded sweep: claim every prior still-active op as superseded.
    // Synchronous claim (remove from active + mark finalised + freeze one
    // immutable terminal snapshot) ensures exactly-once even if the displaced
    // turn's explicit finalise races.
    const displaced = Array.from(this.active.entries()).filter(
      ([activeSignal]) =>
        activeSignal !== signal && !this.finalised.has(activeSignal),
    );
    for (const [activeSignal, op] of displaced) {
      this.finalised.add(activeSignal);
      this.active.delete(activeSignal);
      const snapshot = this.buildFrozenSnapshot(op, 'superseded');
      void this.queueWrite(snapshot);
    }

    this.sessionIndex += 1;
    const identity = this.identityProvider.snapshot();
    const op: PendingOp = {
      operationId: deriveOperationId(promptId),
      identity,
      startedAtMonotonic: this.monotonicNow(),
      index: this.sessionIndex,
      measurement: zeroMeasurement(),
      providerIntervals: new IntervalUnion(),
      toolIntervals: new IntervalUnion(),
      providerSeen: new Set(),
      toolSeen: new Set(),
      signal,
      approvalStarts: new Map(),
      activeToolCallIds: new Set(),
      apiActive: false,
      approvalWaitIntervals: new IntervalUnion(),
      cancellationEvidence: null,
    };
    this.active.set(signal, op);

    return {
      signal,
      operationId: op.operationId,
      measurement: op.measurement,
      sessionOperationIndex: op.index,
    };
  }

  /**
   * Finalises the operation for the given signal exactly once.
   *
   * Atomically claims/removes the pending op from the active map (and marks the
   * signal finalised) and synchronously freezes one immutable terminal
   * snapshot BEFORE returning/queueing. The snapshot captures every terminal
   * field (wall timestamp, monotonic elapsed/uptime, identity, status, all
   * measurement counters/tokens, interval-union durations, approval-wait
   * closure, client_finalize_ms, honest residual, operation-end memory) so the
   * queued async work receives a frozen copy — never a mutable PendingOp/
   * measurement reference. Then derives concurrent_instances from non-stale
   * claim files (D3), clamped to a schema-valid minimum of 1 if the filesystem
   * fail-opened to zero, and writes through PerfSink.
   *
   * A duplicate or late finalise is a no-op (returns a resolved promise). Sink
   * filesystem failures remain fail-open (PerfSink handles them); internal
   * schema/programming failures reject the returned promise.
   */
  finalise(signal: AbortSignal, status: OperationStatus): Promise<void> {
    if (this.finalised.has(signal)) {
      return Promise.resolve();
    }
    const op = this.active.get(signal);
    if (op === undefined) {
      return Promise.resolve();
    }
    this.finalised.add(signal);
    this.active.delete(signal);
    const snapshot = this.buildFrozenSnapshot(op, status);
    return this.queueWrite(snapshot);
  }

  /**
   * Awaits all queued record writes. Tests and the runtime (before dispose)
   * call this to deterministically drain the serialized lifecycle chain so no
   * finalised record is lost when the sink is disposed.
   */
  async drain(): Promise<void> {
    await this.lifecycleChain;
  }

  /**
   * Read-only snapshot of the currently active foreground operation. Returns
   * only current provider/model and monotonic elapsed time — no mutable
   * operation state. Returns null when no operation is active. Used by the
   * bare `/perf` live snapshot (P12).
   */
  getActiveOperationSnapshot(): {
    readonly provider: string;
    readonly model: string;
    readonly elapsedMs: number;
  } | null {
    const op = this.getFirstActiveOp();
    if (op === undefined) return null;
    return {
      provider: op.identity.provider,
      model: op.identity.model,
      elapsedMs: this.monotonicNow() - op.startedAtMonotonic,
    };
  }

  // -----------------------------------------------------------------------
  // P07: Observer installation + direct client phase methods
  // -----------------------------------------------------------------------

  /**
   * Installs this registry as the perf phase observer (provider/tool events),
   * the Ink render observer, and the stdout write observer. Called once when
   * the runtime constructs the registry with perf enabled (P12). Default-off:
   * when the registry is absent, none of these observers are installed.
   *
   * Single interactive owner: if ANY observer is already owned by a DIFFERENT
   * registry instance, this throws (fail-fast) rather than silently clobbering
   * the other registry's observer. Idempotent for the same registry.
   */
  installObservers(): void {
    if (this.observersInstalled) return;
    const perfOwner = getPerfPhaseObserver();
    const renderOwner = getInteractiveRenderObserver();
    const stdoutOwner = getInteractiveStdoutObserver();
    const perfConflict = perfOwner !== null && perfOwner !== this;
    const renderConflict = renderOwner !== null && renderOwner !== this;
    const stdoutConflict = stdoutOwner !== null && stdoutOwner !== this;
    if (perfConflict || renderConflict || stdoutConflict) {
      throw new Error(
        'OperationLifecycleRegistry.installObservers: an observer is already ' +
          'owned by a different registry instance (single interactive owner).',
      );
    }
    this.observersInstalled = true;
    setPerfPhaseObserver(this);
    setInteractiveRenderObserver(this);
    setInteractiveStdoutObserver(this);
  }

  /**
   * Clears the observers it owns and drains pending writes. Called by the
   * runtime on shutdown / perf disable. Identity-safe: each observer is
   * cleared ONLY if it still points at this registry, so a non-owner registry
   * disposing cannot clear a different registry's observer. Idempotent.
   */
  async dispose(): Promise<void> {
    if (this.observersInstalled) {
      this.observersInstalled = false;
      if (getPerfPhaseObserver() === this) setPerfPhaseObserver(null);
      if (getInteractiveRenderObserver() === this) {
        setInteractiveRenderObserver(null);
      }
      if (getInteractiveStdoutObserver() === this) {
        setInteractiveStdoutObserver(null);
      }
    }
    await this.drain();
  }

  // --- Direct client phase measurement methods ---

  /**
   * Sets client_prepare_ms: the monotonic delta from operation begin/acquire
   * to immediately before the first `runStream` send. Directly measured by the
   * caller (useSubmitQuery) — NOT computed by subtraction.
   */
  setClientPrepareMs(signal: AbortSignal, ms: number): void {
    const op = this.active.get(signal);
    if (op !== undefined) op.measurement.client_prepare_ms = ms;
  }

  /**
   * Accumulates synchronous CPU time spent dispatching AgentEvents to CLI
   * handlers. Instrumented OUTSIDE the generic catch-and-log boundary so a
   * perf observer/programming error propagates (D8). Only the sync invocation
   * delta is accumulated — not provider/network/tool await time.
   */
  addStreamHandlerMs(signal: AbortSignal, ms: number): void {
    const op = this.active.get(signal);
    if (op !== undefined) op.measurement.stream_handler_ms += ms;
  }

  /**
   * Captures client_prepare_ms as the monotonic delta from operation begin
   * to NOW. Called by useSubmitQuery immediately before the first `runStream`
   * send. Uses the registry's own monotonic clock for consistency with
   * operation_elapsed_ms.
   */
  captureClientPrepare(signal: AbortSignal): void {
    const op = this.active.get(signal);
    if (op !== undefined) {
      op.measurement.client_prepare_ms =
        this.monotonicNow() - op.startedAtMonotonic;
    }
  }

  /**
   * Single entry point for perf event observation, invoked OUTSIDE the generic
   * processAgentEvent catch (D8: a throw here rejects the stream). Accumulates
   * the synchronous handler duration for the op owning `signal` (so
   * measurements never hit the wrong op) and routes tool-status transitions to
   * {@link handleToolStatus} for live phase tracking. The orchestration narrows
   * the real AgentEvent to the structural {@link ObservableAgentEvent} shape.
   */
  observeAgentEvent(
    event: ObservableAgentEvent,
    signal: AbortSignal,
    handlerMs: number,
  ): void {
    this.addStreamHandlerMs(signal, handlerMs);
    if (event.type === 'tool-status' && event.update !== undefined) {
      this.handleToolStatus(signal, event.update.status, event.update.id);
    }
  }

  // --- Cancellation phase tracking (AC-4) ---

  /**
   * Marks the API/stream phase as active for the operation. Called by
   * useSubmitQuery when the stream begins. This is real active state (not
   * "highest phase ever visited"): once tools/approvals close and only the API
   * phase remains, an abort classifies during_api.
   */
  enterApiPhase(signal: AbortSignal): void {
    const op = this.active.get(signal);
    if (op !== undefined) op.apiActive = true;
  }

  /**
   * Routes a tool-status lifecycle transition for granular cancellation
   * classification, keyed by tool call ID when available. Maintains REAL active
   * tool/approval state and unions overlapping approval waits:
   * - `validating`/`scheduled`: a tool becomes active.
   * - `awaiting-approval`: an approval wait opens (precedence > tool).
   * - `executing`: any open approval wait for this call closes; tool executes.
   * - `success`/`error`: terminal — closes any open approval wait + tool.
   * - `cancelled`: terminal — retains the phase that was cancelled as terminal
   *   cancellation evidence, then closes the tool/approval.
   *
   * `approval` evidence precedence is `approval > tool`: a cancellation while
   * awaiting approval retains `approval`; otherwise `tool`.
   */
  handleToolStatus(
    signal: AbortSignal,
    status: ToolStatusValue,
    callId: string,
  ): void {
    const op = this.active.get(signal);
    if (op === undefined) return;
    switch (status) {
      case 'validating':
      case 'scheduled':
        op.activeToolCallIds.add(callId);
        break;
      case 'awaiting-approval':
        if (!op.approvalStarts.has(callId)) {
          op.approvalStarts.set(callId, this.monotonicNow());
        }
        op.activeToolCallIds.add(callId);
        break;
      case 'executing':
        this.closeApprovalWaitForCall(op, callId);
        op.activeToolCallIds.add(callId);
        break;
      case 'success':
      case 'error':
        this.closeApprovalWaitForCall(op, callId);
        op.activeToolCallIds.delete(callId);
        break;
      case 'cancelled': {
        const phase: LivePhase = op.approvalStarts.has(callId)
          ? 'approval'
          : 'tool';
        this.retainCancellationEvidence(op, signal, phase);
        this.closeApprovalWaitForCall(op, callId);
        op.activeToolCallIds.delete(callId);
        break;
      }
      default: {
        // Exhaustiveness guard; unknown statuses do not change phase state.
        const _exhaustive: never = status;
        void _exhaustive;
      }
    }
  }

  /**
   * Classifies the cancellation status for the given signal.
   *
   * 1. If retained terminal cancellation evidence exists (set ONLY by a
   *    cancellation terminal signal/event — tool-status cancelled or provider
   *    attempt aborted end), it wins and persists past finalise.
   * 2. Otherwise, the most-specific ACTIVE phase wins with deterministic
   *    precedence `approval > tool > api` at the instant of abort. A
   *    completed/rejected approval followed by ordinary API activity yields
   *    `during_api`.
   * 3. Default: `cancelled_during_api`.
   */
  classifyCancellation(signal: AbortSignal): OperationStatus {
    const retained = this.retainedCancellationEvidence.get(signal);
    if (retained !== undefined) {
      return phaseToCancelledStatus(retained);
    }
    const op = this.active.get(signal);
    if (op !== undefined) {
      if (op.approvalStarts.size > 0) return 'cancelled_during_approval';
      if (op.activeToolCallIds.size > 0) return 'cancelled_during_tool';
      return 'cancelled_during_api';
    }
    return 'cancelled_during_api';
  }

  // --- PerfPhaseObserver: provider/tool event accumulation (P07) ---

  /**
   * PerfPhaseObserver: notified by AttemptRecorder at attempt start. Associates
   * the attempt to an operation via deriveOperationId(info.promptId) (the
   * AttemptRecorder's logicalRequestId — D1) so concurrent subagent/unrelated
   * requests are NOT misattributed to the foreground operation. Does NOT use
   * getFirstActiveOp.
   *
   * Stale-evidence clearing: a new provider attempt for an operation proves the
   * operation continued past a prior tool-status `cancelled` terminal, so any
   * retained tool/approval cancellation evidence is now stale and is cleared
   * here (a later independent API abort then classifies cancelled_during_api).
   * Provider-aborted (api) terminal evidence is PRESERVED (overlap precedence +
   * provider-aborted honesty). Current active tool/approval state is NOT
   * touched — only the retained evidence map.
   */
  onProviderAttemptStart(info: {
    readonly attemptId: string;
    readonly promptId: string;
    readonly startMs: number;
  }): void {
    const op = this.findOpByPromptId(info.promptId);
    if (op !== undefined) {
      op.providerSeen.add(info.attemptId);
      this.clearStaleToolApprovalCancellationEvidence(op);
    }
  }

  /**
   * PerfPhaseObserver: notified by AttemptRecorder at attempt end. Associates
   * via deriveOperationId(info.promptId) (D1); dedup by attemptId; accumulate
   * count/sum/union/tokens exactly once. A consumer-abort end retains API
   * cancellation evidence. Invoked at an uncaught lifecycle boundary (D8).
   */
  onProviderAttemptEnd(info: PerfProviderAttemptEndInfo): void {
    const op = this.findOpByPromptId(info.promptId);
    if (op === undefined) return;
    if (!op.providerSeen.has(info.attemptId)) return;
    op.providerSeen.delete(info.attemptId);
    op.measurement.provider_attempts += 1;
    const duration = Math.max(0, info.endMs - info.startMs);
    op.measurement.provider_attempt_sum_ms += duration;
    op.providerIntervals.add(info.startMs, info.endMs);
    op.measurement.context_tokens += info.inputTokens;
    op.measurement.output_tokens += info.outputTokens;
    if (info.status === 'aborted') {
      this.retainCancellationEvidence(op, op.signal, 'api');
    }
  }

  /**
   * PerfPhaseObserver: notified by logToolCall at tool completion. Associates
   * via deriveOperationId(promptId) (D1). Dedup by real callId exactly-once;
   * missing callId counted honestly. Invoked at an uncaught lifecycle boundary.
   */
  onToolCallCompleted(info: PerfToolCallCompletedInfo): void {
    const operationId = deriveOperationId(info.promptId);
    for (const op of this.active.values()) {
      if (op.operationId !== operationId) continue;
      if (info.callId !== undefined) {
        if (op.toolSeen.has(info.callId)) return;
        op.toolSeen.add(info.callId);
      }
      op.measurement.tool_calls += 1;
      op.measurement.tool_call_sum_ms += info.durationMs;
      // Interval honesty: only union when BOTH real boundaries are present.
      // When start_ms or end_ms is absent the count/sum are still recorded,
      // but NO interval is synthesized from monotonicNow — we never invent
      // timing. A missing call_id cannot be deduplicated exactly, so each
      // unidentifiable completed event counts independently (no invented ID).
      if (info.startMs !== undefined && info.endMs !== undefined) {
        op.toolIntervals.add(info.startMs, info.endMs);
      }
      return;
    }
  }

  // --- InteractiveRenderObserver (P07) ---

  /**
   * Ink render observer: accumulates renderTime and render count for the
   * current active op. Render passes are DISTINCT from stdout writes.
   */
  onRender(renderTimeMs: number): void {
    const op = this.getFirstActiveOp();
    if (op !== undefined) {
      op.measurement.ink_render_ms += renderTimeMs;
      op.measurement.ink_render_count += 1;
    }
  }

  // --- StdoutWriteObserver (P07) ---

  /**
   * Stdout write observer: accumulates encoded bytes, write-call count, and
   * sync write duration for the current active op. Write calls are DISTINCT
   * from render passes.
   */
  onWrite(encodedBytes: number, syncDurationMs: number): void {
    const op = this.getFirstActiveOp();
    if (op !== undefined) {
      op.measurement.stdout_bytes += encodedBytes;
      op.measurement.stdout_write_calls += 1;
      op.measurement.stdout_write_sync_ms += syncDurationMs;
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Returns the first (and typically only) active op. Used ONLY for
   * foreground-only observers (Ink render, stdout write) which can never
   * originate from a subagent. Provider/tool correlation uses explicit
   * prompt/call identity instead (D1).
   */
  private getFirstActiveOp(): PendingOp | undefined {
    const entry = this.active.values().next();
    return entry.done === true ? undefined : entry.value;
  }

  /**
   * Finds the active op whose operation_id matches deriveOperationId(promptId).
   * Returns undefined when no active op matches (e.g. a subagent/unrelated
   * request), so it is never misattributed to the foreground operation.
   */
  private findOpByPromptId(promptId: string): PendingOp | undefined {
    const operationId = deriveOperationId(promptId);
    for (const op of this.active.values()) {
      if (op.operationId === operationId) return op;
    }
    return undefined;
  }

  /**
   * Closes the approval-wait interval for a single call ID (if open),
   * unioning it into the approval-wait IntervalUnion (overlapping-safe).
   */
  private closeApprovalWaitForCall(op: PendingOp, callId: string): void {
    const start = op.approvalStarts.get(callId);
    if (start === undefined) return;
    const end = this.monotonicNow();
    op.approvalWaitIntervals.add(start, end);
    op.measurement.approval_wait_ms = op.approvalWaitIntervals.durationMs();
    op.approvalStarts.delete(callId);
  }

  /**
   * Closes every still-open approval-wait interval (used at record assembly so
   * an in-flight approval wait at finalise time is accounted for).
   */
  private closeAllApprovalWaits(op: PendingOp): void {
    for (const callId of Array.from(op.approvalStarts.keys())) {
      this.closeApprovalWaitForCall(op, callId);
    }
  }

  /**
   * Clears retained tool/approval cancellation evidence (set ONLY by a
   * tool-status `cancelled` terminal). Called when a new provider attempt
   * starts for the operation, which proves the operation continued past the
   * tool cancellation. Provider-aborted (api) evidence is NEVER cleared here
   * (overlap precedence + provider-aborted honesty). Current active
   * tool/approval state is untouched.
   */
  private clearStaleToolApprovalCancellationEvidence(op: PendingOp): void {
    const existing = op.cancellationEvidence;
    if (existing === 'tool' || existing === 'approval') {
      op.cancellationEvidence = null;
      this.retainedCancellationEvidence.delete(op.signal);
    }
  }

  /**
   * Retains terminal cancellation evidence for a signal. Set ONLY by a
   * cancellation terminal signal/event (tool-status cancelled, provider
   * attempt aborted end). Precedence `approval > tool > api`: a more-specific
   * retained phase is never downgraded by a later less-specific one. Persists
   * past finalise so classifyCancellation works after the active op clears.
   */
  private retainCancellationEvidence(
    op: PendingOp,
    signal: AbortSignal,
    phase: LivePhase,
  ): void {
    const existing = op.cancellationEvidence;
    if (
      existing === null ||
      PHASE_PRECEDENCE.indexOf(phase) < PHASE_PRECEDENCE.indexOf(existing)
    ) {
      op.cancellationEvidence = phase;
      this.retainedCancellationEvidence.set(signal, phase);
    }
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Serializes record writes through a single lifecycle chain so writes happen
   * in lifecycle order. The chain propagates internal rejections (fail-fast):
   * once an internal error occurs, drain() rejects and subsequent writes are
   * skipped rather than silently attempted against a poisoned state. External
   * filesystem errno errors already resolve inside PerfSink (fail-open), so
   * they do not poison the chain. This ensures an internal rejection from a
   * write that was not individually awaited (e.g. the superseded sweep) is
   * surfaced via drain rather than hidden by a permanently non-rejecting chain.
   *
   * Receives a frozen {@link FrozenTerminalSnapshot}: the async work does ONLY
   * genuinely external claim counting (countNonStaleClaims) and sink
   * persistence, never touching the mutable PendingOp/measurement.
   */
  private queueWrite(snapshot: FrozenTerminalSnapshot): Promise<void> {
    const attempt = (): Promise<void> => this.persistSnapshot(snapshot);
    const result = this.lifecycleChain.then(attempt);
    // Attach a local rejection handler so a rejected write whose individual
    // promise was not awaited (notably the superseded sweep from begin) does
    // not become a process-level unhandled rejection. The shared
    // lifecycleChain (=== result) remains rejected so drain() still fails
    // fast. This does NOT globally catch, log, or convert the chain to green.
    void result.catch(() => {});
    this.lifecycleChain = result;
    return result;
  }

  /**
   * Synchronously builds an immutable terminal snapshot of the operation at
   * exactly-once claim time. Captures every terminal field coherently:
   *
   * - Closes any open approval-wait intervals (approval-wait closure).
   * - Computes interval-union durations for provider/tool/agent_activity.
   * - Captures operation-end memory (marks operation-end then samples once).
   * - Captures wall timestamp and the finalization boundary monotonic time.
   *
   * Coherent clocks: `elapsedMs` and `client_finalize_ms` share the SAME end
   * boundary (finalizeEnd) so elapsed includes the full synchronous
   * finalization work before subtracting client_finalize_ms. The honest
   * residual (unclassified_elapsed_ms) is elapsed minus directly-measured
   * client phases and approval wait — never clamped, never zeroed.
   *
   * The returned snapshot copies identity, measurement, and optional memory
   * columns so mutations to provider-owned or live operation objects after this
   * point cannot affect the persisted record.
   */
  private buildFrozenSnapshot(
    op: PendingOp,
    status: OperationStatus,
  ): FrozenTerminalSnapshot {
    const finalizeStart = this.monotonicNow();

    // Close any open approval-wait intervals before computing the record.
    this.closeAllApprovalWaits(op);

    // Compute IntervalUnion durations for provider/tool/agent_activity unions.
    const providerUnionMs = op.providerIntervals.durationMs();
    const toolUnionMs = op.toolIntervals.durationMs();
    const agentActivityUnionMs = op.providerIntervals
      .union(op.toolIntervals)
      .durationMs();

    // Capture operation-end memory at the synchronous finalization boundary.
    const memoryColumns = this.captureOperationEndMemory();

    // Finalization boundary: elapsed and client_finalize_ms share the SAME
    // end so the residual is coherent — elapsed includes the full synchronous
    // finalization work (union computation, approval-wait closing, residual
    // computation, memory sampling) before subtracting client_finalize_ms.
    const finalizeEnd = this.monotonicNow();
    const wallNow = this.wallNow();
    const elapsedMs = finalizeEnd - op.startedAtMonotonic;
    const uptimeMs = finalizeEnd;
    const clientFinalizeMs = finalizeEnd - finalizeStart;

    const source = op.measurement;
    // Frozen copy of all measurement counters/tokens plus the computed union
    // durations and client_finalize_ms. Mutations to the live measurement
    // after this point cannot affect this snapshot.
    const measurement: OperationMeasurement = {
      ...source,
      provider_union_ms: providerUnionMs,
      tool_union_ms: toolUnionMs,
      agent_activity_union_ms: agentActivityUnionMs,
      client_finalize_ms: clientFinalizeMs,
    };

    const residual =
      elapsedMs -
      measurement.client_prepare_ms -
      measurement.stream_handler_ms -
      measurement.ink_render_ms -
      measurement.stdout_write_sync_ms -
      clientFinalizeMs -
      measurement.approval_wait_ms;

    return {
      operationId: op.operationId,
      identity: { ...op.identity },
      index: op.index,
      status,
      wallIso: new Date(wallNow).toISOString(),
      wallNowMs: wallNow,
      elapsedMs,
      uptimeMs,
      measurement,
      residual,
      memoryColumns: memoryColumns === null ? null : { ...memoryColumns },
    };
  }

  /**
   * Queued async work: does ONLY genuinely external claim counting
   * (countNonStaleClaims) and sink persistence. Receives the frozen snapshot,
   * derives concurrent_instances (clamped to minimum 1 if the filesystem
   * fail-opened), builds the final record, and writes through PerfSink.
   */
  private async persistSnapshot(
    snapshot: FrozenTerminalSnapshot,
  ): Promise<void> {
    // --- async work (NOT part of client_finalize_ms) ---
    const concurrentInstances = Math.max(
      1,
      await this.retention.countNonStaleClaims(snapshot.wallNowMs),
    );

    const m = snapshot.measurement;
    const record: PerfOperationRecord = {
      schema_version: PERF_SCHEMA_VERSION,
      record_type: PERF_RECORD_TYPE_OPERATION,
      ts: snapshot.wallIso,
      session_id: snapshot.identity.session_id,
      operation_id: snapshot.operationId,
      runtime_id: snapshot.identity.runtime_id,
      parent_runtime_id: snapshot.identity.parent_runtime_id,
      subagent_name: snapshot.identity.subagent_name,
      project_hash: snapshot.identity.project_hash,
      llxprt_version: snapshot.identity.llxprt_version,
      git_sha: snapshot.identity.git_sha,
      runtime: snapshot.identity.runtime,
      platform: snapshot.identity.platform,
      provider: snapshot.identity.provider,
      model: snapshot.identity.model,
      context_tokens: m.context_tokens,
      output_tokens: m.output_tokens,
      terminal_cols: snapshot.identity.terminal_cols,
      terminal_rows: snapshot.identity.terminal_rows,
      render_mode: snapshot.identity.render_mode,
      concurrent_instances: concurrentInstances,
      status: snapshot.status,
      client_prepare_ms: m.client_prepare_ms,
      stream_handler_ms: m.stream_handler_ms,
      ink_render_ms: m.ink_render_ms,
      ink_render_count: m.ink_render_count,
      stdout_bytes: m.stdout_bytes,
      stdout_write_calls: m.stdout_write_calls,
      stdout_write_sync_ms: m.stdout_write_sync_ms,
      client_finalize_ms: m.client_finalize_ms,
      provider_attempts: m.provider_attempts,
      provider_attempt_sum_ms: m.provider_attempt_sum_ms,
      provider_union_ms: m.provider_union_ms,
      tool_calls: m.tool_calls,
      tool_call_sum_ms: m.tool_call_sum_ms,
      tool_union_ms: m.tool_union_ms,
      agent_activity_union_ms: m.agent_activity_union_ms,
      operation_elapsed_ms: snapshot.elapsedMs,
      approval_wait_ms: m.approval_wait_ms,
      unclassified_elapsed_ms: snapshot.residual,
      ...(snapshot.memoryColumns ?? {}),
      session_operation_index: snapshot.index,
      uptime_ms: snapshot.uptimeMs,
    };

    await this.sink.write(record);
  }

  /**
   * P10: captures operation-end memory columns at exactly-once finalisation.
   * Marks operation-end first (so subsequent tick samples compute idle
   * relative to this moment), then samples process.memoryUsage() once.
   * Returns null when disabled/absent — all four fields omitted, never zeros.
   */
  private captureOperationEndMemory(): MemoryColumns | null {
    this.memorySampler?.markOperationEnd();
    return this.memorySampler?.sampleOperationEndMemory() ?? null;
  }
}
