/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { WorkspaceTrustControlPort } from '@vybestack/llxprt-code-core';

import type { ProfileDefinitionReads } from '@vybestack/llxprt-code-core';
import type { SettingsService } from '@vybestack/llxprt-code-settings';

import type { AgentProfileApplication } from '@vybestack/llxprt-code-agents';

import {
  type Config,
  type RuntimeProviderManager,
  createInkStdio,
} from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import * as acp from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';
import * as process from 'node:process';
import { ZedAgent } from './zedIntegration.js';
import type { ZedSessionProviderInputs } from './zed-session-agent.js';

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

export type ExitCleanupCallback = () => void | Promise<void>;

export async function cleanupAgents(
  agents: readonly ZedAgent[],
  logger: DebugLogger,
  onExitCleanup: ExitCleanupCallback | undefined = undefined,
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
    await onExitCleanup?.();
  } catch (cleanupError) {
    logger.debug(() => `Exit cleanup failed: ${String(cleanupError)}`);
  }
}

export interface ZedConnectionOwner {
  readonly trustPort: WorkspaceTrustControlPort;
  readonly profileDefinitions: Pick<ProfileDefinitionReads, 'listProfiles'>;
  readonly createSessionSettings: () => SettingsService;
  readonly config: Config;
  readonly providerManager: RuntimeProviderManager;
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
        owner.providerManager,
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
  const [{ loadInstalledRuntimePlugins }, { createFileOAuthSettingsProvider }] =
    await Promise.all([
      import('@vybestack/llxprt-code-providers/composition.js'),
      import('@vybestack/llxprt-code-providers/auth.js'),
    ]);
  return {
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
    providerManager: RuntimeProviderManager;
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
  const stdin = Readable.toWeb(stdinSource) as ReadableStream<Uint8Array>;
  const owner: ZedConnectionOwner = {
    config,
    profileApplication,
    profileDefinitions: options.profileDefinitions,
    trustPort: options.trustPort,
    providerManager: options.providerManager,
    createSessionSettings: options.createSessionSettings,
    providerInputs:
      options.providerInputs ?? (await discoverZedSessionProviderInputs()),
  };
  const removeSignalHandlers = installDisposalSignalHandlers(
    buildSignalDisposalHandler(stdinSource, logger),
  );
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
}
