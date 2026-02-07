/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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

// Export message bus
export * from './confirmation-bus/types.js';
export * from './confirmation-bus/message-bus.js';

// Export services
export * from './services/git-stats-service.js';

// Export types
export * from './types/modelParams.js';

// Export Commands logic
export * from './commands/extensions.js';

// Export Core Logic
export * from './core/client.js';
export * from './core/baseLlmClient.js';
export * from './core/contentGenerator.js';
export * from './core/loggingContentGenerator.js';
export * from './core/geminiChat.js';
export * from './core/logger.js';
export * from './core/prompts.js';
export * from './core/tokenLimits.js';
export * from './core/turn.js';
export * from './core/geminiRequest.js';
export * from './core/coreToolScheduler.js';
export * from './core/nonInteractiveToolExecutor.js';
export type { SubagentSchedulerFactory } from './core/subagentScheduler.js';

export * from './code_assist/codeAssist.js';
export * from './code_assist/oauth2.js';
export * from './code_assist/server.js';
export * from './code_assist/types.js';

// Export utilities
export * from './utils/paths.js';
export * from './utils/ripgrepPathResolver.js';
export * from './utils/schemaValidator.js';
export * from './utils/errors.js';
export * from './utils/output-format.js';
export * from './utils/getFolderStructure.js';
export * from './utils/memoryDiscovery.js';
export * from './utils/gitIgnoreParser.js';
export * from './utils/gitUtils.js';
export * from './utils/editor.js';
export * from './utils/quotaErrorDetection.js';
export * from './utils/fileUtils.js';
export * from './utils/delay.js';
export * from './utils/retry.js';
export * from './utils/shell-utils.js';
export * from './utils/shell-markers.js';
export * from './utils/systemEncoding.js';
export * from './utils/textUtils.js';
export * from './utils/formatters.js';
export * from './utils/sanitization.js';
export * from './utils/unicodeUtils.js';
export * from './utils/generateContentResponseUtilities.js';
export * from './utils/filesearch/fileSearch.js';
export * from './utils/secure-browser-launcher.js';
export * from './utils/errorParsing.js';
export * from './utils/ignorePatterns.js';
export * from './utils/partUtils.js';
export * from './utils/ide-trust.js';
export * from './utils/thoughtUtils.js';
export * from './utils/events.js';
export * from './utils/package.js';
export * from './utils/extensionLoader.js';
export * from './utils/terminalSerializer.js';

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
export * from './auth/types.js';
export * from './auth/qwen-device-flow.js';
export * from './auth/anthropic-device-flow.js';
export * from './auth/codex-device-flow.js';
export * from './auth/oauth-errors.js';

// Export services
export * from './services/fileDiscoveryService.js';
export * from './services/gitService.js';
export * from './services/tool-call-tracker-service.js';
export * from './services/todo-context-tracker.js';
export * from './services/fileSystemService.js';

// Export IDE specific logic
export * from './ide/ide-client.js';
export * from './ide/ideContext.js';
export * from './ide/ide-installer.js';
export {
  IDE_DEFINITIONS,
  detectIdeFromEnv,
  type IdeInfo,
} from './ide/detect-ide.js';
export * from './ide/constants.js';

// Export Shell Execution Service
export * from './services/shellExecutionService.js';

// Export base tool definitions
export * from './tools/tools.js';
export * from './tools/tool-error.js';
export * from './tools/tool-registry.js';
export * from './tools/tool-context.js';
export * from './tools/tool-names.js';

// Export prompt logic
export * from './prompts/mcp-prompts.js';

// Export prompt configuration system
export * from './prompt-config/prompt-service.js';
export * from './prompt-config/types.js';

// Export specific tool logic
export * from './tools/read-file.js';
export * from './tools/ls.js';
export * from './tools/grep.js';
export * from './tools/ripGrep.js';
export * from './tools/glob.js';
export * from './tools/edit.js';
export * from './tools/write-file.js';
export * from './tools/google-web-fetch.js';
export * from './tools/direct-web-fetch.js';
export * from './tools/memoryTool.js';
export * from './tools/shell.js';
export * from './tools/google-web-search.js';
export * from './tools/exa-web-search.js';
export * from './tools/codesearch.js';
export * from './tools/read-many-files.js';
export * from './tools/mcp-client.js';
export * from './tools/mcp-tool.js';
export * from './tools/todo-read.js';
export * from './tools/todo-write.js';
export * from './tools/todo-pause.js';
export * from './tools/todo-schemas.js';
export * from './tools/todo-store.js';
export * from './tools/todo-events.js';
export * from './tools/list-subagents.js';
export * from './tools/task.js';
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
// Export provider types and classes
export type {
  Provider,
  ProviderMessage,
  ProviderTool,
  ProviderToolCall,
} from './providers/types.js';
// Export the actual interfaces too
export * from './providers/IProvider.js';
export type {
  GenerateChatOptions,
  ProviderToolset,
} from './providers/IProvider.js';
export * from './providers/ITool.js';
export * from './providers/IModel.js';
export * from './providers/IProviderManager.js';
export * from './providers/ContentGeneratorRole.js';
export * from './providers/ProviderContentGenerator.js';
export * from './providers/ProviderManager.js';

// Export content interfaces
export * from './services/history/IContent.js';

// Export provider implementations
export { OpenAIProvider } from './providers/openai/OpenAIProvider.js';
export { OpenAIResponsesProvider } from './providers/openai-responses/OpenAIResponsesProvider.js';
export { ConversationCache } from './providers/openai/ConversationCache.js';
export { getOpenAIProviderInfo } from './providers/openai/getOpenAIProviderInfo.js';
export { OpenAIVercelProvider } from './providers/openai-vercel/index.js';
export { AnthropicProvider } from './providers/anthropic/AnthropicProvider.js';
export * from './providers/anthropic/usageInfo.js';
export * from './providers/openai/codexUsageInfo.js';
export { GeminiProvider } from './providers/gemini/GeminiProvider.js';
export * from './providers/ProviderManager.js';
export * from './providers/errors.js';
export {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
  type LoadBalancerSubProfile,
  type LoadBalancerStats,
  type ExtendedLoadBalancerStats,
  type BackendMetrics,
  type CircuitBreakerState,
  type ResolvedSubProfile,
} from './providers/LoadBalancingProvider.js';

// Export provider utilities
export type { DumpMode } from './providers/utils/dumpContext.js';

// Export tokenizers
export * from './providers/tokenizers/ITokenizer.js';
export * from './providers/tokenizers/OpenAITokenizer.js';
export * from './providers/tokenizers/AnthropicTokenizer.js';
export * from './utils/browser.js';
export * from './utils/generateContentResponseUtilities.js';

// Export adapters
export * from './adapters/IStreamAdapter.js';

// Export parsers
export * from './parsers/TextToolCallParser.js';

// Export tool formatters
export * from './tools/IToolFormatter.js';
export * from './tools/ToolFormatter.js';

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
  setProviderRuntimeContextFallback,
} from './runtime/providerRuntimeContext.js';
export type { ProviderRuntimeContext } from './runtime/providerRuntimeContext.js';

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
} from './storage/sessionTypes.js';

export {
  SessionPersistenceService,
  type PersistedSession,
  type PersistedUIHistoryItem,
  type PersistedToolCall,
} from './storage/SessionPersistenceService.js';

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
