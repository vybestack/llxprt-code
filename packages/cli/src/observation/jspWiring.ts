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
  writeToStderr,
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

/**
 * Sink for a bootstrap-load warning. The production default keeps
 * `process.stdout` clean for `-p` piping; tests inject a plain capturing sink.
 */
export type BootstrapWarningSink = (message: string) => void;

/**
 * Physical stderr writer used by the default warning sink. Routed through the
 * core {@link writeToStderr} helper, which holds a bound reference to the
 * original `process.stderr.write` captured before any monkey-patching, so the
 * warning reaches physical stderr immediately even after `cli.tsx`'s
 * `patchStdio()` has redirected `process.stderr.write` to the internal output
 * event bus (that redirection happens before `setupObservation` runs). Swapped
 * via {@link __setBootstrapWarningStderrWriterForTesting} so the best-effort
 * guard below can be exercised without destroying fd 2.
 */
let bootstrapStderrWriter: (message: string) => void = (message) =>
  writeToStderr(message);

/**
 * @internal Test seam: replace the physical stderr writer the default warning
 * sink delegates to. Pass `null` to restore the production `writeToStderr`
 * writer. An explicitly injected {@link BootstrapWarningSink} bypasses this
 * seam and the default's guard entirely, so injected sinks stay strict.
 */
export function __setBootstrapWarningStderrWriterForTesting(
  writer: ((message: string) => void) | null,
): void {
  bootstrapStderrWriter = writer ?? ((message) => writeToStderr(message));
}

/**
 * Default warning sink. Best-effort: a destroyed or throwing stderr must not
 * propagate and turn a missing-file warning back into a fatal startup error.
 * Mirrors the guarded-default/strict-injected-sink pattern in
 * `launcher/process-memory-hardening.ts` — an explicitly injected
 * `warningSink` is invoked directly by `loadBootstrapFromEnv` and stays strict
 * by contract.
 */
function writeBootstrapWarningToStderr(message: string): void {
  try {
    bootstrapStderrWriter(message);
  } catch {
    // Physical stderr is unusable; the warning is best-effort by contract and
    // must not abort startup. An injected sink is deliberately not guarded.
  }
}

/**
 * Render an environment-controlled file path as a single escaped token so a
 * path carrying newlines, ANSI escapes, or other control characters cannot
 * inject additional log lines into the warning or fatal diagnostic. The
 * credential-bearing file *body* is never included — only this escaped name.
 */
function escapedPath(filePath: string): string {
  return JSON.stringify(filePath);
}

/**
 * Extract the errno `code` from a `readFileSync` failure without asserting on
 * the error shape. Present only when the underlying error carries one, so the
 * warning can name a real reason without a classification ladder.
 */
function errnoCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
}

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
 * Failure handling splits by what actually went wrong:
 * - A file that cannot be read at all (it is missing, is a directory, or any
 *   other read error) disables observation and returns null with one stderr
 *   warning. `LLXPRT_JSP_BOOTSTRAP_FILE` is inherited by every descendant
 *   process, which can outlive the session that wrote the file, so a stale
 *   pointer is an expected condition rather than operator misconfiguration.
 *   A file that is not there carries no endpoint, so there is no off-box
 *   credential exposure to refuse — not publishing is the safe outcome.
 * - A file that reads but is wrong (malformed JSON, a non-loopback endpoint,
 *   or a protocol mismatch) still throws FatalConfigError. That file was
 *   written by an operator for this run and must still refuse loudly.
 *
 * The diagnostic messages name only the environment variable, the path (in a
 * control-character-safe escaped form), and a failure category: this file is
 * credential-bearing, and the message is written to stderr where a supervisor
 * may log it.
 */
export function loadBootstrapFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  warningSink: BootstrapWarningSink = writeBootstrapWarningToStderr,
): JspBootstrap | null {
  const filePath = env[BOOTSTRAP_ENV];
  if (filePath === undefined || filePath.length === 0) {
    return null;
  }
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    const code = errnoCodeOf(error);
    const codePart = code !== undefined ? ` (${code})` : '';
    warningSink(
      `${BOOTSTRAP_ENV} points to ${escapedPath(filePath)}, which could not be read${codePart}; observation is disabled.\n`,
    );
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new FatalConfigError(
      `JSP bootstrap file named by ${BOOTSTRAP_ENV} (${escapedPath(filePath)}) is malformed JSON`,
    );
  }
  const result = parseBootstrap(parsed);
  if (!result.ok) {
    throw new FatalConfigError(
      `JSP bootstrap file named by ${BOOTSTRAP_ENV} (${escapedPath(filePath)}) was rejected (${result.error.code})`,
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
