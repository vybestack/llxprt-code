/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import {
  todoEvents,
  FatalConfigError,
  type Todo,
  type TodoUpdateEvent,
} from '@vybestack/llxprt-code-core';
import {
  createProducerIdentity,
  parseBootstrap,
  type JspBootstrap,
} from './jspSchema.js';
import { JspHttpPublisher } from './jspPublisher.js';
import { JspProducer, type JspProducerHooks } from './jspProducer.js';
import type { JspNativeSession } from './jspDocuments.js';
import { createObservationTap, type ObservationTap } from './observationTap.js';

const BOOTSTRAP_ENV = 'LLXPRT_JSP_BOOTSTRAP_FILE';
const NO_CONTENT_ENV = 'LLXPRT_JSP_NO_CONTENT';

export interface ObservationSessionContext {
  readonly repository: string;
  readonly path: string;
  readonly agentKind: string;
  readonly displayName: string;
}

let producer: JspProducer | null = null;
let tap: ObservationTap = createObservationTap(null);
let unsubscribeTodos: (() => void) | null = null;

export function createTodoObservationSubscription(
  observer: (agentId: string | undefined, todos: readonly Todo[]) => void,
): () => void {
  const listener = (event: TodoUpdateEvent) => {
    observer(event.agentId, event.todos);
  };
  todoEvents.onTodoUpdated(listener);
  return () => todoEvents.offTodoUpdated(listener);
}

/**
 * Load and validate the JSP bootstrap file declared on the environment.
 *
 * A bootstrap file is present only when a supervisor has deliberately opted
 * this process into observation, so a misconfiguration must fail fast and
 * legibly: silently degrading turns a broken observation setup into an
 * invisible "agent never appears in the observer" failure with no local
 * signal. Issue 2779's non-blocking guarantee is scoped to the post-startup
 * path (transport outage or queue pressure degrading telemetry without failing
 * the foreground); startup configuration validation is the distinct P1 row and
 * is deliberately fail-fast. Each failure throws `FatalConfigError` so the CLI
 * entry point renders a single actionable line rather than an
 * unexpected-critical stack trace.
 *
 * The messages intentionally name only the environment variable and the
 * failure category: this file is credential-bearing, and the message is
 * written to stderr where a supervisor may log it.
 */
export function loadBootstrapFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): JspBootstrap | null {
  const filePath = env[BOOTSTRAP_ENV];
  if (filePath === undefined || filePath.length === 0) {
    return null;
  }
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    throw new FatalConfigError(
      `JSP bootstrap file named by ${BOOTSTRAP_ENV} could not be read`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new FatalConfigError(
      `JSP bootstrap file named by ${BOOTSTRAP_ENV} is malformed JSON`,
    );
  }
  const result = parseBootstrap(parsed);
  if (!result.ok) {
    throw new FatalConfigError(
      `JSP bootstrap file named by ${BOOTSTRAP_ENV} was rejected (${result.error.code})`,
    );
  }
  return result.value;
}

function toNativeSession(context: ObservationSessionContext): JspNativeSession {
  return {
    repository: context.repository,
    path: context.path,
    agent_kind: context.agentKind,
    pid: process.pid,
    display_name: context.displayName,
  };
}

/**
 * Read the no-content opt-in from the environment.
 *
 * When enabled, assistant message text is suppressed in the published
 * documents while status fields and timestamps are preserved. This is the
 * same environment-variable mechanism the bootstrap file uses, so an operator
 * activates it alongside the bootstrap without a separate config surface.
 */
export function shouldSuppressContent(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[NO_CONTENT_ENV] === 'true' || env[NO_CONTENT_ENV] === '1';
}

