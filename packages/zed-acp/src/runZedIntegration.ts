import {
  HostCredentialOwner,
  createFileOAuthSettingsProvider,
} from '@vybestack/llxprt-code-providers/auth.js';
import { loadInstalledRuntimePlugins } from '@vybestack/llxprt-code-providers/composition.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { WorkspaceTrustControlPort } from '@vybestack/llxprt-code-core';

import type { ProfileDefinitionReads } from '@vybestack/llxprt-code-core';
import type { SettingsService } from '@vybestack/llxprt-code-settings';

import type { AgentProfileApplication } from '@vybestack/llxprt-code-agents';

import { type Config, createInkStdio } from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import * as acp from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';
import process from 'node:process';
import { ZedAgent } from './zedIntegration.js';
import type { ZedSessionProviderInputs } from './zed-session-agent.js';
import { toAcpReadableStream } from './acp-readable-stream.js';
import { KILL_GRACE_PERIOD_MS } from './zed-terminal-manager.js';

const DISPOSAL_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

/**
 * How long shutdown waits for each of its two phases (releasing the sessions,
 * then the host's exit cleanup) before giving up on it and exiting anyway.
 * Releasing a session can include killing its client-side terminals, which is
 * allowed {@link KILL_GRACE_PERIOD_MS}, so the bound leaves room for that
 * grace to run out before the wait is abandoned.
 */
export const DISPOSAL_BOUND_MS = 2 * KILL_GRACE_PERIOD_MS;

/** Exit status after SIGINT, matching the CLI's other SIGINT exits (128 + 2). */
const SIGINT_EXIT_CODE = 130;

/**
 * Listener target for process-signal-driven disposal. Injectable so tests can
 * drive the disposal path without sending real OS signals.
 */
export type SignalListenerTarget = {
  on(signal: NodeJS.Signals, listener: () => void): unknown;
  off(signal: NodeJS.Signals, listener: () => void): unknown;
};

/**
 * Outcome of waiting for work for a bounded time. `timedOut` is true when the
 * bound passed first; the work itself is not cancelled.
 */
type Bounded<T> =
  | { readonly timedOut: false; readonly value: T }
  | { readonly timedOut: true };

