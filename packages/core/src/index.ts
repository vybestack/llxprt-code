/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Export safety utilities
export * from './safety/index.js';

// Export config
export * from './config/config.js';
export * from './config/subagentManager.js';
export * from './config/schedulerSingleton.js';
export * from './policy/index.js';
export { PolicyEngine } from './policy/policy-engine.js';
export {
  PolicyDecision,
  ApprovalMode,
  PolicyRule,
  type PolicyEngineConfig,
  type PolicySettings,
} from './policy/types.js';
export {
  createPolicyEngineConfig,
  createPolicyUpdater,
  DEFAULT_CORE_POLICIES_DIR,
  DEFAULT_POLICY_TIER,
  USER_POLICY_TIER,
  ADMIN_POLICY_TIER,
  getPolicyDirectories,
  getPolicyTier,
  formatPolicyError,
} from './policy/config.js';

// Export hooks system
export * from './hooks/index.js';

// Export skills system
export * from './skills/skillManager.js';
export * from './skills/skillLoader.js';

// Export environment sanitization
export * from './services/environmentSanitization.js';

// Export debugLogger
export * from './utils/debugLogger.js';

// Export message bus
export * from './confirmation-bus/types.js';
export * from './confirmation-bus/message-bus.js';

// Export services
export * from './services/git-stats-service.js';

// @plan PLAN-20260130-ASYNCTASK.P09
// Export async task management types and services
export {
  AsyncTaskManager,
  AsyncTaskInfo,
  AsyncTaskStatus,
  RegisterTaskInput,
} from './services/asyncTaskManager.js';
export { AsyncTaskReminderService } from './services/asyncTaskReminderService.js';
export { AsyncTaskAutoTrigger } from './services/asyncTaskAutoTrigger.js';
// Export SubagentTerminateMode for OutputObject types
export { SubagentTerminateMode } from './core/subagentTypes.js';

// Export Commands logic
export * from './commands/extensions.js';
export * from './commands/types.js';

// Export Core Logic (contracts only — implementations moved to the agents package)
export * from './core/clientContract.js';
export * from './core/toolSchedulerContract.js';
export type {
  CancelledToolCall,
  CompletedToolCall,
  ErroredToolCall,
  ExecutingToolCall,
  ScheduledToolCall,
  ToolCall,
  ValidatingToolCall,
  WaitingToolCall,
} from './scheduler/types.js';

export * from './core/contentGenerator.js';
export * from './core/logger.js';
export * from './core/prompts.js';
export * from './core/tokenLimits.js';
export * from './core/turn.js';
export * from './core/geminiRequest.js';
export type { SubagentSchedulerFactory } from './core/subagentTypes.js';
export { buildContinuationDirective } from './core/compression/continuationDirective.js';

export * from './code_assist/codeAssist.js';
export * from './code_assist/oauth2.js';
export * from './code_assist/server.js';
export * from './code_assist/types.js';

