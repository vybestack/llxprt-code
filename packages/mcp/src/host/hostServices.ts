/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Capabilities this package needs from whatever host embeds it (#3305).
 *
 * `mcp` sits below `core` in the dependency graph: `core` value-imports
 * `McpClientManager`, `KeychainTokenStorage` and `DiscoveredMCPTool`. Reaching
 * back up for a user-feedback channel and a browser launcher made the edge
 * bidirectional, which is what let the published package ship declaring `core`
 * in `devDependencies` while importing it at runtime.
 *
 * So the dependency is inverted rather than declared: this package states what
 * it needs, and the host registers implementations during startup. Nothing here
 * imports `core`.
 *
 * Standalone defaults preserve the existing fallback behavior when a host has
 * not registered either capability:
 *
 * - Feedback is advisory. The default routes to the debug logger so the
 *   information still reaches a log, just not the UI.
 * - The browser launcher is already best-effort at every call site; the OAuth
 *   flow prints the authorization URL for manual paste *before* attempting to
 *   open a browser, and wraps the attempt in a try/catch. The default
 *   preserves exactly that documented fallback.
 *
 * This mirrors `OAuthUIBridge` in `@vybestack/llxprt-code-auth`, which solves
 * the same problem for the OAuth UI channel.
 */

import { debugLogger } from '@vybestack/llxprt-code-telemetry/utils/debugLogger.js';

/**
 * Name of the event this package emits on the host-supplied emitter whenever
 * the set of connected MCP clients changes.
 *
 * Owned here because this package is the only emitter; the host merely
 * listens. `CoreEvent.McpClientUpdate` in `core` must carry the same string,
 * which is pinned by a test rather than left to coincidence.
 */
export const MCP_CLIENT_UPDATE_EVENT = 'mcp-client-update';

/** Severity of a user-facing feedback message. */
export type HostFeedbackSeverity = 'info' | 'warning' | 'error';

/** Surfaces an advisory message to the user. */
export type HostFeedbackSink = (
  severity: HostFeedbackSeverity,
  message: string,
  error?: unknown,
) => void;

/** Opens a URL in the user's browser. Rejects if it cannot. */
export type HostBrowserLauncher = (url: string) => Promise<void>;

/** The host capabilities this package consumes. */
export interface McpHostServices {
  readonly emitFeedback: HostFeedbackSink;
  readonly openBrowser: HostBrowserLauncher;
}

const defaultFeedbackSink: HostFeedbackSink = (severity, message, error) => {
  const detail = error === undefined ? message : `${message}: ${String(error)}`;
  if (severity === 'error') {
    debugLogger.error(() => `[mcp] ${detail}`);
    return;
  }
  if (severity === 'warning') {
    debugLogger.warn(() => `[mcp] ${detail}`);
    return;
  }
  debugLogger.debug(() => `[mcp] ${detail}`);
};

const defaultBrowserLauncher: HostBrowserLauncher = () =>
  Promise.reject(new Error('No browser launcher registered by the host'));

let services: McpHostServices = {
  emitFeedback: defaultFeedbackSink,
  openBrowser: defaultBrowserLauncher,
};

/**
 * Registers host implementations, replacing any previously registered ones.
 *
 * Partial registration is supported so a host can supply only what it has;
 * unspecified capabilities keep their current implementation.
 */
export function registerMcpHostServices(
  overrides: Partial<McpHostServices>,
): void {
  services = { ...services, ...overrides };
}

/** Restores the built-in defaults. Intended for test isolation. */
export function resetMcpHostServices(): void {
  services = {
    emitFeedback: defaultFeedbackSink,
    openBrowser: defaultBrowserLauncher,
  };
}

/**
 * Sends advisory feedback to the user via the host.
 *
 * Never throws: a host callback that fails must not take down the MCP
 * operation that was merely reporting on itself.
 */
export function emitHostFeedback(
  severity: HostFeedbackSeverity,
  message: string,
  ...rest: [error?: unknown]
): void {
  try {
    // `error` is forwarded through a rest parameter rather than a named
    // optional so the sink observes the caller's exact arity. Naming it and
    // passing it positionally appends an explicit `undefined` to every
    // two-argument call, which callers can observe.
    services.emitFeedback(severity, message, ...rest);
  } catch (sinkError) {
    debugLogger.error(
      () => `[mcp] host feedback sink threw: ${String(sinkError)}`,
    );
  }
}

/** Opens a URL via the host launcher. Rejects if the host cannot. */
export function openHostBrowser(url: string): Promise<void> {
  return services.openBrowser(url);
}