async function boundedBy<T>(
  work: Promise<T>,
  boundMs: number,
): Promise<Bounded<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ readonly timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), boundMs);
  });
  try {
    return await Promise.race([
      work.then((value) => ({ timedOut: false as const, value })),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Builds the disposal action performed when a disposal signal fires.
 *
 * The transport-ownership rule: {@link ndJsonStream} calls
 * `input.getReader()` on the web stream, which **locks** it. Calling
 * `.cancel()` on a locked `ReadableStream` rejects with `TypeError: Cannot
 * cancel a readable stream that is locked`, so disposal silently no-ops and
 * `connection.closed` never resolves — the process hangs.
 *
 * Instead, we destroy the **owned** Node.js `Readable` source that
 * `Readable.toWeb` wraps. Destroying the source propagates an abort/EOF into
 * the web stream's active reader, which the SDK's `ndJsonStream` read loop
 * detects (either a stream-end `{ done: true }` chunk or an underlying error).
 * That causes the SDK to call `controller.close()` / `controller.error()`,
 * resolving `connection.closed` naturally so the `finally` cleanup runs.
 */
export function buildSignalDisposalHandler(
  source: Readable,
  logger: Pick<DebugLogger, 'debug'>,
): () => void {
  return () => {
    try {
      // destroy() is idempotent and safe to call on an already-ended stream.
      // It propagates to the web stream via Readable.toWeb's adapter, causing
      // the SDK's locked reader to observe the end/error.
      source.destroy();
    } catch (error) {
      logger.debug(
        () => `Signal-driven transport destroy failed: ${String(error)}`,
      );
    }
  };
}

/**
 * Installs process-signal listeners that trigger graceful disposal. Returns a
 * disposer that removes the listeners.
 *
 * Registers listeners so Node's default SIGINT/SIGTERM behavior (immediate
 * process termination) is suppressed long enough for the `finally` cleanup in
 * {@link runZedIntegration} to run.
 */
export function installDisposalSignalHandlers(
  onSignal: (signal: NodeJS.Signals) => void,
  signals: readonly NodeJS.Signals[] = DISPOSAL_SIGNALS,
  target: SignalListenerTarget = process,
): () => void {
  const listeners = signals.map(
    (signal) => [signal, () => onSignal(signal)] as const,
  );
  for (const [signal, listener] of listeners) {
    target.on(signal, listener);
  }
  return () => {
    for (const [signal, listener] of listeners) {
      target.off(signal, listener);
    }
  };
}

export type ExitCleanupCallback = () => void | Promise<void>;

/**
 * Releases every agent, then runs the host's exit cleanup. Each phase is
 * waited for at most `disposalBoundMs`: a session that cannot finish its
 * shutdown (a tool call that will not stop, a client that no longer answers)
 * must not keep the process from ending.
 */
export async function cleanupAgents(
  agents: readonly ZedAgent[],
  logger: DebugLogger,
  onExitCleanup: ExitCleanupCallback | undefined = undefined,
  disposalBoundMs: number = DISPOSAL_BOUND_MS,
): Promise<void> {
  const disposal = await boundedBy(
    Promise.allSettled(agents.map((agent) => agent.disposeAll())),
    disposalBoundMs,
  );
  if (disposal.timedOut) {
    logger.warn(
      () => `Zed agent cleanup did not finish within ${disposalBoundMs} ms`,
    );
  } else {
    const rejected = disposal.value.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    for (const result of rejected) {
      logger.warn(() => `Zed agent cleanup failed: ${String(result.reason)}`);
    }
  }
  try {
    const exitCleanup = await boundedBy(
      (async () => onExitCleanup?.())(),
      disposalBoundMs,
    );
    if (exitCleanup.timedOut) {
      logger.warn(
        () => `Zed exit cleanup did not finish within ${disposalBoundMs} ms`,
      );
    }
  } catch (cleanupError) {
    logger.debug(() => `Exit cleanup failed: ${String(cleanupError)}`);
  }
}

export interface ZedConnectionOwner {
  readonly trustPort: WorkspaceTrustControlPort;
  readonly profileDefinitions: Pick<ProfileDefinitionReads, 'listProfiles'>;
  readonly createSessionSettings: () => SettingsService;
  readonly config: Config;
  readonly profileApplication: AgentProfileApplication;
  readonly providerInputs?: ZedSessionProviderInputs;
}

export async function serveZedConnection(
  owner: ZedConnectionOwner,
  stream: acp.Stream,
  onExitCleanup?: ExitCleanupCallback,
): Promise<void> {
  const logger = new DebugLogger('llxprt:zed-integration');
  const agents: ZedAgent[] = [];
  try {
    const connection = new acp.AgentSideConnection((conn) => {
      const agent = new ZedAgent(
        owner.config,
        conn,
        owner.profileApplication,
        owner.createSessionSettings,
        undefined,
        owner.profileDefinitions,
        owner.trustPort,
        owner.providerInputs,
      );
      agents.push(agent);
      return agent;
    }, stream);
    await connection.closed;
  } finally {
    await cleanupAgents(agents, logger, onExitCleanup);
  }
}

async function discoverZedSessionProviderInputs(): Promise<ZedSessionProviderInputs> {
  return {
    credentialAuthority: new HostCredentialOwner(process.env).authority,
    providerContributions: await loadInstalledRuntimePlugins(),
    oauthSettings: createFileOAuthSettingsProvider(),
  };
}

export async function runZedIntegration(
  config: Config,
  profileApplication: AgentProfileApplication,
  options: {
    profileDefinitions: ZedConnectionOwner['profileDefinitions'];
    trustPort: ZedConnectionOwner['trustPort'];
    createSessionSettings: () => SettingsService;
    onExitCleanup?: ExitCleanupCallback;
    /**
     * Installed provider contributions and OAuth settings for session provider
     * assembly. Omitted: contributions are discovered from the installed
     * runtime plugins and OAuth enablement is read from the user settings file.
     */
    providerInputs?: ZedSessionProviderInputs;
  },
): Promise<void> {
  const logger = new DebugLogger('llxprt:zed-integration');
  logger.debug(() => 'Starting Zed integration');
  const { stdout: workingStdout } = createInkStdio();
  const stdout = Writable.toWeb(workingStdout) as WritableStream;
  // Keep the owned Node.js Readable reference. Destroying this source (not the
  // locked web stream) is the only way to make the ACP ndJsonStream reader
  // observe EOF/abort so connection.closed settles.
  const stdinSource = process.stdin;
  const stdin = toAcpReadableStream(Readable.toWeb(stdinSource));
  const owner: ZedConnectionOwner = {
    config,
    profileApplication,
    profileDefinitions: options.profileDefinitions,
    trustPort: options.trustPort,
    createSessionSettings: options.createSessionSettings,
    providerInputs:
      options.providerInputs ?? (await discoverZedSessionProviderInputs()),
  };
  const destroyTransport = buildSignalDisposalHandler(stdinSource, logger);
  let disposalSignal: NodeJS.Signals | undefined;
  const removeSignalHandlers = installDisposalSignalHandlers((signal) => {
    disposalSignal ??= signal;
    destroyTransport();
  });
  try {
    await serveZedConnection(
      owner,
      acp.ndJsonStream(stdout, stdin),
      options.onExitCleanup,
    );
  } catch (error) {
    logger.warn(() => `Zed agent connection error: ${error}`);
    throw error;
  } finally {
    removeSignalHandlers();
  }
  // The connection is over and cleanup has run (or been given up on). Other
  // handles, such as a provider's open connection, must not keep the process
  // running after that, so end it here instead of waiting for the event loop
  // to drain.
  process.exit(disposalSignal === 'SIGINT' ? SIGINT_EXIT_CODE : 0);
}
