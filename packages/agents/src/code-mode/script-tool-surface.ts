/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which tools a code mode script may request (issue #4084). The v1 surface
 * is a fixed set of read and search tools plus foreground shell; everything
 * else (writes, task, the code mode tools themselves, todos, memory, web,
 * MCP) is refused. The surface is intersected with what the calling session
 * or subagent admits, so code mode never widens a caller's tool access.
 */

import { isToolBlocked } from '@vybestack/llxprt-code-tools';
import { canonicalizeToolName } from '../core/toolGovernance.js';
import type { NestedExecutionComposition } from '../scheduler/nested-execution.js';

export const EXECUTE_TOOL_SCRIPT = 'execute_tool_script';
export const DISCOVER_TOOL_API = 'discover_tool_api';

export const SCRIPT_CALLABLE_TOOLS: readonly string[] = Object.freeze([
  'read_file',
  'read_many_files',
  'read_line_range',
  'ast_read_file',
  'list_directory',
  'glob',
  'search_file_content',
  'ast_grep',
  'structural_analysis',
  'run_shell_command',
]);

const RECURSIVE_TOOLS = new Set([
  EXECUTE_TOOL_SCRIPT,
  DISCOVER_TOOL_API,
  'task',
]);

export type ScriptToolPreflight =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        | 'INVALID_TOOLS'
        | 'TOOL_NOT_SCRIPTABLE'
        | 'TOOL_NOT_ADMITTED';
      readonly message: string;
    };

function notScriptable(name: string): ScriptToolPreflight {
  const reason = RECURSIVE_TOOLS.has(name)
    ? 'it starts scripts or agents, which scripts cannot do'
    : 'it is not in the script-callable tool set';
  return {
    ok: false,
    code: 'TOOL_NOT_SCRIPTABLE',
    message: `Scripts cannot call "${name}": ${reason} (${SCRIPT_CALLABLE_TOOLS.join(', ')}).`,
  };
}

function admitted(
  name: string,
  composition: Pick<NestedExecutionComposition, 'selection' | 'readGovernance'>,
  hookRestrictedAllowedTools: readonly string[] | undefined,
): boolean {
  if (isToolBlocked(name, composition.readGovernance())) return false;
  if (composition.selection.getTool(name) === undefined) return false;
  return (
    hookRestrictedAllowedTools === undefined ||
    hookRestrictedAllowedTools
      .map(canonicalizeToolName)
      .includes(canonicalizeToolName(name))
  );
}

/**
 * The script-callable tools this caller admits, in the v1 set's order: what
 * `discover_tool_api` lists and what the API revision covers.
 */
export function admittedScriptTools(
  composition: Pick<NestedExecutionComposition, 'selection' | 'readGovernance'>,
  hookRestrictedAllowedTools: readonly string[] | undefined,
): string[] {
  return SCRIPT_CALLABLE_TOOLS.filter((name) =>
    admitted(name, composition, hookRestrictedAllowedTools),
  );
}

/**
 * Checks the exact list a script asked for before it starts. Every name must
 * be script-callable and admitted for this caller; nothing is silently
 * dropped. A script that calls no tools lists none.
 */
export function preflightScriptTools(
  requested: readonly string[],
  composition: NestedExecutionComposition,
  hookRestrictedAllowedTools: readonly string[] | undefined,
): ScriptToolPreflight {
  if (new Set(requested).size !== requested.length)
    return {
      ok: false,
      code: 'INVALID_TOOLS',
      message: '"tools" must list each tool the script calls exactly once.',
    };
  for (const name of requested) {
    if (!SCRIPT_CALLABLE_TOOLS.includes(name)) return notScriptable(name);
    if (!admitted(name, composition, hookRestrictedAllowedTools))
      return {
        ok: false,
        code: 'TOOL_NOT_ADMITTED',
        message: `"${name}" is not available to this session or agent, so its scripts cannot call it.`,
      };
  }
  return { ok: true };
}
