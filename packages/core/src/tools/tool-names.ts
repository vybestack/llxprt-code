/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Centralized tool name constants.
 *
 * This module exists to prevent circular dependencies - tool names can be
 * imported without importing tool classes. For example, config modules and
 * tests can reference tool names without creating circular dependency chains.
 */

// Web Search Tools
export const GOOGLE_WEB_SEARCH_TOOL = 'google_web_search';
export const EXA_WEB_SEARCH_TOOL = 'exa_web_search';

// Alias for upstream compatibility - centralizes tool names
export const EDIT_TOOL_NAME = 'replace';
export const GREP_TOOL_NAME = 'search_file_content';
export const READ_MANY_FILES_TOOL_NAME = 'read_many_files';
export const READ_FILE_TOOL_NAME = 'read_file';

// File System Tools
export const READ_FILE_TOOL = 'read_file';
export const WRITE_FILE_TOOL = 'write_file';
export const EDIT_TOOL = 'replace';
export const INSERT_AT_LINE_TOOL = 'insert_at_line';
export const DELETE_LINE_RANGE_TOOL = 'delete_line_range';
export const READ_LINE_RANGE_TOOL = 'read_line_range';
export const READ_MANY_FILES_TOOL = 'read_many_files';

// Search & Discovery Tools
export const GREP_TOOL = 'search_file_content';
export const RIPGREP_TOOL = 'ripgrep';
export const GLOB_TOOL = 'glob';
export const LS_TOOL = 'ls';
export const LIST_DIRECTORY_TOOL = 'list_directory';
export const CODE_SEARCH_TOOL = 'code_search';

// Web Fetch Tools
export const GOOGLE_WEB_FETCH_TOOL = 'web_fetch';
export const DIRECT_WEB_FETCH_TOOL = 'direct_web_fetch';

// Task & Memory Tools
export const TASK_TOOL = 'task';
export const MEMORY_TOOL = 'memory';
export const TODO_READ_TOOL = 'todo_read';
export const TODO_WRITE_TOOL = 'todo_write';
export const TODO_PAUSE_TOOL = 'todo_pause';

// Agent Tools
export const LIST_SUBAGENTS_TOOL = 'list_subagents';

// Shell Tool
export const SHELL_TOOL = 'shell';

// @plan PLAN-20260211-ASTGREP.P04
// AST Analysis Tools
export const AST_GREP_TOOL = 'ast_grep';
export const STRUCTURAL_ANALYSIS_TOOL = 'structural_analysis';

/**
 * Union type of all tool names for type safety
 */
export type ToolName =
  | typeof GOOGLE_WEB_SEARCH_TOOL
  | typeof EXA_WEB_SEARCH_TOOL
  | typeof READ_FILE_TOOL
  | typeof WRITE_FILE_TOOL
  | typeof EDIT_TOOL
  | typeof INSERT_AT_LINE_TOOL
  | typeof DELETE_LINE_RANGE_TOOL
  | typeof READ_LINE_RANGE_TOOL
  | typeof READ_MANY_FILES_TOOL
  | typeof GREP_TOOL
  | typeof RIPGREP_TOOL
  | typeof GLOB_TOOL
  | typeof LS_TOOL
  | typeof LIST_DIRECTORY_TOOL
  | typeof CODE_SEARCH_TOOL
  | typeof GOOGLE_WEB_FETCH_TOOL
  | typeof DIRECT_WEB_FETCH_TOOL
  | typeof TASK_TOOL
  | typeof MEMORY_TOOL
  | typeof TODO_READ_TOOL
  | typeof TODO_WRITE_TOOL
  | typeof TODO_PAUSE_TOOL
  | typeof LIST_SUBAGENTS_TOOL
  | typeof SHELL_TOOL
  | typeof AST_GREP_TOOL
  | typeof STRUCTURAL_ANALYSIS_TOOL;
