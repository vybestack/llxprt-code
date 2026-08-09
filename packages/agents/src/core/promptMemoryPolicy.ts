/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';

/**
 * The memory inputs derived for a system-prompt assembly.
 *
 * `userMemory`, `coreMemory`, and `mcpInstructions` map one-to-one onto the
 * options consumed by `getCoreSystemPromptAsync`. Core memory and MCP
 * instructions are kept as separate channels so MCP instructions are never
 * folded into user memory — which under JIT would otherwise deliver them twice
 * (environment memory already carries the MCP block).
 */
export interface PromptMemoryInputs {
  readonly userMemory: string | undefined;
  readonly coreMemory: string | undefined;
  readonly mcpInstructions: string | undefined;
}

/**
 * Derives the user/core/MCP memory inputs for a system prompt from a single
 * shared policy. Both the main-agent and subagent prompt builders consume this
 * so JIT memory sourcing is identical across execution contexts (issue #3173).
 *
 * JIT enabled: user memory is `getGlobalMemory()` (which excludes environment
 * memory) plus the JIT subdirectory memory for the configured working
 * directory, joined with the existing two-newline separator. JIT disabled:
 * user memory is `getUserMemory()` unchanged. Core memory comes from
 * `getCoreMemory()` and MCP instructions from `getMcpInstructions()`, each
 * through its own channel.
 */
export async function resolvePromptMemory(
  config: Config,
): Promise<PromptMemoryInputs> {
  let userMemory = config.isJitContextEnabled()
    ? config.getGlobalMemory()
    : config.getUserMemory();
  // Core memory is captured before the JIT await to match the pre-extraction
  // main-builder ordering: under a concurrent core-memory refresh, reading it
  // after the await would change main-agent prompt bytes (issue #3173).
  const coreMemory = config.getCoreMemory();
  const jitMemory = await config.getJitMemoryForPath(config.getWorkingDir());
  if (jitMemory) {
    userMemory = userMemory ? `${userMemory}\n\n${jitMemory}` : jitMemory;
  }
  return {
    userMemory,
    coreMemory,
    // MCP instructions remain acquired after the JIT await, preserving the
    // original main-agent access ordering.
    mcpInstructions: config.getMcpInstructions(),
  };
}
