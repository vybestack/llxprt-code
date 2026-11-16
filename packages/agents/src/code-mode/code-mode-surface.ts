/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a session or subagent shows of the code mode tools (issue #4084).
 *
 * Off: `execute_tool_script` and `discover_tool_api` are absent from every
 * lookup, list and declaration, as if never registered.
 *
 * On, `alongside`: everything is advertised.
 *
 * On, `compact`: only the code mode tools and the direct control tools are
 * advertised to the model. Lookups are unchanged, so the hidden read/search
 * tools stay authorized and scripts can still call them.
 */

import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import type { CodeModeSettings } from './code-mode-settings.js';
import {
  DISCOVER_TOOL_API,
  EXECUTE_TOOL_SCRIPT,
} from './script-tool-surface.js';

export const CODE_MODE_TOOL_NAMES: readonly string[] = Object.freeze([
  EXECUTE_TOOL_SCRIPT,
  DISCOVER_TOOL_API,
]);

/**
 * Tools still advertised with the compact surface: the work a script cannot
 * do (file writes and edits, memory), the loop's own control tools (todos,
 * pause, skills) and delegation (task and its helpers).
 */
export const COMPACT_DIRECT_TOOLS: readonly string[] = Object.freeze([
  'todo_write',
  'todo_read',
  'todo_pause',
  'task',
  'list_subagents',
  'check_async_tasks',
  'activate_skill',
  'write_file',
  'replace',
  'apply_patch',
  'insert_at_line',
  'delete_line_range',
  'ast_edit',
  'save_memory',
]);

function hidden(name: string | undefined, settings: CodeModeSettings): boolean {
  return (
    !settings.enabled &&
    name !== undefined &&
    CODE_MODE_TOOL_NAMES.includes(name)
  );
}

function advertised(
  name: string | undefined,
  settings: CodeModeSettings,
): boolean {
  if (name === undefined) return false;
  if (hidden(name, settings)) return false;
  if (!settings.enabled || settings.surface === 'alongside') return true;
  return (
    CODE_MODE_TOOL_NAMES.includes(name) || COMPACT_DIRECT_TOOLS.includes(name)
  );
}

/** The declarations the model is offered under the current settings. */
export function advertisedDeclarations<T extends { readonly name?: string }>(
  declarations: readonly T[],
  settings: CodeModeSettings,
): T[] {
  return declarations.filter((entry) => advertised(entry.name, settings));
}

/**
 * Applies the code mode surface to a selection that holds both code mode
 * tools. Members other than the selection's own are forwarded unchanged.
 */
export function selectCodeModeSurface<T extends ToolSelection>(
  base: T,
  readSettings: () => CodeModeSettings,
): T {
  const surface: ToolSelection = {
    getTool: (name, context) =>
      hidden(name, readSettings()) ? undefined : base.getTool(name, context),
    getAllToolNames: () => {
      const settings = readSettings();
      return base.getAllToolNames().filter((name) => !hidden(name, settings));
    },
    getAllTools: () => {
      const settings = readSettings();
      return base.getAllTools().filter((tool) => !hidden(tool.name, settings));
    },
    getEnabledTools: () => {
      const settings = readSettings();
      return base
        .getEnabledTools()
        .filter((tool) => !hidden(tool.name, settings));
    },
    getFunctionDeclarations: () =>
      advertisedDeclarations(base.getFunctionDeclarations(), readSettings()),
    getFunctionDeclarationsFiltered: (names) =>
      advertisedDeclarations(
        base.getFunctionDeclarationsFiltered(names),
        readSettings(),
      ),
  };
  return new Proxy(base, {
    get(target: T, key: string | symbol): unknown {
      if (Object.prototype.hasOwnProperty.call(surface, key))
        return surface[key as keyof ToolSelection];
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
