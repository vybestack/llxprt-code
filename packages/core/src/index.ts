/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Export safety utilities
export * from './safety/index.js';

// Export config
export * from './config/config.js';
export * from './config/profileManager.js';
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

// Export types
export * from './types/modelParams.js';

// Export Commands logic
export * from './commands/extensions.js';
export * from './commands/types.js';

// Export Core Logic
export * from './core/client.js';
export * from './core/baseLlmClient.js';
export * from './core/contentGenerator.js';
export * from './core/geminiChat.js';
export * from './core/logger.js';
export * from './core/prompts.js';
export * from './core/tokenLimits.js';
export * from './core/turn.js';
export * from './core/geminiRequest.js';
export * from './core/coreToolScheduler.js';
export * from './core/nonInteractiveToolExecutor.js';
export type { SubagentSchedulerFactory } from './core/subagentScheduler.js';
export { buildContinuationDirective } from './core/compression/utils.js';

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

// Export auth system
export {
  AuthPrecedenceResolver,
  type AuthPrecedenceConfig,
  type OAuthManager,
  flushRuntimeAuthScope,
  type RuntimeAuthScopeFlushResult,
  type RuntimeAuthScopeCacheEntrySummary,
  type OAuthTokenRequestMetadata,
} from './auth/precedence.js';
export * from './auth/token-store.js';
export { KeyringTokenStore } from './auth/keyring-token-store.js';
export * from './auth/types.js';
export * from './auth/qwen-device-flow.js';
export * from './auth/anthropic-device-flow.js';
export * from './auth/codex-device-flow.js';
export * from './auth/oauth-errors.js';
// @plan:PLAN-20250214-CREDPROXY.P35 - Token merge utility for shared use
export {
  mergeRefreshedToken,
  type OAuthTokenWithExtras,
} from './auth/token-merge.js';
// @plan:PLAN-20250214-CREDPROXY.P33, P35 - Proxy mode credential store classes and utilities
export { ProxyTokenStore } from './auth/proxy/proxy-token-store.js';
export { ProxyProviderKeyStorage } from './auth/proxy/proxy-provider-key-storage.js';
export { ProxySocketClient } from './auth/proxy/proxy-socket-client.js';
export {
  FrameDecoder,
  FrameDecoderOptions,
  FrameError,
  encodeFrame,
  MAX_FRAME_SIZE,
  PARTIAL_FRAME_TIMEOUT_MS,
} from './auth/proxy/framing.js';
export { sanitizeTokenForProxy } from './auth/token-sanitization.js';

// Export services
export * from './services/fileDiscoveryService.js';
export * from './services/gitService.js';
export * from './services/tool-call-tracker-service.js';
export * from './services/todo-context-tracker.js';
export * from './services/fileSystemService.js';
export { ContextManager } from './services/contextManager.js';

// Export IDE specific logic
export * from './ide/ide-client.js';
export * from './ide/ideContext.js';
export * from './ide/ide-installer.js';
export {
  IDE_DEFINITIONS,
  detectIdeFromEnv,
  isCloudShell,
  type IdeInfo,
} from './ide/detect-ide.js';
export * from './ide/constants.js';

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
export * from './tools/mcp-client.js';
export {
  DiscoveredMCPTool,
  generateMcpToolName,
  generateValidName,
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
export {
  ProviderKeyStorage,
  getProviderKeyStorage,
  resetProviderKeyStorage,
  validateKeyName,
  KEY_NAME_REGEX,
} from './storage/provider-key-storage.js';
export {
  SecureStore,
  SecureStoreError,
  createDefaultKeyringAdapter,
  type KeyringAdapter,
  type SecureStoreErrorCode,
  type SecureStoreOptions,
} from './storage/secure-store.js';
export * from './todo/todoFormatter.js';

// MCP OAuth
export { MCPOAuthProvider } from './mcp/oauth-provider.js';
export { MCPOAuthTokenStorage } from './mcp/oauth-token-storage.js';
export type {
  MCPOAuthToken,
  MCPOAuthCredentials,
} from './mcp/oauth-token-storage.js';
export { BaseTokenStore } from './mcp/token-store.js';
export type {
  MCPOAuthToken as MCPOAuthTokenInterface,
  MCPOAuthCredentials as MCPOAuthCredentialsInterface,
} from './mcp/token-store.js';
export { FileTokenStore } from './mcp/file-token-store.js';
export type { MCPOAuthConfig } from './mcp/oauth-provider.js';
export type {
  OAuthAuthorizationServerMetadata,
  OAuthProtectedResourceMetadata,
} from './mcp/oauth-utils.js';
export { OAuthUtils } from './mcp/oauth-utils.js';

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

// Export settings system
export { SettingsService } from './settings/SettingsService.js';
export {
  getSettingsService,
  resetSettingsService,
  registerSettingsService,
} from './settings/settingsServiceInstance.js';
export type {
  ISettingsService,
  GlobalSettings,
  SettingsChangeEvent,
  ProviderSettings,
  UISettings,
  AdvancedSettings,
  EventListener,
  EventUnsubscribe,
} from './settings/types.js';
export type { TelemetrySettings as SettingsTelemetrySettings } from './settings/types.js';

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

// Export Storage
export { Storage } from './config/storage.js';

// Export Extension Loader
export {
  ExtensionLoader,
  SimpleExtensionLoader,
  type ExtensionEvents,
  type ExtensionsStartingEvent,
  type ExtensionsStoppingEvent,
  type GeminiCLIExtension,
} from './utils/extensionLoader.js';

// Export MCP Client Manager
export { McpClientManager } from './tools/mcp-client-manager.js';
export { McpClient } from './tools/mcp-client.js';

// Export models (legacy constants)
export * from './config/models.js';

// Export models registry (models.dev integration)
export * from './models/index.js';

// --- Subagent Feature: PLAN-20250117-SUBAGENTCONFIG ---
export { SubagentManager } from './config/subagentManager.js';
export { SubagentOrchestrator } from './core/subagentOrchestrator.js';
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

export {
  type SettingCategory,
  type SettingSpec,
  type ValidationResult,
  type SeparatedSettings,
  type DirectSettingSpec,
  SETTINGS_REGISTRY,
  separateSettings,
  getSettingSpec,
  resolveAlias,
  validateSetting,
  normalizeSetting,
  parseSetting,
  getProfilePersistableKeys,
  getSettingHelp,
  getCompletionOptions,
  getAllSettingKeys,
  getValidationHelp,
  getAutocompleteSuggestions,
  getProtectedSettingKeys,
  getProviderConfigKeys,
  getDirectSettingSpecs,
} from './settings/index.js';
