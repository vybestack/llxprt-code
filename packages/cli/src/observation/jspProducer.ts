/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JspBootstrap, JspProducerIdentity } from './jspSchema.js';
import {
  applyTransition,
  buildSnapshot,
  initProducerState,
  type JspActivityState,
  type JspNativeSession,
  type JspProducerState,
  type JspTransition,
  type JspTurnOutcome,
} from './jspProducerState.js';
import type {
  JspBoundDocument,
  JspEventDocument,
  JspEventPayload,
  JspHeartbeatDocument,
  JspSnapshotDocument,
  JspToolPhase,
  JspWaitReason,
} from './jspDocuments.js';
import { JSP_BOUNDS, withinByteBound } from './jspBounds.js';
import {
  buildTodoItems,
  redactAssistantContent,
  truncateToByteBound,
} from './jspRedaction.js';
import { JspBoundedQueue, type JspQueueSink } from './jspQueue.js';
import type { JspPostResult } from './jspPublisher.js';

const DEFAULT_AGENT_SCOPE = 'primary';
const DEFAULT_QUEUE_CAPACITY = 512;
/**
 * The observer lease defined by the JSP/1 specification. An observer marks
 * observation health stale once this much time passes with no accepted
 * document.
 */
export const OBSERVER_LEASE_MS = 15_000;
/**
 * Heartbeat interval.
 *
 * Must stay at or below a third of {@link OBSERVER_LEASE_MS} so two
 * consecutive heartbeats can be lost before the observer declares the source
 * stale. Setting it equal to the lease makes expiry a race against scheduling
 * jitter, which shows up as an intermittently stale observation.
 */
const DEFAULT_HEARTBEAT_MS = 5_000;
const REGISTRATION_RETRY_BACKOFF_MS = 5_000;
const MAX_REGISTRATION_ATTEMPTS = 10;

/**
 * How the producer should react to a broker outcome.
 *
 * - `accepted`: the document was delivered; proceed normally.
 * - `retryable`: a transient failure (5xx or transport). Retry with bounded
 *   backoff.
 * - `terminal`: a permanent rejection (401/403/409/400). The producer must
 *   stop rather than spin on a result that cannot change.
 */
type PostOutcomeClassification = 'accepted' | 'retryable' | 'terminal';

function classifyPostResult(result: JspPostResult): PostOutcomeClassification {
  if (result.kind === 'ok') {
    return 'accepted';
  }
  if (result.kind === 'transport') {
    return 'retryable';
  }
  // 401/403: credential unknown, revoked, or mis-bound. Retrying an identical
  // request cannot succeed.
  // 409: a different epoch owns this registration. This producer is stale.
  // 400: malformed document/protocol. Retrying the identical snapshot cannot
  // produce a different result.
  if (
    result.status === 401 ||
    result.status === 403 ||
    result.status === 409 ||
    result.status === 400
  ) {
    return 'terminal';
  }
  // All other non-2xx (notably 5xx) are transient.
  return 'retryable';
}

/** True when the status code means the credential is no longer valid. */
function isCredentialFailure(result: JspPostResult): boolean {
  return result.kind === 'rejected' && (result.status === 401 || result.status === 403);
}

interface NativeTodoLike {
  readonly content: string;
  readonly status: string;
}

export interface JspProducerHooks {
  readonly now: () => number;
  readonly createIdentity: (bootstrap: JspBootstrap) => JspProducerIdentity;
  readonly register: (snapshot: JspSnapshotDocument) => Promise<JspPostResult>;
  readonly publish: (document: JspBoundDocument) => Promise<JspPostResult>;
  readonly heartbeat: (document: JspHeartbeatDocument) => Promise<JspPostResult>;
  readonly noContent?: boolean;
}

export interface JspProducerOptions {
  readonly capacity?: number;
  readonly heartbeatMs?: number;
}

class ProducerQueueSink implements JspQueueSink {
  constructor(
    private readonly publish: (document: JspBoundDocument) => Promise<JspPostResult>,
  ) {}

  async send(document: JspBoundDocument): Promise<boolean> {
    const result = await this.publish(document);
    return result.kind === 'ok';
  }
}

