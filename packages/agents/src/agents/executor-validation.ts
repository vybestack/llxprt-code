/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolRegistry } from '@vybestack/llxprt-code-core/tools/tool-registry.js';
import { GlobTool } from '@vybestack/llxprt-code-core/tools/glob.js';
import { GrepTool } from '@vybestack/llxprt-code-core/tools/grep.js';
import { RipGrepTool } from '@vybestack/llxprt-code-core/tools/ripGrep.js';
import { LSTool } from '@vybestack/llxprt-code-core/tools/ls.js';
import { MemoryTool } from '@vybestack/llxprt-code-core/tools/memoryTool.js';
import { ReadFileTool } from '@vybestack/llxprt-code-core/tools/read-file.js';
import { ReadManyFilesTool } from '@vybestack/llxprt-code-core/tools/read-many-files.js';
import { GoogleWebSearchTool } from '@vybestack/llxprt-code-core/tools/google-web-search.js';

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
