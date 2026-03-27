/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AnyDeclarativeTool } from '../tools/tools.js';
import type { ContextAwareTool } from '../tools/tool-context.js';

/**
 * Sets the execution context on a ContextAwareTool instance if the tool
 * supports it. No-op for tools that do not implement the context interface.
 */
export function setToolContext(
  tool: AnyDeclarativeTool,
  sessionId: string,
  agentId: string,
  interactiveMode: boolean,
): void {
  if ('context' in tool) {
    (tool as ContextAwareTool).context = {
      sessionId,
      agentId,
      interactiveMode,
    };
  }
}
