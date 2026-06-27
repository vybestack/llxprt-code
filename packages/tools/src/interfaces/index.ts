/**
 * @plan:PLAN-20260608-ISSUE1585.P03
 * @requirement:REQ-INTERFACE-OWNERSHIP
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Barrel export for tools-owned interface contracts.
 *
 * All interfaces are defined in packages/tools and must not
 * import from packages/core, packages/cli, or packages/providers.
 */

export type {
  ApprovalMode,
  IToolHost,
  IToolHostFileFilteringOptions,
  IToolHostFileService,
  IToolHostFileSystemService,
  IToolHostGitStatsService,
} from './IToolHost.js';
export type { IToolRegistryHost } from './IToolRegistryHost.js';
export type {
  IToolMessageBus,
  ToolConfirmationOutcome,
  PolicyUpdateOptions,
  ToolMessageHandler,
  ToolMessageEvent,
  Unsubscribe,
  PublishCapable,
  PublishSubscribeCapable,
} from './IToolMessageBus.js';
export { hasPublish, hasPublishSubscribe } from './IToolMessageBus.js';
export type {
  IShellExecutionService,
  ShellOptions,
  ShellResult,
} from './IShellExecutionService.js';
export type {
  ISubagentService,
  SubagentExecutionOptions,
  SubagentRequest,
  SubagentResult,
  SubagentInfo,
  SubagentConfig,
} from './ISubagentService.js';
export type {
  IAsyncTaskService,
  AsyncTaskStatus,
  AsyncTaskInfo,
  AsyncTaskLookupResult,
} from './IAsyncTaskService.js';
export type {
  ISkillService,
  SkillActivationResult,
  SkillManager,
  SkillInfo,
} from './ISkillService.js';
export type {
  IMcpToolService,
  McpFunctionCall,
  McpResponsePart,
  McpToolParams,
} from './IMcpToolService.js';
export type {
  IIdeService,
  DiffParams,
  DiffUpdateResult,
  IDEConnectionStatus,
  OpenDiffParams,
} from './IIdeService.js';
export type { ILspService, Diagnostic, LspConfig } from './ILspService.js';
export type { IStorageService } from './IStorageService.js';
export type { IToolKeyStorage } from './IToolKeyStorage.js';
export type {
  ITodoService,
  TodoStore,
  TodoReminderService,
  TodoContextTracker,
} from './ITodoService.js';
export type { ISettingsService, SettingsService } from './ISettingsService.js';
export type {
  IShellToolHost,
  ShellExecutionResult,
  ShellOutputEvent,
  CommandPolicyResult,
  OutputLimits,
  ShellExecutionConfig,
  ShellTimeoutConfig,
  CommandRootsResult,
} from './IShellToolHost.js';
export type {
  ITaskToolHost,
  LaunchedSubagent,
  ISubagentScope,
  ISubagentOutput,
  TaskLaunchRequest,
  TaskTimeoutConfig,
  AsyncSettingsCheck,
  AsyncSlotResult,
  AsyncTaskRegistration,
  CanLaunchResult,
  IToolGovernance,
} from './ITaskToolHost.js';
export type {
  IPromptRegistryService,
  PromptRegistry,
  Prompt,
} from './IPromptRegistryService.js';
export type {
  IWebSearchService,
  WebSearchServerToolsProvider,
} from './IWebSearchService.js';
export type {
  HostWorkspaceContextCap,
  HostIdeCap,
  HostLspCap,
} from './host-capabilities.js';
export {
  hasWorkspaceContextCap,
  hasIdeCap,
  hasLspCap,
} from './host-capabilities.js';
