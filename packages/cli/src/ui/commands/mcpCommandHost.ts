/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { McpCommandOperations } from './mcpCommand.js';

export function bindMcpCommand(
  isConfigured: boolean,
  status: McpCommandOperations['status'],
  addItem: McpCommandOperations['addItem'],
  reloadCommands: () => void,
  reload: () => Promise<void>,
  refresh: () => Promise<void>,
): McpCommandOperations {
  return { isConfigured, status, reload, refresh, addItem, reloadCommands };
}
