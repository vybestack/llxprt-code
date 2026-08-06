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

/**
 * The public argv token for the bootstrap flag and the hidden internal token
 * used to transport an env-origin path across a direct-replacement relaunch
 * (memory or sandbox hop) without restoring the variable to the environment.
 */
const BOOTSTRAP_ARGV_FLAG = '--jsp-bootstrap';
const INTERNAL_ENV_PATH_ARGV_FLAG = '--jsp-bootstrap-internal-env-path';

/**
 * The channel that supplied the bootstrap path, surfaced in failure
 * diagnostics so the message names the real source (`--jsp-bootstrap` or
 * `LLXPRT_JSP_BOOTSTRAP_FILE`) instead of always blaming one.
 */
export type BootstrapSource = typeof BOOTSTRAP_ARGV_FLAG | typeof BOOTSTRAP_ENV;

/**
 * The resolved bootstrap selection: the non-empty path plus the channel that
 * supplied it. Produced once, after argument parsing, and threaded explicitly
 * through startup so the credential-bearing file is validated later
 * (fail-fast) while the env scrub happens at process start.
 */
export interface BootstrapSelection {
  readonly path: string;
  readonly source: BootstrapSource;
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
 * Capture `LLXPRT_JSP_BOOTSTRAP_FILE` from `env` and delete it unconditionally,
 * before any file I/O. This must be the FIRST executable action in `main()` —
 * before `configureEarlyDebugLogging`, help/version handling, process lifecycle
 * setup, settings load, memory relaunch, or yargs parsing — because all of
 * those paths can spawn or replace the process (memory relaunch clones
 * `process.env`; MCP subcommand handlers start stdio transports that clone
 * `process.env`; help/version can `process.exit` before later scrubbing would
 * run). Descendants (subagents, shell tools, test runners, MCP servers) would
 * otherwise inherit a per-session, identity-bearing pointer to a file that
 * carries another process's `agentId` / `lifecycleGeneration` and may already
 * have been rotated away (issues #3083 and #3082).
 *
 * The deletion is unconditional: whether the value was non-empty, empty, or
 * absent. No credential-bearing file is read here; validation is deferred to
 * {@link loadBootstrap} at observation setup (fail-fast). Returns the non-empty
 * path for later resolution, or `undefined` when the variable was absent/empty.
 */
export function captureBootstrapEnvPath(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const envPath = env[BOOTSTRAP_ENV];
  delete env[BOOTSTRAP_ENV];
  if (envPath !== undefined && envPath.length > 0) {
    return envPath;
  }
  return undefined;
}

/**
 * Resolve the bootstrap selection AFTER argument parsing from the three
 * candidate paths. Precedence (highest to lowest):
 *
 * 1. Public `--jsp-bootstrap` flag (non-empty) → source `--jsp-bootstrap`.
 * 2. Hidden `--jsp-bootstrap-internal-env-path` (transported across a memory
 *    or sandbox direct-replacement relaunch) → source `LLXPRT_JSP_BOOTSTRAP_FILE`.
 * 3. The path captured at process start by {@link captureBootstrapEnvPath}
 *    → source `LLXPRT_JSP_BOOTSTRAP_FILE`.
 * 4. `null` (observation disabled).
 *
 * This is a pure function: the environment has already been scrubbed at
 * process start, so this never touches `process.env`.
 */
export function resolveBootstrapSelection(
  flagPath: string | undefined,
  internalEnvPath: string | undefined,
  capturedEnvPath: string | undefined,
): BootstrapSelection | null {
  if (typeof flagPath === 'string' && flagPath.length > 0) {
    return { path: flagPath, source: BOOTSTRAP_ARGV_FLAG };
  }
  if (typeof internalEnvPath === 'string' && internalEnvPath.length > 0) {
    return { path: internalEnvPath, source: BOOTSTRAP_ENV };
  }
  if (typeof capturedEnvPath === 'string' && capturedEnvPath.length > 0) {
    return { path: capturedEnvPath, source: BOOTSTRAP_ENV };
  }
  return null;
}

/**
 * Transport a non-secret env-origin bootstrap path into a child process argv
 * for a direct-replacement relaunch (memory or sandbox hop). The env variable
 * is never restored to the outer process environment; only the nonsecret path
 * travels via the hidden internal argv option. No credential contents are
 * transported — the credential remains inside the mode-0600 bootstrap file.
 *
 * The hidden option is inserted immediately BEFORE the first exact `--`
 * terminator (or appended if absent) so yargs treats it as a flag, not a
 * positional, in both launch and subcommand contexts. Every original argv
 * element is preserved. Transport is not duplicated when the option is already
 * present (e.g. a prior memory hop already added it). A flag-origin selection
 * is already in argv as `--jsp-bootstrap` and is not re-transported.
 */
export function augmentArgvWithInternalEnvPath(
  argv: readonly string[],
  envPath: string | undefined,
): string[] {
  if (envPath === undefined) {
    return [...argv];
  }
  if (argv.includes(INTERNAL_ENV_PATH_ARGV_FLAG)) {
    return [...argv];
  }
  const insert = [INTERNAL_ENV_PATH_ARGV_FLAG, envPath];
  const terminatorIndex = argv.indexOf('--');
  if (terminatorIndex === -1) {
    return [...argv, ...insert];
  }
  return [
    ...argv.slice(0, terminatorIndex),
    ...insert,
    ...argv.slice(terminatorIndex),
  ];
}

/**
 * Read, parse, and schema-validate the JSP bootstrap file named by an
 * already-consumed selection.
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
 * The messages name the channel that supplied the path (`--jsp-bootstrap` or
 * `LLXPRT_JSP_BOOTSTRAP_FILE`) — taken from the selection's `source` — and the
 * failure category only: this file is credential-bearing, and the message is
 * written to stderr where a supervisor may log it. The environment has already
 * been scrubbed by {@link captureBootstrapEnvPath}, so this function never
 * touches `process.env`.
 */
export function loadBootstrap(
  selection: BootstrapSelection | null,
): JspBootstrap | null {
  if (selection === null) {
    return null;
  }
  const filePath = selection.path;
  const source = selection.source;
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    throw new FatalConfigError(
      `JSP bootstrap file named by ${source} could not be read`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new FatalConfigError(
      `JSP bootstrap file named by ${source} is malformed JSON`,
    );
  }
  const result = parseBootstrap(parsed);
  if (!result.ok) {
    throw new FatalConfigError(
      `JSP bootstrap file named by ${source} was rejected (${result.error.code})`,
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
  selection: BootstrapSelection | null,
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
  producer = createObservationProducer(loadBootstrap(selection), context);
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
