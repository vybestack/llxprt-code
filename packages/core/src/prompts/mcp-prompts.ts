/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WorkspacePromptSelection } from '../services/workspace-mcp-catalog-owner.js';
import { type DiscoveredMCPPrompt } from '@vybestack/llxprt-code-mcp';

export function getMCPServerPrompts(
  selection: WorkspacePromptSelection,
  serverName: string,
): DiscoveredMCPPrompt[] {
  return selection.listPrompts(serverName);
}
