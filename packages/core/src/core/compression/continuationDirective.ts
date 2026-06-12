/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260610-ISSUE1592.P03
 *
 * buildContinuationDirective extracted from compression/utils.ts (which moves
 * to agents) because CLI integration tests import it from core's root barrel.
 * It is a pure string-building util with no chat-loop deps.
 */

/**
 * Build a context-aware continuation directive to replace the static
 * compression acknowledgment. When active tasks exist the directive
 * references the first task and points the model at the read tool for
 * full recovery; otherwise it emits a simple "continue" statement.
 */
export function buildContinuationDirective(
  activeTodos?: string,
  lastUserPromptContext?: string,
): string {
  const hasPromptContext =
    lastUserPromptContext !== undefined &&
    lastUserPromptContext.trim().length > 0;
  const promptPart = hasPromptContext
    ? ` The user's most recent request: "${lastUserPromptContext.trim()}".`
    : '';

  if (activeTodos && activeTodos.trim().length > 0) {
    const firstTask = extractFirstTaskContent(activeTodos);
    if (firstTask) {
      return `Understood.${promptPart} Continue with current task: "${firstTask}". Use todo_read for full context.`;
    }
  }

  if (hasPromptContext) {
    return `Understood.${promptPart} Continuing with the current task.`;
  }

  return 'Understood. Continuing with the current task.';
}

/**
 * Extract the content description from the first line of a formatted
 * active-todos string. Expected format per line:
 *   `- [status] description text`
 */
function extractFirstTaskContent(activeTodos: string): string | undefined {
  const firstLine = activeTodos.trim().split('\n')[0];
  if (!firstLine) return undefined;

  const firstCloseBracket = firstLine.indexOf(']');
  if (firstCloseBracket === -1) {
    return firstLine.trim() || undefined;
  }

  const task = firstLine.slice(firstCloseBracket + 1).trim();
  return task.length > 0 ? task : undefined;
}
