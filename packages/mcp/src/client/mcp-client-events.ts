/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry/debug/index.js';

const logger = DebugLogger.getLogger('llxprt:core:tools:mcp-client');

export function attachMcpConnectionHandlers(
  client: Client,
  serverName: string,
  isCurrent: () => boolean,
  disconnected: () => void,
): void {
  const originalOnClose = client.onclose;
  client.onclose = () => {
    try {
      originalOnClose?.();
    } finally {
      if (isCurrent()) disconnected();
    }
  };
  const originalOnError = client.onerror;
  client.onerror = (error) => {
    if (!isCurrent()) return;
    try {
      originalOnError?.(error);
    } catch (handlerError) {
      logger.warn(
        `Original MCP error handler failed for ${serverName}:`,
        handlerError,
      );
    }
    logger.error(`MCP ERROR (${serverName}):`, error.toString());
    try {
      disconnected();
    } catch (statusError) {
      logger.warn(`MCP status listener failed for ${serverName}:`, statusError);
    }
    void client.close().catch(() => {});
  };
}