export function createObservationProducer(
  bootstrap: JspBootstrap | null,
  sessionContext: ObservationSessionContext,
  hooksOverride?: Partial<JspProducerHooks>,
): JspProducer | null {
  if (bootstrap === null) {
    return null;
  }
  const publisher = new JspHttpPublisher(bootstrap);
  // Resolve the clock before composing so an injected `now` also drives
  // identity creation. Capturing `Date.now` here would leave the identity
  // timestamps on a different time source from every other hook.
  const now = hooksOverride?.now ?? Date.now;
  const hooks: JspProducerHooks = {
    now,
    createIdentity: (material) => createProducerIdentity(material, now),
    register: (snapshot) => publisher.register(snapshot),
    publish: (document) => publisher.publish(document),
    heartbeat: (document) => publisher.heartbeat(document),
    noContent: hooksOverride?.noContent ?? shouldSuppressContent(),
    ...hooksOverride,
  };
  const nextProducer = new JspProducer(
    bootstrap,
    toNativeSession(sessionContext),
    hooks,
  );
  nextProducer.start();
  return nextProducer;
}

export function initializeObservationProducer(
  context: ObservationSessionContext,
): void {
  unsubscribeTodos?.();
  unsubscribeTodos = null;
  // Clear module state before building the replacement. Loading the bootstrap
  // or constructing the producer can throw, and on this re-initialization path
  // that would otherwise leave `tap` dispatching into an already-stopped
  // producer.
  producer?.stop();
  producer = null;
  tap = createObservationTap(null);
  producer = createObservationProducer(loadBootstrapFromEnv(), context);
  if (producer === null) {
    return;
  }
  producer.setAgentScope(undefined);
  unsubscribeTodos = createTodoObservationSubscription(observeTodosReplaced);
  tap = createObservationTap({
    onTurnStarted: () => producer?.observeTurnStarted(),
    onTurnEnded: (outcome) => producer?.observeTurnEnded(outcome),
    onActivityChanged: (state) => producer?.observeActivityChanged(state),
    onWaitOpened: (reason) => producer?.observeWaitOpened(reason),
    onWaitResolved: () => producer?.observeWaitResolved(),
    onToolCreated: (label, phase) => producer?.observeToolCreated(label, phase),
    onToolPhaseChanged: (label, phase) =>
      producer?.observeToolPhaseChanged(label, phase),
    onAssistantChunk: (content) => producer?.observeAssistantChunk(content),
    onAssistantMessageCommitted: (content, committedMs) =>
      producer?.observeAssistantMessageDisplayed(content, committedMs),
    onSourceError: (summary, code) =>
      producer?.observeSourceError(summary, code),
  });
}

export async function stopObservationProducer(): Promise<void> {
  const activeProducer = producer;
  producer = null;
  tap = createObservationTap(null);
  unsubscribeTodos?.();
  unsubscribeTodos = null;
  await activeProducer?.shutdown();
}

/**
 * Observation is optional telemetry. A failure anywhere in the tap, producer,
 * or transport must degrade telemetry only and must never disrupt the
 * foreground TUI. This is the single boundary that enforces that guarantee, so
 * foreground call sites do not each carry their own guard.
 */
function isolate(observe: () => void): void {
  try {
    observe();
  } catch {
    // Telemetry-only failure; foreground behavior is deliberately unaffected.
  }
}

export function observeTurnStarted(): void {
  isolate(() => tap.onTurnStarted());
}

export function observeTurnFailed(): void {
  isolate(() => tap.onTurnEnded('failed'));
}

/**
 * Close the observed turn when the user cancels interactively. The abort does
 * not surface as a terminal `done` event and does not reach the submit path's
 * failure handler, so without this the producer would keep reporting an active
 * turn with a growing elapsed time for the rest of the session.
 */
export function observeTurnCancelled(): void {
  isolate(() => tap.onTurnEnded('cancelled'));
}

export function observeAgentEvent(event: AgentEvent): void {
  isolate(() => tap.processEvent(event));
}

export function observeAssistantMessageCommitted(
  content: string,
  committedMs: number,
): void {
  isolate(() => tap.onFlushCommitted(content, committedMs));
}

export function observeTodosReplaced(
  agentId: string | undefined,
  todos: readonly Todo[],
): void {
  isolate(() => producer?.observeTodosReplaced(agentId, todos));
}
