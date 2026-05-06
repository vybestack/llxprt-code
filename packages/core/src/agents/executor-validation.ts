/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolRegistry } from '../tools/tool-registry.js';
import { GlobTool } from '../tools/glob.js';
import { GrepTool } from '../tools/grep.js';
import { RipGrepTool } from '../tools/ripGrep.js';
import { LSTool } from '../tools/ls.js';
import { MemoryTool } from '../tools/memoryTool.js';
import { ReadFileTool } from '../tools/read-file.js';
import { ReadManyFilesTool } from '../tools/read-many-files.js';
import { GoogleWebSearchTool } from '../tools/google-web-search.js';

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
