/**
 * @plan:PLAN-20260608-ISSUE1585.P03
 * @requirement:REQ-PKG-001, REQ-API-001
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tools package public API entry point.
 *
 * Exports tool-facing interface contracts that moved tools consume.
 * Core adapters implement these interfaces; tools depend only on these
 * abstract contracts.
 *
 * Per integration-contract.md, all interfaces are tools-owned.
 */

// --- Interface contracts ---
export type * from './interfaces/index.js';

// --- Types ---
export type { ToolContext, ContextAwareTool } from './types/tool-context.js';
export {
  type ToolSchemaDescriptor,
  type ToolSchemaHolder,
  hasToolSchema,
  resolveToolDescription,
} from './types/tool-schema-capability.js';

// --- Formatters ---
export type {
  IToolFormatter,
  ToolFormat,
  OpenAIFunction,
  OpenAITool,
  ResponsesTool,
  FormatterTool,
  ToolCallBlock,
} from './formatters/IToolFormatter.js';

export { ToolFormatter } from './formatters/ToolFormatter.js';

export type {
  ToolIdStrategy,
  ToolIdMapper,
  ContentBlock as StrategyContentBlock,
} from './formatters/ToolIdStrategy.js';

export {
  getToolIdStrategy,
  kimiStrategy,
  standardStrategy,
  mistralStrategy,
  isKimiModel,
  isDeepSeekReasonerModel,
  isMistralModel,
} from './formatters/ToolIdStrategy.js';

export {
  shouldUseDoubleEscapeHandling,
  detectDoubleEscaping,
  detectDoubleEscapingInChunk,
  processToolParameters,
  logDoubleEscapingInChunk,
} from './formatters/doubleEscapeUtils.js';

export {
  normalizeToolName,
  toSnakeCase,
  isValidToolName,
  isValidToolName as isValidFormatterToolName,
  findMatchingTool,
  canonicalizeToolName,
  INVALID_TOOL_NAME,
} from './formatters/toolNameUtils.js';

export {
  normalizeToOpenAIToolId,
  normalizeToHistoryToolId,
  normalizeToAnthropicToolId,
} from './formatters/toolIdNormalization.js';

// --- Utils ---
export { ToolConfirmationOutcome } from './types/tool-confirmation-types.js';

export type { ToolConfirmationPayload } from './types/tool-confirmation-types.js';

export { ToolErrorType, isFatalToolError } from './types/tool-error.js';

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
} from './types/tool-names.js';

export type { MediaBlock, MediaCategory } from './utils/mediaUtils.js';
export { classifyMediaBlock } from './utils/mediaUtils.js';
export {
  DEFAULT_DIFF_OPTIONS,
  DEFAULT_CREATE_PATCH_OPTIONS,
  getDiffStat,
  type DiffStat,
} from './utils/diffOptions.js';
export {
  fuzzyReplace,
  levenshtein,
  type Replacer,
} from './utils/fuzzy-replacer.js';
export { ensureParentDirectoriesExist } from './utils/ensure-dirs.js';
export {
  getRipgrepPath,
  isRipgrepAvailable,
  clearRipgrepAvailabilityCache,
  ensureWindowsShortcut,
} from './utils/ripgrepPathResolver.js';
export {
  TodoStatus,
  TodoToolCallSchema,
  SubtaskSchema,
  TodoSchema,
  TodoArraySchema,
  type TodoToolCall,
  type Subtask,
  type Todo,
} from './types/todo-schemas.js';

export type { ToolKeyRegistryEntry } from './utils/tool-key-storage-types.js';
export {
  TOOL_KEY_REGISTRY,
  isValidToolKeyName,
  getToolKeyEntry,
  getSupportedToolNames,
  maskKeyForDisplay,
} from './utils/tool-key-storage-types.js';

// --- Base tool classes ---
export {
  BaseToolInvocation,
  DeclarativeTool,
  BaseDeclarativeTool,
  BaseTool,
  isTool,
  hasCycleInSchema,
  Kind,
} from './tools/tools.js';

export type {
  ToolInvocation,
  AnyToolInvocation,
  PolicyUpdateOptions,
  ToolBuilder,
  AnyDeclarativeTool,
  ToolResult,
  FileRead,
  ToolResultDisplay,
  FileDiff,
  DiffStat as ToolDiffStat,
  ToolEditConfirmationDetails,
  ToolExecuteConfirmationDetails,
  ToolMcpConfirmationDetails,
  ToolInfoConfirmationDetails,
  ToolCallConfirmationDetails,
  ToolLocation,
} from './tools/tools.js';

export {
  isModifiableDeclarativeTool,
  modifyWithEditor,
} from './tools/modifiable-tool.js';
export {
  TodoRead,
  TodoRead as TodoReadTool,
  type TodoReadParams,
} from './tools/todo-read.js';
export {
  TodoWrite,
  TodoWrite as TodoWriteTool,
  type TodoWriteParams,
} from './tools/todo-write.js';
export {
  TodoPause,
  TodoPause as TodoPauseTool,
  type TodoPauseParams,
} from './tools/todo-pause.js';
export {
  TodoStore as LocalTodoStore,
  DEFAULT_AGENT_ID as TODO_DEFAULT_AGENT_ID,
} from './tools/todo-store.js';
export {
  todoEvents,
  TodoEvent,
  TodoEventEmitter,
  type TodoUpdateEvent,
} from './tools/todo-events.js';
export {
  formatTodoListForDisplay,
  groupToolCalls,
  type TodoFormatterOptions,
  type GroupedToolCall,
} from './utils/todoFormatter.js';
export {
  TodoReminderService,
  type TodoStateChange,
} from './utils/todoReminderService.js';
export { TodoContextTracker } from './utils/todoContextTracker.js';

