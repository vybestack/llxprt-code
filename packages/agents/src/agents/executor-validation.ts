/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import {
  GlobTool,
  GrepTool,
  LSTool,
  ReadFileTool,
  ReadManyFilesTool,
  RipGrepTool,
  MemoryTool,
  GoogleWebSearchTool,
} from '@vybestack/llxprt-code-tools';

/**
 * Tools that are currently approved for non-interactive execution while
 * subagent confirmation handling remains restricted to this allowlist.
 */
export const NON_INTERACTIVE_TOOL_ALLOWLIST = new Set([
  LSTool.Name,
  ReadFileTool.Name,
  GrepTool.Name,
  RipGrepTool.Name,
  GlobTool.Name,
  ReadManyFilesTool.Name,
  MemoryTool.Name,
  GoogleWebSearchTool.Name,
]);

/**
 * Validates that all tools in a registry are safe for non-interactive use.
 *
 * @throws An error if a tool is not on the allow-list for non-interactive execution.
 */
export async function validateToolsForNonInteractiveUse(
  toolRegistry: ToolRegistry,
  agentName: string,
): Promise<void> {
  for (const tool of toolRegistry.getAllTools()) {
    if (!NON_INTERACTIVE_TOOL_ALLOWLIST.has(tool.name)) {
      throw new Error(
        `Tool "${tool.name}" is not on the allow-list for non-interactive ` +
          `execution in agent "${agentName}". Only tools that do not require user ` +
          `confirmation can be used in subagents.`,
      );
    }
  }
}