// Export utilities
export * from './utils/paths.js';
export * from './utils/shellPathCompletion.js';
export * from './utils/ripgrepPathResolver.js';
export * from './utils/schemaValidator.js';
export * from './utils/errors.js';
export * from './utils/checkpointUtils.js';
export * from './utils/output-format.js';
export * from './utils/exitCodes.js';
export * from './utils/getFolderStructure.js';
export * from './utils/memoryDiscovery.js';
export * from './utils/gitIgnoreParser.js';
export * from './utils/gitUtils.js';
export * from './utils/editor.js';
export * from './utils/quotaErrorDetection.js';
export * from './utils/fileUtils.js';
export * from './utils/delay.js';
export * from './utils/streamIdleTimeout.js';
export * from './utils/fileDiffUtils.js';
export * from './utils/retry.js';
export * from './utils/shell-utils.js';
export * from './utils/systemEncoding.js';
export * from './utils/textUtils.js';
export * from './utils/formatters.js';
export * from './utils/sanitization.js';
export * from './utils/unicodeUtils.js';
export {
  getResponseText,
  getResponseTextFromParts,
  getFunctionCalls,
  getFunctionCallsFromParts,
  getFunctionCallsAsJson,
  getFunctionCallsFromPartsAsJson,
  getStructuredResponse,
  getStructuredResponseFromParts,
  createFunctionResponsePart,
  limitStringOutput,
  limitFunctionResponsePart,
  toParts,
  convertToFunctionResponse,
  extractAgentIdFromMetadata,
  createErrorResponse,
  analyzeResponseOutcome,
  type ResponseOutcome,
} from './utils/generateContentResponseUtilities.js';
export * from './utils/filesearch/fileSearch.js';
export * from './utils/secure-browser-launcher.js';
export * from './utils/errorParsing.js';
export * from './utils/ignorePatterns.js';
export { INITIAL_HISTORY_LENGTH } from './utils/environmentContext.js';
export * from './utils/partUtils.js';
export * from './utils/ide-trust.js';
export * from './utils/thoughtUtils.js';
export * from './utils/events.js';
export * from './utils/package.js';
export * from './utils/version.js';
export * from './utils/extensionLoader.js';
export * from './utils/terminalSerializer.js';
export * from './utils/LruCache.js';

// @plan:PLAN-20260608-ISSUE1586.P15
// @requirement:REQ-API-001.2
// Auth public API re-exported from @vybestack/llxprt-code-auth (no wrapper/shim)
export {
  AuthPrecedenceResolver,
  type AuthPrecedenceConfig,
  type OAuthManager,
  flushRuntimeAuthScope,
  type RuntimeAuthScopeFlushResult,
  type RuntimeAuthScopeCacheEntrySummary,
  type OAuthTokenRequestMetadata,
  type OAuthToken,
  type AuthStatus,
  type TokenStore,
  KeyringTokenStore,
  type CodexOAuthToken,
  type BucketStats,
  type DeviceCodeResponse,
  OAuthError,
  OAuthErrorFactory,
  CodexDeviceFlow,
  AnthropicDeviceFlow,
  QwenDeviceFlow,
  type DeviceFlowConfig,
} from '@vybestack/llxprt-code-auth';
// @plan:PLAN-20260608-ISSUE1586.P15
// @requirement:REQ-API-001.2
// Token merge utility re-exported from auth package
export {
  mergeRefreshedToken,
  type OAuthTokenWithExtras,
} from '@vybestack/llxprt-code-auth';
// @plan:PLAN-20260608-ISSUE1586.P15
// @requirement:REQ-API-001.2
// Proxy mode credential store classes and utilities re-exported from auth package
export { ProxyTokenStore } from '@vybestack/llxprt-code-auth';
export { ProxyProviderKeyStorage } from '@vybestack/llxprt-code-auth';
export { ProxySocketClient } from '@vybestack/llxprt-code-auth';
export {
  FrameDecoder,
  encodeFrame,
  MAX_FRAME_SIZE,
  PARTIAL_FRAME_TIMEOUT_MS,
} from '@vybestack/llxprt-code-auth';
export type {
  FrameDecoderOptions,
  FrameError,
} from '@vybestack/llxprt-code-auth';
export { sanitizeTokenForProxy } from '@vybestack/llxprt-code-auth';

// @plan:PLAN-20260608-ISSUE1586.P15
// @requirement:REQ-API-001.2
// Auth factory functions
export {
  createAuthPrecedenceResolver,
  createKeyringTokenStore,
} from './auth-factories.js';
export {
  SecureStore,
  SecureStoreError,
  createDefaultKeyringAdapter,
} from './storage/secure-store.js';
export type {
  KeyringAdapter,
  SecureStoreOptions,
  SecureStoreErrorCode,
} from './storage/secure-store.js';
export {
  ProviderKeyStorage,
  getProviderKeyStorage,
  resetProviderKeyStorage,
} from './storage/provider-key-storage.js';

