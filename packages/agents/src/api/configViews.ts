/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared config-view types that replace direct Config references (P07b).
 *
 * Each view is the intersection of the role interfaces a consumer needs, plus
 * explicit function signatures for service-locator getters that have no role
 * equivalent. Config satisfies every view structurally, so callers that pass
 * a real Config instance need no changes.
 */

import type {
  SessionIdentity,
  ModelSelection,
  EphemeralSettings,
  WorkspacePaths,
  MemoryAccess,
  ToolAccess,
  PolicyAccess,
  McpAccess,
  TelemetryAccess,
  Diagnostics,
  RuntimeLifecycle,
} from '@vybestack/llxprt-code-core/config/roles.js';
import type { EnvironmentContextConfig } from '@vybestack/llxprt-code-core/utils/environmentContext.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderManager.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import type { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import type { PolicyEngine } from '@vybestack/llxprt-code-core/policy/policy-engine.js';
import type { ShellJobManager } from '@vybestack/llxprt-code-core/services/shellJobManager.js';
import type { SkillManager } from '@vybestack/llxprt-code-core/skills/skillManager.js';
import type { PromptRegistry } from '@vybestack/llxprt-code-core/prompts/prompt-registry.js';
import type { ResourceRegistry } from '@vybestack/llxprt-code-core/resources/resource-registry.js';
import type { Storage } from '@vybestack/llxprt-code-settings/storage/Storage.js';
import type { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import type { HookSystem } from '@vybestack/llxprt-code-core/hooks/hookSystem.js';
import type { LspConfig } from '@vybestack/llxprt-code-ide-integration';
import type { LspStatusClient } from './control/lspControl.js';
import type { ToolSchedulerContract } from '@vybestack/llxprt-code-core/core/toolSchedulerContract.js';
import type {
  SchedulerCallbacks,
  SchedulerOptions,
} from '@vybestack/llxprt-code-core/config/schedulerSingleton.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';

type AllRoles = SessionIdentity &
  ModelSelection &
  EphemeralSettings &
  WorkspacePaths &
  MemoryAccess &
  ToolAccess &
  PolicyAccess &
  McpAccess &
  TelemetryAccess &
  Diagnostics &
  RuntimeLifecycle;

export type ExecutorConfigView = AllRoles &
  EnvironmentContextConfig & {
    getAgentClient: () => AgentClientContract;
    getProviderManager: () => RuntimeProviderManager | undefined;
    getSettingsService: () => SettingsService;
    getToolRegistry: () => ToolRegistry;
    getOrCreateScheduler: (
      sessionId: string,
      callbacks: SchedulerCallbacks,
      options?: SchedulerOptions,
      dependencies?: { messageBus?: MessageBus; toolRegistry?: ToolRegistry },
    ) => Promise<ToolSchedulerContract>;
  };

export type AgentImplConfigView = AllRoles & {
  readonly storage: Storage;
  getAgentClient: () => AgentClientContract;
  getAsyncTaskManager: () => AsyncTaskManager | undefined;
  getExtensionLoader: () => ExtensionLoader;
  getPolicyEngine: () => PolicyEngine;
  getShellJobManager: () => ShellJobManager | undefined;
  getSettingsService: () => SettingsService;
  getToolRegistry: () => ToolRegistry;
  getSkillManager: () => SkillManager;
  reloadSkills: () => Promise<void>;
  getLspConfig: () => LspConfig | undefined;
  getLspServiceClient: () => LspStatusClient | undefined;
  getDisabledHooks: () => string[];
  setDisabledHooks: (names: string[]) => void;
  getEnableHooks: () => boolean;
  getHookSystem: () => HookSystem | undefined;
  getPromptRegistry: () => PromptRegistry;
  getResourceRegistry: () => ResourceRegistry;
  setSessionRecordingService: (
    service: SessionRecordingService | undefined,
  ) => void;
  getOrCreateScheduler: (
    sessionId: string,
    callbacks: SchedulerCallbacks,
    options?: SchedulerOptions,
    dependencies?: { messageBus?: MessageBus; toolRegistry?: ToolRegistry },
  ) => Promise<ToolSchedulerContract>;
};
