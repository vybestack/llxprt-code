/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommand } from '../commands/types.js';
import type { Suggestion } from '../components/SuggestionsDisplay.js';

/**
 * Parsed result of a slash command path.
 */
export interface ParsedSlashCommandPath {
  /** Parts of the command path that were successfully resolved. */
  pathParts: string[];
  /** The command at the leaf of the resolved path, if any. */
  leafCommand: SlashCommand | null;
  /** The current level of subcommands available for completion. */
  currentLevel: readonly SlashCommand[] | undefined;
  /** Remaining parts after the resolved path. */
  remainingParts: string[];
  /** Length of the command path (number of resolved parts). */
  commandPathLength: number;
}

/**
 * Parsed arguments for a command that supports schema-based completion.
 */
export interface ParsedCommandArguments {
  /** Partial command name being typed. */
  commandPartial: string;
  /** Partial argument being typed. */
  argumentPartial: string;
  /** Completed arguments for schema. */
  completedArgsForSchema: string[];
  /** Whether the leaf command supports arguments. */
  leafSupportsArguments: boolean;
  /** Exact match that could be a parent command. */
  exactMatchAsParent: SlashCommand | undefined;
}

/**
 * Context for slash command completion.
 */
export interface SlashCommandCompletionContext {
  /** Whether this is an argument completion. */
  isArgumentCompletion: boolean;
  /** The leaf command. */
  leafCommand: SlashCommand | null;
  /** Completion start position. */
  completionStart: number;
  /** Completion end position. */
  completionEnd: number;
  /** Command mapping for autoExecute support. */
  commandMap?: Map<string, SlashCommand>;
}

/**
 * Options for filtering commands.
 */
export interface CommandFilterOptions {
  /** Partial command name to match. */
  commandPartial: string;
  /** Extension config for checking enabled extensions. */
  extensionConfig: {
    isExtensionEnabled?: (name: string) => boolean;
  } | null;
}

/**
 * Result of command suggestion generation.
 */
export interface CommandSuggestionResult {
  /** Generated suggestions. */
  suggestions: Suggestion[];
  /** Whether to show suggestions. */
  showSuggestions: boolean;
  /** Active suggestion index. */
  activeSuggestionIndex: number;
  /** Command mapping for autoExecute support. */
  commandMap: Map<string, SlashCommand>;
}

/**
 * Parsed @ command path.
 */
export interface ParsedAtPath {
  /** Relative path to the base directory. */
  baseDirRelative: string;
  /** Prefix to match files against. */
  prefix: string;
  /** Partial path being completed. */
  partialPath: string;
  /** Start position for completion. */
  pathStart: number;
}