// Export services
export * from './services/fileDiscoveryService.js';
export * from './services/gitService.js';
export * from './services/tool-call-tracker-service.js';
export * from './services/todo-context-tracker.js';
export * from './services/fileSystemService.js';
export { ContextManager } from './services/contextManager.js';

// Export IDE specific logic
// IDE integration code now lives in @vybestack/llxprt-code-ide-integration.
// Re-exported here for backward compatibility with existing consumers.
export {
  IdeClient,
  IDEConnectionStatus,
  type IDEConnectionState,
  ideContext,
  createIdeContextStore,
  FileSchema,
  IdeContextSchema,
  IdeContextNotificationSchema,
  IdeDiffAcceptedNotificationSchema,
  IdeDiffRejectedNotificationSchema,
  IdeDiffClosedNotificationSchema,
  CloseDiffResponseSchema,
  type IdeContext,
  type File,
  type DiffUpdateResult,
  getIdeInstaller,
  type IdeInstaller,
  type InstallResult,
  IDE_DEFINITIONS,
  detectIdeFromEnv,
  detectIde,
  isCloudShell,
  type IdeInfo,
  getIdeProcessInfo,
  LLXPRT_CODE_COMPANION_EXTENSION_NAME,
} from '@vybestack/llxprt-code-ide-integration';

// Export Shell Execution Service
export * from './services/shellExecutionService.js';

// Export base tool definitions
export {
  BaseToolInvocation,
  DeclarativeTool,
  BaseDeclarativeTool,
  BaseTool,
  isTool,
  hasCycleInSchema,
  Kind,
  ToolConfirmationOutcome,
} from '@vybestack/llxprt-code-tools';

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
  ToolConfirmationPayload,
} from '@vybestack/llxprt-code-tools';
export { ToolErrorType, isFatalToolError } from '@vybestack/llxprt-code-tools';
export {
  DISCOVERED_TOOL_PREFIX,
  DiscoveredTool,
  ToolRegistry,
} from '@vybestack/llxprt-code-tools';
export type {
  ToolContext,
  ContextAwareTool,
} from '@vybestack/llxprt-code-tools';
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
} from '@vybestack/llxprt-code-tools';

export * from './todo/todoFormatter.js';

// Export prompt logic
export * from './prompts/mcp-prompts.js';

// Export resource registry
export * from './resources/resource-registry.js';

// Export prompt configuration system
export * from './prompt-config/prompt-service.js';
export * from './prompt-config/types.js';

// Export specific tool logic
export {
  LSTool,
  ReadFileTool,
  ReadLineRangeTool,
} from '@vybestack/llxprt-code-tools';
export type {
  LSToolParams,
  FileEntry,
  ReadFileToolParams,
  ReadLineRangeToolParams,
} from '@vybestack/llxprt-code-tools';
export {
  GrepTool,
  RipGrepTool,
  type GrepToolParams,
  type RipGrepToolParams,
} from '@vybestack/llxprt-code-tools';
export {
  GlobTool,
  sortFileEntries,
  type GlobPath,
  type GlobToolParams,
} from '@vybestack/llxprt-code-tools';

export {
  EditTool,
  applyReplacement,
  type EditToolParams,
} from '@vybestack/llxprt-code-tools';
export {
  WriteFileTool,
  type WriteFileToolParams,
} from '@vybestack/llxprt-code-tools';
export {
  GoogleWebFetchTool,
  type GoogleWebFetchToolParams,
  parsePrompt,
} from '@vybestack/llxprt-code-tools';
export { DirectWebFetchTool } from '@vybestack/llxprt-code-tools';
export type { DirectWebFetchToolParams } from '@vybestack/llxprt-code-tools';
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
} from '@vybestack/llxprt-code-tools';
export {
  ShellTool,
  OUTPUT_UPDATE_INTERVAL_MS,
  type ShellToolParams,
} from '@vybestack/llxprt-code-tools';
export {
  GoogleWebSearchTool,
  ExaWebSearchTool,
  CodeSearchTool,
  type WebSearchToolParams,
  type WebSearchToolResult,
  type ExaWebSearchToolParams,
  type CodeSearchToolParams,
} from '@vybestack/llxprt-code-tools';

