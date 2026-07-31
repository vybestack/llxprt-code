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

const DEFAULT_AGENT_SCOPE = 'primary';
const DEFAULT_QUEUE_CAPACITY = 512;
const DEFAULT_HEARTBEAT_MS = 15_000;

interface NativeTodoLike {
  readonly content: string;
  readonly status: string;
}

export interface JspProducerHooks {
  readonly now: () => number;
  readonly createIdentity: (bootstrap: JspBootstrap) => JspProducerIdentity;
  readonly register: (snapshot: JspSnapshotDocument) => Promise<boolean>;
  readonly publish: (document: JspBoundDocument) => Promise<boolean>;
  readonly heartbeat: (document: JspHeartbeatDocument) => Promise<boolean>;
  readonly noContent?: boolean;
}

export interface JspProducerOptions {
  readonly capacity?: number;
  readonly heartbeatMs?: number;
}

class ProducerQueueSink implements JspQueueSink {
  constructor(
    private readonly publish: (document: JspBoundDocument) => Promise<boolean>,
  ) {}

  send(document: JspBoundDocument): Promise<boolean> {
    return this.publish(document);
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
  private registrationTask: Promise<void> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    bootstrap: JspBootstrap,
    nativeSession: JspNativeSession,
    hooks: JspProducerHooks,
    private readonly options: JspProducerOptions = {},
  ) {
    this.hooks = hooks;
    this.identity = hooks.createIdentity(bootstrap);
    this.state = initProducerState(this.identity, nativeSession, hooks.now);
    this.queue = new JspBoundedQueue(new ProducerQueueSink(hooks.publish), {
      capacity: options.capacity ?? DEFAULT_QUEUE_CAPACITY,
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
    this.started = true;
    this.ensureRegistered();
  }

  stop(): void {
    this.started = false;
    this.stopHeartbeat();
    this.queue.stop();
  }

  async shutdown(): Promise<void> {
    this.stopHeartbeat();
    if (this.started) {
      this.observeSessionEnded();
      await this.flush();
      if (this.registered) {
        await this.hooks.publish(this.snapshot()).catch(() => false);
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
    if (!this.started || this.registered || this.registrationTask !== null) {
      return;
    }
    const initial = this.snapshot();
    this.registrationTask = this.hooks
      .register(initial)
      .then((accepted) => {
        if (!accepted || !this.started) {
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

  private beginHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      return;
    }
    const heartbeatMs = this.options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.heartbeatTimer = setInterval(() => {
      const document: JspHeartbeatDocument = {
        schema: 1,
        kind: 'heartbeat',
        agent_id: this.identity.agentId,
        lifecycle_generation: this.identity.lifecycleGeneration,
        source_epoch: this.identity.sourceEpoch,
        bridge_observed_ms: this.hooks.now(),
      };
      void this.hooks.heartbeat(document);
    }, heartbeatMs);
  }

  private applyAndPublish(transition: JspTransition): void {
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