export class JspProducer {
  private readonly hooks: JspProducerHooks;
  private readonly queue: JspBoundedQueue;
  private readonly identity: JspProducerIdentity;
  private state: JspProducerState;
  private sessionId: string | null = null;
  private agentId = DEFAULT_AGENT_SCOPE;
  private todoRevision = 0;
  private started = false;
  private registered = false;
  private registrationTerminal = false;
  private registrationTask: Promise<void> | null = null;
  private registrationAttempts = 0;
  private lastRegistrationMs = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    bootstrap: JspBootstrap,
    nativeSession: JspNativeSession,
    hooks: JspProducerHooks,
    private readonly options: JspProducerOptions = {},
  ) {
    this.hooks = hooks;
    this.identity = hooks.createIdentity(bootstrap);
    this.state = initProducerState(this.identity, nativeSession);
    this.queue = new JspBoundedQueue(new ProducerQueueSink(hooks.publish), {
      capacity: options.capacity ?? DEFAULT_QUEUE_CAPACITY,
      onRecoveryNeeded: () => this.publishRecoverySnapshot(),
    });
  }

  setSession(sessionId: string, agentId: string | undefined): void {
    this.sessionId = sessionId;
    this.agentId = agentId ?? DEFAULT_AGENT_SCOPE;
  }

  start(): void {
    if (this.started) {
      return;
    }
    // A restart after stop() requires resetting the queue, which was
    // permanently stopped. Without this, events are silently dropped on
    // the second lifecycle.
    if (this.queue.stopped) {
      this.queue.restart();
    }
    this.started = true;
    this.ensureRegistered();
  }

  stop(): void {
    this.started = false;
    // Reset registration bookkeeping so a later start() re-registers and
    // re-establishes the heartbeat. Without this, restart runs with no
    // registration and no heartbeat. registrationTerminal is intentionally
    // NOT reset: a producer stopped because of a terminal 401/403/409/400
    // rejection must not silently re-register.
    this.registered = false;
    this.registrationAttempts = 0;
    this.lastRegistrationMs = 0;
    this.stopHeartbeat();
    this.queue.stop();
  }

  async shutdown(): Promise<void> {
    this.stopHeartbeat();
    if (this.started) {
      this.observeSessionEnded();
      await this.flush();
      if (this.registered) {
        await this.hooks.publish(this.snapshot()).catch(() => undefined);
      }
    }
    this.stop();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  snapshot(): JspSnapshotDocument {
    return buildSnapshot(this.state, this.hooks.now);
  }

  private ensureRegistered(): void {
    if (
      !this.started ||
      this.registered ||
      this.registrationTerminal ||
      this.registrationTask !== null
    ) {
      return;
    }
    // Registration is attempted from the foreground event path, so an
    // unreachable broker must not produce one request per observed event.
    // Back off between attempts and stop retrying once the cap is reached;
    // telemetry stays disabled rather than pressuring the transport.
    if (this.registrationAttempts >= MAX_REGISTRATION_ATTEMPTS) {
      return;
    }
    const now = this.hooks.now();
    if (
      this.registrationAttempts > 0 &&
      now - this.lastRegistrationMs < REGISTRATION_RETRY_BACKOFF_MS
    ) {
      return;
    }
    this.registrationAttempts += 1;
    this.lastRegistrationMs = now;
    const initial = this.snapshot();
    this.registrationTask = this.hooks
      .register(initial)
      .then((result) => {
        const classification = classifyPostResult(result);
        if (classification === 'terminal') {
          // 401/403/409/400 are permanent: retrying the identical snapshot
          // cannot succeed. Stop the producer so it does not spin or send
          // heartbeats into a broker that has rejected the registration.
          this.registrationTerminal = true;
          this.stopHeartbeat();
          return;
        }
        if (classification !== 'accepted' || !this.started) {
          // Retryable: leave registered false so the next foreground event
          // re-attempts within the backoff budget.
          return;
        }
        this.registered = true;
        this.beginHeartbeat();
        if (this.state.sourceSequence !== initial.source_sequence) {
          this.queue.enqueue(this.snapshot());
        }
      })
      .catch(() => undefined)
      .finally(() => {
        this.registrationTask = null;
      });
  }

  /**
   * Re-establish the stream after a lost document by publishing a fresh
   * snapshot, which is the only way an observer can resume after a gap.
   */
  private publishRecoverySnapshot(): void {
    if (!this.started || !this.registered) {
      return;
    }
    if (this.queue.enqueue(this.snapshot())) {
      this.queue.markSnapshotRecoveryDone();
    }
  }

  /** The interval at which this producer heartbeats, in milliseconds. */
  heartbeatIntervalMs(): number {
    return this.options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  }

  private beginHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      return;
    }
    const heartbeatMs = this.heartbeatIntervalMs();
    this.heartbeatTimer = setInterval(() => {
      const document: JspHeartbeatDocument = {
        schema: 1,
        kind: 'heartbeat',
        agent_id: this.identity.agentId,
        lifecycle_generation: this.identity.lifecycleGeneration,
        source_epoch: this.identity.sourceEpoch,
        bridge_observed_ms: this.hooks.now(),
      };
      void this.hooks.heartbeat(document).then((result) => {
        // A 401/403 on heartbeat means the credential is revoked or mis-bound.
        // Stop the producer rather than sending heartbeats into a broker that
        // no longer recognizes it.
        if (isCredentialFailure(result)) {
          this.stop();
        }
      });
    }, heartbeatMs);
  }

  private applyAndPublish(transition: JspTransition): void {
    // After stop() the producer is no longer publishing. Allowing state to
    // mutate here would let snapshot() report state that was never published,
    // so a stopped producer must be inert.
    if (!this.started) {
      return;
    }
    this.state = applyTransition(this.state, transition, this.hooks.now);
    if (!this.registered) {
      this.ensureRegistered();
      return;
    }
    if (this.queue.needsSnapshotRecovery()) {
      if (!this.queue.enqueue(this.snapshot())) {
        return;
      }
      this.queue.markSnapshotRecoveryDone();
    }
    const payload = transitionToPayload(transition);
    if (payload === null) {
      return;
    }
    const document: JspEventDocument = {
      schema: 1,
      kind: 'event',
      agent_id: this.identity.agentId,
      lifecycle_generation: this.identity.lifecycleGeneration,
      source_epoch: this.identity.sourceEpoch,
      source_sequence: this.state.sourceSequence,
      bridge_observed_ms: this.hooks.now(),
      event: payload,
    };
    this.queue.enqueue(document);
  }

  observeTurnStarted(): void {
    this.applyAndPublish({ type: 'turn.started' });
  }

  observeTurnEnded(outcome: JspTurnOutcome): void {
    this.applyAndPublish({ type: 'turn.ended', outcome });
  }

  observeActivityChanged(state: JspActivityState): void {
    this.applyAndPublish({ type: 'activity.changed', state });
  }

  observeWaitOpened(reason: JspWaitReason): void {
    this.applyAndPublish({ type: 'wait.opened', reason });
  }

  observeWaitResolved(): void {
    this.applyAndPublish({ type: 'wait.resolved' });
  }

  observeToolCreated(label: string, phase: JspToolPhase): void {
    if (withinByteBound(label, JSP_BOUNDS.toolLabelBytes)) {
      this.applyAndPublish({ type: 'tool_call.created', label, phase });
    }
  }

  observeToolPhaseChanged(label: string, phase: JspToolPhase): void {
    if (withinByteBound(label, JSP_BOUNDS.toolLabelBytes)) {
      this.applyAndPublish({ type: 'tool_call.phase_changed', label, phase });
    }
  }

  observeAssistantChunk(_content: string): void {}

  observeAssistantMessageDisplayed(content: string, committedMs: number): void {
    const redacted = redactAssistantContent(
      content,
      JSP_BOUNDS.displayedContentBytes,
      this.hooks.noContent === true,
    );
    this.applyAndPublish({
      type: 'assistant_message.displayed',
      content: redacted,
      committedMs,
    });
  }

  observeSourceError(summary: string, code: string): void {
    this.applyAndPublish({
      type: 'source.error',
      summary: truncateToByteBound(summary, JSP_BOUNDS.diagnosticSummaryBytes),
      code: truncateToByteBound(code, JSP_BOUNDS.sourceErrorCodeBytes),
    });
  }

  observeTodosReplaced(
    sessionId: string,
    agentId: string | undefined,
    todos: readonly NativeTodoLike[],
  ): void {
    const scopedAgent = agentId ?? DEFAULT_AGENT_SCOPE;
    if (
      this.sessionId !== null &&
      (sessionId !== this.sessionId || scopedAgent !== this.agentId)
    ) {
      return;
    }
    this.todoRevision += 1;
    this.applyAndPublish({
      type: 'todos.replaced',
      revision: this.todoRevision,
      items: buildTodoItems(todos, {
        todoTextBytes: JSP_BOUNDS.todoTextBytes,
        todoEntries: JSP_BOUNDS.todoEntries,
      }),
    });
  }

  observeSessionEnded(): void {
    this.applyAndPublish({ type: 'session.ended' });
  }

  async flush(): Promise<void> {
    while (this.registrationTask !== null) {
      await this.registrationTask;
    }
    await this.queue.flush();
  }
}

function transitionToPayload(
  transition: JspTransition,
): JspEventPayload | null {
  switch (transition.type) {
    case 'turn.started':
      return { type: 'turn.started' };
    case 'turn.ended':
      return { type: 'turn.ended', outcome: transition.outcome };
    case 'activity.changed':
      return { type: 'activity.changed', state: transition.state };
    case 'wait.opened':
      return { type: 'wait.opened', reason: transition.reason };
    case 'wait.resolved':
      return { type: 'wait.resolved' };
    case 'todos.replaced':
      return {
        type: 'todos.replaced',
        revision: transition.revision,
        items: transition.items,
      };
    case 'tool_call.created':
      return {
        type: 'tool_call.created',
        label: transition.label,
        phase: transition.phase,
      };
    case 'tool_call.phase_changed':
      return {
        type: 'tool_call.phase_changed',
        label: transition.label,
        phase: transition.phase,
      };
    case 'assistant_message.displayed':
      return {
        type: 'assistant_message.displayed',
        content: transition.content,
        committed_ms: transition.committedMs,
      };
    case 'source.error':
      return {
        type: 'source.error',
        summary: transition.summary,
        code: transition.code,
      };
    case 'session.ended':
      return { type: 'session.ended' };
    default:
      return null;
  }
}