export {
  ReadManyFilesTool,
  type ReadManyFilesParams,
} from '@vybestack/llxprt-code-tools';
export {
  TodoRead,
  TodoRead as TodoReadTool,
  type TodoReadParams,
  TodoWrite,
  TodoWrite as TodoWriteTool,
  type TodoWriteParams,
  TodoPause,
  TodoPause as TodoPauseTool,
  type TodoPauseParams,
  LocalTodoStore as TodoStore,
  todoEvents,
  TodoEvent,
  TodoEventEmitter,
  type Todo,
  type Subtask,
  type TodoStatus,
  type TodoToolCall,
  type TodoUpdateEvent,
} from '@vybestack/llxprt-code-tools';
export { TaskTool, type TaskToolParams } from '@vybestack/llxprt-code-tools';
export * from './tools-adapters/index.js';
export {
  ToolKeyStorage,
  getToolKeyStorage,
  type ToolKeyStorageOptions,
} from './tools/tool-key-storage.js';
export {
  TOOL_KEY_REGISTRY,
  getToolKeyEntry,
  getSupportedToolNames,
  isValidToolKeyName,
  maskKeyForDisplay,
  type ToolKeyRegistryEntry,
} from '@vybestack/llxprt-code-tools';
// MCP client/tool — re-exported from @vybestack/llxprt-code-mcp
export {
  DiscoveredMCPTool,
  MCPServerStatus,
  MCPDiscoveryState,
  McpClient,
  getAllMCPServerStatuses,
  getMCPDiscoveryState,
  getMCPServerStatus,
  updateMCPServerStatus,
  addMCPStatusChangeListener,
  removeMCPStatusChangeListener,
  createTransport,
  mcpServerRequiresOAuth,
  populateMcpServerCommand,
  hasNetworkTransport,
  MCP_DEFAULT_TIMEOUT_MSEC,
  McpClientManager,

  // MCP OAuth — also re-exported from @vybestack/llxprt-code-mcp
  MCPOAuthProvider,
  MCPOAuthTokenStorage,
  BaseTokenStore,
  FileTokenStore,
  OAuthUtils,
} from '@vybestack/llxprt-code-mcp';

export type {
  MCPOAuthToken,
  MCPOAuthCredentials,
  MCPOAuthConfig,
  DiscoveredMCPPrompt,
  MCPOAuthToken as MCPOAuthTokenInterface,
  MCPOAuthCredentials as MCPOAuthCredentialsInterface,
  OAuthAuthorizationServerMetadata,
  OAuthProtectedResourceMetadata,
} from '@vybestack/llxprt-code-mcp';

// Export telemetry functions
export * from './telemetry/index.js';
export * from './telemetry/uiTelemetry.js';
export { sessionId } from './utils/session.js';
// Export content interfaces
export * from './services/history/IContent.js';

// @plan:PLAN-20260603-ISSUE1584.P11
// @requirement:REQ-SHIM-001
// Provider implementations and provider public APIs live outside core.
// Core intentionally does not re-export provider package symbols.
export * from './utils/browser.js';
export * from './utils/stdio.js';
export * from './utils/terminal.js';

// Export adapters
export * from './adapters/IStreamAdapter.js';

// Export parsers
export * from './parsers/TextToolCallParser.js';

// Export tool formatters
export type {
  IToolFormatter,
  ToolFormat,
  OpenAIFunction,
  OpenAITool,
  ResponsesTool,
  FormatterTool,
  ToolCallBlock,
} from '@vybestack/llxprt-code-tools';
export { ToolFormatter } from '@vybestack/llxprt-code-tools';

