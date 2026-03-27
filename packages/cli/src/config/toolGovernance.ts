/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ShellTool,
  EditTool,
  WriteFileTool,
  SHELL_TOOL_NAMES,
  type ApprovalMode,
  ApprovalMode as ApprovalModeEnum,
} from '@vybestack/llxprt-code-core';
import type { GeminiCLIExtension } from '@vybestack/llxprt-code-core';
import type { Settings } from './settings.js';
import type { CliArgs } from './cliArgParser.js';
import type { ContextResolutionResult } from './interactiveContext.js';

export const READ_ONLY_TOOL_NAMES = [
  'glob',
  'search_file_content',
  'read_file',
  'read_many_files',
  'list_directory',
  'ls',
  'list_subagents',
  'google_web_search',
  'web_fetch',
  'todo_read',
  'todo_write',
  'todo_pause',
  'task',
  'self_emitvalue',
] as const;

export const EDIT_TOOL_NAME = 'replace';

export const normalizeToolNameForPolicy = (name: string): string =>
  name.trim().toLowerCase();

export const buildNormalizedToolSet = (value: unknown): Set<string> => {
  const normalized = new Set<string>();
  if (!value) {
    return normalized;
  }

  const entries =
    Array.isArray(value) && value.length > 0
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? [value]
        : [];

  for (const entry of entries) {
    if (typeof entry === 'string' && entry.trim().length > 0) {
      const trimmedEntry = entry.trim();
      const openParenIndex = trimmedEntry.indexOf('(');
      const baseName =
        openParenIndex === -1
          ? trimmedEntry
          : trimmedEntry.substring(0, openParenIndex).trim();

      const canonicalName =
        normalizeToolNameForPolicy(baseName) === 'shelltool'
          ? 'run_shell_command'
          : baseName;
      const normalizedName = normalizeToolNameForPolicy(canonicalName);
      if (normalizedName) {
        normalized.add(normalizedName);
      }
    }
  }

  return normalized;
};

/**
 * Creates a filter function to determine if a tool should be excluded.
 *
 * In non-interactive mode, we want to disable tools that require user
 * interaction to prevent the CLI from hanging. This function creates a predicate
 * that returns `true` if a tool should be excluded.
 *
 * A tool is excluded if it's not in the `allowedToolsSet`. The shell tool
 * has a special case: it's not excluded if any of its subcommands
 * are in the `allowedTools` list.
 *
 * @param allowedTools A list of explicitly allowed tool names.
 * @param allowedToolsSet A set of explicitly allowed tool names for quick lookups.
 * @returns A function that takes a tool name and returns `true` if it should be excluded.
 */
export function createToolExclusionFilter(
  allowedTools: string[],
  allowedToolsSet: Set<string>,
): (tool: string) => boolean {
  return (tool: string): boolean => {
    if (tool === ShellTool.Name) {
      // If any of the allowed tools is ShellTool (even with subcommands), don't exclude it.
      return !allowedTools.some((allowed) =>
        SHELL_TOOL_NAMES.some((shellName) => allowed.startsWith(shellName)),
      );
    }
    return !allowedToolsSet.has(tool);
  };
}

export function mergeExcludeTools(
  settings: Settings,
  extensions: GeminiCLIExtension[],
  extraExcludes?: string[] | undefined,
): string[] {
  const allExcludeTools = new Set([
    ...(settings.excludeTools || []),
    ...(extraExcludes || []),
  ]);
  for (const extension of extensions) {
    for (const tool of extension.excludeTools || []) {
      allExcludeTools.add(tool);
    }
  }
  return [...allExcludeTools];
}

export function resolveNonInteractiveExcludes(
  argv: CliArgs,
  context: ContextResolutionResult,
  profileMergedSettings: Settings,
  approvalMode: ApprovalMode,
  allowedTools: string[],
  allowedToolsSet: Set<string>,
): readonly string[] {
  const extraExcludes: string[] = [];
  if (!context.interactive && !argv.experimentalAcp) {
    const defaultExcludes = [ShellTool.Name, EditTool.Name, WriteFileTool.Name];
    const autoEditExcludes = [ShellTool.Name];
    const toolExclusionFilter = createToolExclusionFilter(
      allowedTools,
      allowedToolsSet,
    );
    switch (approvalMode) {
      case ApprovalModeEnum.DEFAULT:
        extraExcludes.push(...defaultExcludes.filter(toolExclusionFilter));
        break;
      case ApprovalModeEnum.AUTO_EDIT:
        extraExcludes.push(...autoEditExcludes.filter(toolExclusionFilter));
        break;
      default:
        break;
    }
  }
  return mergeExcludeTools(
    profileMergedSettings,
    context.activeExtensions,
    extraExcludes.length > 0 ? extraExcludes : undefined,
  );
}
