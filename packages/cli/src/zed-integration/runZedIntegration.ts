/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Config, createInkStdio } from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import * as acp from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';
import * as process from 'node:process';
import { setCliRuntimeContext } from '@vybestack/llxprt-code-providers/runtime.js';
import type { LoadedSettings } from '../config/settings.js';
import { runExitCleanup } from '../utils/cleanup.js';
import { ZedAgent } from './zedIntegration.js';

const DISPOSAL_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

/**
 * Listener target for process-signal-driven disposal. Injectable so tests can
 * drive the disposal path without sending real OS signals.
 */
export type SignalListenerTarget = {
  on(signal: NodeJS.Signals, listener: () => void): unknown;
  off(signal: NodeJS.Signals, listener: () => void): unknown;
};

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
  onSignal: () => void,
  signals: readonly NodeJS.Signals[] = DISPOSAL_SIGNALS,
  target: SignalListenerTarget = process,
): () => void {
  for (const signal of signals) {
    target.on(signal, onSignal);
  }
  return () => {
    for (const signal of signals) {
      target.off(signal, onSignal);
    }
  };
}

async function cleanupAgents(
  agents: readonly ZedAgent[],
  logger: DebugLogger,
): Promise<void> {
  const disposalResults = await Promise.allSettled(
    agents.map((agent) => agent.disposeAll()),
  );
  const rejected = disposalResults.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  for (const result of rejected) {
    logger.warn(() => `Zed agent cleanup failed: ${String(result.reason)}`);
  }
  try {
    await runExitCleanup();
  } catch (cleanupError) {
    logger.debug(() => `Exit cleanup failed: ${String(cleanupError)}`);
  }
}

export async function runZedIntegration(
  config: Config,
  settings: LoadedSettings,
): Promise<void> {
  const logger = new DebugLogger('llxprt:zed-integration');
  logger.debug(() => 'Starting Zed integration');
  const { stdout: workingStdout } = createInkStdio();
  const stdout = Writable.toWeb(workingStdout) as WritableStream;
  // Keep the owned Node.js Readable reference. Destroying this source (not the
  // locked web stream) is the only way to make the ACP ndJsonStream reader
  // observe EOF/abort so connection.closed settles.
  const stdinSource = process.stdin;
  const stdin = Readable.toWeb(stdinSource) as ReadableStream<Uint8Array>;
  setCliRuntimeContext(config.getSettingsService(), config, {
    runtimeId: 'cli.runtime.zed',
    metadata: { source: 'zed-integration', stage: 'bootstrap' },
    allowDefaultHandoff: true,
  });
  const agents: ZedAgent[] = [];
  const removeSignalHandlers = installDisposalSignalHandlers(
    buildSignalDisposalHandler(stdinSource, logger),
  );
  try {
    const stream = acp.ndJsonStream(stdout, stdin);
    const connection = new acp.AgentSideConnection((conn) => {
      const agent = new ZedAgent(config, settings, conn);
      agents.push(agent);
      return agent;
    }, stream);
    await connection.closed;
  } catch (error) {
    logger.warn(() => `Zed agent connection error: ${error}`);
    throw error;
  } finally {
    removeSignalHandlers();
    await cleanupAgents(agents, logger);
  }
}