export {
  createProviderRuntimeContext,
  getActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  clearActiveProviderRuntimeContext,
  peekActiveProviderRuntimeContext,
} from './runtime/providerRuntimeContext.js';
export type {
  ProviderRuntimeContext,
  ProviderRuntimeContextInit,
} from './runtime/providerRuntimeContext.js';

// @plan PLAN-20251027-STATELESS5.P06
// Export AgentRuntimeState types and functions for CLI adapter integration
export type {
  AgentRuntimeState,
  RuntimeStateParams,
  RuntimeStateSnapshot,
  RuntimeStateChangedEvent,
  RuntimeStateChangeCallback,
  UnsubscribeFunction,
  getBaseUrl,
  getSessionId,
  getModelParams,
} from './runtime/AgentRuntimeState.js';
export {
  createAgentRuntimeState,
  updateAgentRuntimeState,
  updateAgentRuntimeStateBatch,
  getAgentRuntimeStateSnapshot,
  subscribeToAgentRuntimeState,
} from './runtime/AgentRuntimeState.js';
export type { RuntimeStateFromConfigOptions } from './runtime/runtimeStateFactory.js';
export { createAgentRuntimeStateFromConfig as createRuntimeStateFromConfig } from './runtime/runtimeStateFactory.js';

// @plan PLAN-20251028-STATELESS6.P06
// Export AgentRuntimeContext types and factory for Config elimination
export type {
  AgentRuntimeContext,
  AgentRuntimeContextFactoryOptions,
  ReadonlySettingsSnapshot,
  ToolRegistryView,
  ToolMetadata,
  ApiRequestEvent,
  ApiResponseEvent,
  ApiErrorEvent,
  TelemetryRedactionConfig,
  AgentRuntimeProviderAdapter,
  AgentRuntimeTelemetryAdapter,
} from './runtime/AgentRuntimeContext.js';
export { TelemetryTarget } from './runtime/AgentRuntimeContext.js';
export { createAgentRuntimeContext } from './runtime/createAgentRuntimeContext.js';
export type {
  RuntimeProvider,
  RuntimeProviderManager,
  RuntimeModel,
  RuntimeTokenizer,
  RuntimeTokenizerFactory,
  RuntimeContentGeneratorFactory,
  TelemetryContext,
  BucketFailureReason,
  ReasoningOutput,
  RuntimeGenerateChatOptions,
  RuntimeProviderTool,
  RuntimeProviderToolset,
} from './runtime/contracts/index.js';

// Export emoji filter system
export { EmojiFilter } from './filters/EmojiFilter.js';
export type {
  FilterConfiguration,
  FilterResult,
  EmojiFilterMode,
} from './filters/EmojiFilter.js';

// Export debug system
export {
  ConfigurationManager,
  DebugLogger,
  FileOutput,
} from './debug/index.js';
export type { DebugSettings, DebugOutputConfig } from './debug/index.js';
export type { LogEntry as DebugLogEntry } from './debug/index.js';

// Export Extension Loader
export {
  ExtensionLoader,
  SimpleExtensionLoader,
  type ExtensionEvents,
  type ExtensionsStartingEvent,
  type ExtensionsStoppingEvent,
  type GeminiCLIExtension,
} from './utils/extensionLoader.js';

// Export MCP Client Manager — re-exported from @vybestack/llxprt-code-mcp (also available above)

// Export models (legacy constants)
export * from './config/models.js';

// Export models registry (models.dev integration)
export * from './models/index.js';

// --- Subagent Feature: PLAN-20250117-SUBAGENTCONFIG ---
export { SubagentManager } from './config/subagentManager.js';
export type { SubagentConfig } from './config/types.js';
// --- End of Subagent Feature ---
export {
  SESSION_FILE_PREFIX,
  type ConversationRecord,
  type BaseMessageRecord,
  type ToolCallRecord,
} from './storage/sessionTypes.js';

// @plan PLAN-20260211-SESSIONRECORDING.P03
// Export session recording module
export * from './recording/index.js';
