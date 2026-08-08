/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Explicit dependency record for composition roots (issue #2615, P06).
 *
 * Every previous attempt at this refactor stalled at the composition roots
 * because a root reads 8–25 Config members and no capability interface looked
 * meaningful. The key insight: a root genuinely needs many dependencies, but it
 * does not need them **as a Config**. It needs them as an explicit record.
 *
 * {@link RuntimeDependencies} is that record. It is composed of the P05 role
 * interfaces (each as a named field) plus the services that roots formerly
 * fetched through service-locator getters on Config. No service-locator accessor
 * (getXManager / getXService / getXRegistry) appears here — the services are
 * direct fields.
 *
 * @see project-plans/issue2615/plan/06-composition-roots.md
 */

import type { Config } from './config.js';

import type { SessionIdentity } from './roles/sessionIdentity.js';
import type { ModelSelection } from './roles/modelSelection.js';
import type { EphemeralSettings } from './roles/ephemeralSettings.js';
import type { WorkspacePaths } from './roles/workspacePaths.js';
import type { MemoryAccess } from './roles/memoryAccess.js';
import type { ToolAccess } from './roles/toolAccess.js';
import type { PolicyAccess } from './roles/policyAccess.js';
import type { McpAccess } from './roles/mcpAccess.js';
import type { TelemetryAccess } from './roles/telemetryAccess.js';
import type { Diagnostics } from './roles/diagnostics.js';

import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { RuntimeProviderManager } from '../runtime/contracts/RuntimeProviderManager.js';
import type {
  ProfileManager,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import type { PolicyEngine } from '../policy/policy-engine.js';
import type { PromptRegistry } from '../prompts/prompt-registry.js';
import type { ResourceRegistry } from '../resources/resource-registry.js';
import type { ExtensionLoader } from '../utils/extensionLoader.js';
import type {
  AgentClientContract,
  AgentClientFactory,
} from '../core/clientContract.js';
import type { SubagentManager } from './subagentManager.js';
import type { AsyncTaskManager } from '../services/asyncTaskManager.js';
import type { ShellJobManager } from '../services/shellJobManager.js';
import type { FileSystemService } from '../services/fileSystemService.js';
import type { SessionRecordingService } from '../recording/SessionRecordingService.js';
import type {
  ToolSchedulerFactory,
  ToolSchedulerContract,
} from '../core/toolSchedulerContract.js';
import type {
  SchedulerCallbacks,
  SchedulerOptions,
} from './schedulerSingleton.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';

/**
 * Explicit dependency record handed to composition roots instead of a Config.
 *
 * The role-interface fields are satisfied structurally by Config (it implements
 * every role). The service fields are the services that roots formerly fetched
 * via `config.getXManager()` / `config.getXService()` getters — now direct
 * references.
 *
 * Each field exists because at least one composition root reads it (see
 * `project-plans/issue2615/analysis/role-assignment.json` →
 * `serviceLocators[].compositionRootsNeedingIt`). Service locators with zero
 * composition-root consumers (e.g. `getHookSystem`, `getMcpClientManager`,
 * `storage`) are intentionally absent.
 */
export interface RuntimeDependencies {
  // ── Role interfaces (P05) ──────────────────────────────────────────────
  readonly session: SessionIdentity;
  readonly model: ModelSelection;
  readonly settings: EphemeralSettings;
  readonly paths: WorkspacePaths;
  readonly memory: MemoryAccess;
  readonly tools: ToolAccess;
  readonly policy: PolicyAccess;
  readonly mcp: McpAccess;
  readonly telemetry: TelemetryAccess;
  readonly diagnostics: Diagnostics;

  // ── Service-locator fields (formerly fetched via getters on Config) ────
  readonly toolRegistry: ToolRegistry;
  readonly providerManager: RuntimeProviderManager | undefined;
  readonly settingsService: SettingsService;
  readonly policyEngine: PolicyEngine;
  readonly promptRegistry: PromptRegistry;
  readonly resourceRegistry: ResourceRegistry;
  readonly profileManager: ProfileManager | undefined;
  readonly extensionLoader: ExtensionLoader;
  readonly agentClient: AgentClientContract;
  readonly subagentManager: SubagentManager | undefined;
  readonly asyncTaskManager: AsyncTaskManager | undefined;
  readonly shellJobManager: ShellJobManager | undefined;
  readonly fileSystemService: FileSystemService;
  readonly sessionRecordingService: SessionRecordingService | undefined;
  readonly toolSchedulerFactory: ToolSchedulerFactory | undefined;
  readonly agentClientFactory: AgentClientFactory | undefined;

  /**
   * Creates (or retrieves a cached) tool scheduler for a given session.
   * Formerly `config.getOrCreateScheduler(…)`.
   */
  readonly getOrCreateScheduler: (
    sessionId: string,
    callbacks: SchedulerCallbacks,
    options?: SchedulerOptions,
    dependencies?: {
      messageBus?: MessageBus;
      toolRegistry?: ToolRegistry;
    },
  ) => Promise<ToolSchedulerContract>;
}

/**
 * The composition step: reads a concrete Config and produces the explicit
 * dependency record that composition roots consume.
 *
 * This is the ONLY place outside core's own internals that reads the
 * service-locator getters. Application entry points call this once, after
 * runtime services have been wired into Config (postConfigRuntime, provider
 * switch, etc.), and pass the resulting record to every root.
 */
export function runtimeDependenciesFromConfig(
  config: Config,
): RuntimeDependencies {
  return {
    session: config,
    model: config,
    settings: config,
    paths: config,
    memory: config,
    tools: config,
    policy: config,
    mcp: config,
    telemetry: config,
    diagnostics: config,

    toolRegistry: config.getToolRegistry(),
    providerManager: config.getProviderManager(),
    settingsService: config.getSettingsService(),
    policyEngine: config.getPolicyEngine(),
    promptRegistry: config.getPromptRegistry(),
    resourceRegistry: config.getResourceRegistry(),
    profileManager: config.getProfileManager(),
    extensionLoader: config.getExtensionLoader(),
    agentClient: config.getAgentClient(),
    subagentManager: config.getSubagentManager(),
    asyncTaskManager: config.getAsyncTaskManager(),
    shellJobManager: config.getShellJobManager(),
    fileSystemService: config.getFileSystemService(),
    sessionRecordingService: config.getSessionRecordingService(),
    toolSchedulerFactory: config.getToolSchedulerFactory(),
    agentClientFactory: config.getAgentClientFactory(),
    getOrCreateScheduler: config.getOrCreateScheduler.bind(config),
  };
}

/**
 * Structural type guard that identifies a concrete Config (or any object that
 * structurally satisfies it) without importing the class for an `instanceof`
 * check (issue #2615, P06b Gap 3).
 *
 * Two members unique to the Config hierarchy are checked: `getSessionId`
 * (SessionIdentity role) and `initialize` (RuntimeLifecycle role). Their
 * combination is sufficient to distinguish a Config from any other runtime
 * object in the codebase.
 *
 * During the bottom-up migration (P07–P10) the values passing through this
 * guard are still Config instances; once the migration completes the guard can
 * be tightened to check for the RuntimeDependencies record shape instead.
 */
export function isRuntimeDependencies(value: unknown): value is Config {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.getSessionId === 'function' &&
    typeof record.initialize === 'function'
  );
}
