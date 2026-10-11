/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ToolRegistry } from '../tools/tool-registry.js';

export type ToolLookup = Pick<ToolRegistry, 'getTool' | 'getAllToolNames'>;
export type ToolSelection = Pick<
  ToolRegistry,
  | 'getTool'
  | 'getAllToolNames'
  | 'getAllTools'
  | 'getEnabledTools'
  | 'getFunctionDeclarations'
  | 'getFunctionDeclarationsFiltered'
>;
export type McpToolPublication = Pick<
  ToolRegistry,
  'registerTool' | 'removeMcpToolsByServer' | 'sortTools'
>;
export type ToolPublication = Pick<
  ToolRegistry,
  'registerTool' | 'unregisterTool'
>;
