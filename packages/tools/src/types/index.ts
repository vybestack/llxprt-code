/**
 * @plan:PLAN-20260608-ISSUE1585.P05
 * @requirement:REQ-API-001
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Barrel export for package-local types.
 */

export {
  type ToolContext,
  type ContextAwareTool,
  isContextAwareTool,
} from './tool-context.js';
export {
  type ToolSchemaDescriptor,
  type ToolSchemaHolder,
  hasToolSchema,
  resolveToolDescription,
} from './tool-schema-capability.js';
export {
  ToolConfirmationOutcome,
  type ToolConfirmationPayload,
} from './tool-confirmation-types.js';
export { ToolErrorType, isFatalToolError } from './tool-error.js';
export {
  GOOGLE_WEB_SEARCH_TOOL,
  EXA_WEB_SEARCH_TOOL,
  EDIT_TOOL_NAME,
  GREP_TOOL_NAME,
  READ_MANY_FILES_TOOL_NAME,
  READ_FILE_TOOL_NAME,
  LS_TOOL_NAME,
  MEMORY_TOOL_NAME,
  ACTIVATE_SKILL_TOOL_NAME,
  READ_FILE_TOOL,
  WRITE_FILE_TOOL,
  EDIT_TOOL,
  INSERT_AT_LINE_TOOL,
  DELETE_LINE_RANGE_TOOL,
  READ_LINE_RANGE_TOOL,
  READ_MANY_FILES_TOOL,
  GREP_TOOL,
  RIPGREP_TOOL,
  GLOB_TOOL,
  LS_TOOL,
  LIST_DIRECTORY_TOOL,
  CODE_SEARCH_TOOL,
  GOOGLE_WEB_FETCH_TOOL,
  DIRECT_WEB_FETCH_TOOL,
  TASK_TOOL,
  MEMORY_TOOL,
  TODO_READ_TOOL,
  TODO_WRITE_TOOL,
  TODO_PAUSE_TOOL,
  LIST_SUBAGENTS_TOOL,
  SHELL_TOOL,
  AST_GREP_TOOL,
  STRUCTURAL_ANALYSIS_TOOL,
  APPLY_PATCH_TOOL,
  EDIT_TOOL_NAMES,
  type ToolName,
} from './tool-names.js';
export {
  TodoStatus,
  TodoToolCallSchema,
  SubtaskSchema,
  TodoSchema,
  TodoArraySchema,
  type TodoToolCall,
  type Subtask,
  type Todo,
} from './todo-schemas.js';
