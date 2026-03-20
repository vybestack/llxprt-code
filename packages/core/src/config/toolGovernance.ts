/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared tool policy primitives.
 *
 * These are normalization helpers and default policy constants for tool
 * governance. CLI (or any future host) uses these primitives to compose
 * tool exclusion/inclusion policies during bootstrap.
 *
 * Note: READ_ONLY_TOOL_NAMES is a default policy set currently used by CLI's
 * tool exclusion logic. It is not a universal core invariant — a future
 * non-CLI host could define different policy defaults.
 */

/**
 * Default set of tool names considered read-only.
 * Used by CLI to compose tool exclusion policy for non-interactive sessions.
 */
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

/**
 * Normalize a tool name for policy matching (trim + lowercase).
 */
export const normalizeToolNameForPolicy = (name: string): string =>
  name.trim().toLowerCase();

/**
 * Build a normalized Set of tool names from an unknown input value.
 * Handles strings, arrays, and mixed inputs. Canonicalizes legacy
 * 'shelltool' to 'run_shell_command'. Strips parenthetical suffixes.
 */
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
