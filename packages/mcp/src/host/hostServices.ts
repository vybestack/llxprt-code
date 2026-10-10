import type { McpAuthFactoryRegistry } from '../auth/mcp-auth-factory.js';
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
 * The host passes capabilities to its MCP runtime owner explicitly. Nothing
 * here imports `core`.
 *
 * Standalone defaults apply when an owner does not supply a capability:
 * feedback goes to the debug logger, and browser launching rejects. The OAuth
 * flow prints the authorization URL for manual paste before opening a browser.
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
  readonly getAuthProviderFactory?: McpAuthFactoryRegistry['getAuthProviderFactory'];
  readonly emitFeedback: HostFeedbackSink;
  readonly openBrowser: HostBrowserLauncher;
}

export const defaultFeedbackSink: HostFeedbackSink = (
  severity,
  message,
  error,
) => {
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

export const defaultBrowserLauncher: HostBrowserLauncher = () =>
  Promise.reject(new Error('No browser launcher registered by the host'));

export function captureHostFeedback(
  sink: HostFeedbackSink = defaultFeedbackSink,
): HostFeedbackSink {
  return (...args): void => {
    try {
      sink(...args);
    } catch (sinkError) {
      debugLogger.error(
        () => `[mcp] host feedback sink threw: ${String(sinkError)}`,
      );
    }
  };
}
