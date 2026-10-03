/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { debugLogger } from '@vybestack/llxprt-code-telemetry/utils/debugLogger.js';

/** Emitted on the host's event emitter whenever the connected clients change. */
export const MCP_CLIENT_UPDATE_EVENT = 'mcp-client-update';

export type HostFeedbackSeverity = 'info' | 'warning' | 'error';
export type HostFeedbackSink = (
  severity: HostFeedbackSeverity,
  message: string,
  error?: unknown,
) => void;
export type HostBrowserLauncher = (url: string) => Promise<void>;

/** Ports owned by the embedding host, captured by each MCP client and auth flow. */
export interface McpHostServices {
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
  } else if (severity === 'warning') {
    debugLogger.warn(() => `[mcp] ${detail}`);
  } else {
    debugLogger.debug(() => `[mcp] ${detail}`);
  }
};

export const defaultHostServices: Readonly<McpHostServices> = Object.freeze({
  emitFeedback: defaultFeedbackSink,
  openBrowser: (_url: string): Promise<void> =>
    Promise.reject(new Error('No browser launcher registered by the host')),
});

/** Advisory feedback must never interrupt the underlying MCP operation. */
export function deliverHostFeedback(
  sink: HostFeedbackSink,
  severity: HostFeedbackSeverity,
  message: string,
  ...rest: [error?: unknown]
): void {
  try {
    sink(severity, message, ...rest);
  } catch (error) {
    debugLogger.error(() => `[mcp] host feedback sink threw: ${String(error)}`);
  }
}