export type {
  ModifiableDeclarativeTool,
  ModifyContext,
  ModifyResult,
  ModifyContentOverrides,
} from './tools/modifiable-tool.js';

export {
  ShellTool,
  ShellToolInvocation,
  OUTPUT_UPDATE_INTERVAL_MS,
  type ShellToolParams,
} from './tools/shell.js';
export { TaskTool, type TaskToolParams } from './tools/task.js';
export {
  DISCOVERED_TOOL_PREFIX,
  ToolRegistry,
  DiscoveredTool,
} from './tools/tool-registry.js';
export { ToolKeyStorageFacade } from './utils/tool-key-storage-facade.js';

export {
  CheckAsyncTasksTool,
  type CheckAsyncTasksParams,
  type CheckAsyncTasksToolDependencies,
} from './tools/check-async-tasks.js';
export {
  MemoryTool,
  setLlxprtMdFilename,
  getCurrentLlxprtMdFilename,
  getAllLlxprtMdFilenames,
  DEFAULT_CONTEXT_FILENAME,
  LLXPRT_CONFIG_DIR,
  GEMINI_DIR,
  CORE_MEMORY_FILENAME,
  MEMORY_SECTION_HEADER,
  getGlobalCoreMemoryFilePath,
  getProjectCoreMemoryFilePath,
  type MemoryToolDependencies,
  type SaveMemoryParams,
} from './tools/memoryTool.js';

export {
  ListSubagentsTool,
  type ListSubagentsToolDependencies,
} from './tools/list-subagents.js';
export {
  ActivateSkillTool,
  type ActivateSkillToolParams,
} from './tools/activate-skill.js';

export {
  CodeSearchTool,
  type CodeSearchToolDependencies,
  type CodeSearchToolParams,
} from './tools/codesearch.js';
export {
  ExaWebSearchTool,
  type ExaWebSearchToolDependencies,
  type ExaWebSearchToolParams,
} from './tools/exa-web-search.js';
export {
  GoogleWebSearchTool,
  type WebSearchToolParams,
  type WebSearchToolResult,
} from './tools/google-web-search.js';

export {
  ApplyPatchTool,
  classifyPatchOperations,
  type ApplyPatchToolParams,
} from './tools/apply-patch.js';

export {
  EditTool,
  applyReplacement,
  countLineGuardedOccurrences,
  applyLineGuardedReplacement,
  type EditToolParams,
} from './tools/edit.js';

export { WriteFileTool, type WriteFileToolParams } from './tools/write-file.js';

export {
  DirectWebFetchTool,
  type DirectWebFetchToolParams,
} from './tools/direct-web-fetch.js';

export { LSTool, type FileEntry, type LSToolParams } from './tools/ls.js';

export {
  GlobTool,
  sortFileEntries,
  type GlobPath,
  type GlobToolParams,
} from './tools/glob.js';

export { collectLspDiagnosticsBlock } from './utils/lsp-diagnostics-helper.js';

export { GrepTool, type GrepToolParams } from './tools/grep.js';

export { ReadFileTool, type ReadFileToolParams } from './tools/read-file.js';

export {
  ReadLineRangeTool,
  type ReadLineRangeToolParams,
} from './tools/read_line_range.js';
export {
  DeleteLineRangeTool,
  type DeleteLineRangeToolParams,
} from './tools/delete_line_range.js';

export {
  InsertAtLineTool,
  type InsertAtLineToolParams,
} from './tools/insert_at_line.js';

export {
  ReadManyFilesTool,
  type ReadManyFilesParams,
} from './tools/read-many-files.js';

export {
  RipGrepTool,
  ripGrepDebugLogger,
  type RipGrepToolParams,
} from './tools/ripGrep.js';

export {
  GoogleWebFetchTool,
  parsePrompt,
  type GoogleWebFetchToolParams,
} from './tools/google-web-fetch.js';

export { AstGrepTool, type AstGrepToolParams } from './tools/ast-grep.js';

export {
  ASTEditTool,
  ASTReadFileTool,
  type ASTEditToolParams,
  type ASTReadFileToolParams,
  type EnhancedDeclaration,
} from './tools/ast-edit.js';

export {
  StructuralAnalysisTool,
  type StructuralAnalysisParams,
} from './tools/structural-analysis.js';

export {
  KEYWORDS,
  COMMENT_PREFIXES,
  REGEX,
  LANGUAGE_MAP,
  JAVASCRIPT_FAMILY_EXTENSIONS,
} from './tools/ast-edit.js';
export { prioritizeSymbolsFromDeclarations } from './tools/ast-edit/context-collector.js';
export { ASTConfig } from './tools/ast-edit/ast-config.js';
export { ASTQueryExtractor } from './tools/ast-edit/ast-query-extractor.js';
export { RepositoryContextProvider } from './tools/ast-edit/repository-context-provider.js';
export { validateASTSyntax } from './tools/ast-edit/edit-calculator.js';
export {
  detectLanguage,
  extractImports,
} from './tools/ast-edit/language-analysis.js';
