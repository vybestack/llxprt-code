/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:ISSUE-3222
 * @requirement:REQ-3222-AC2
 *
 * Agent-owned runtime assembly. The public Agent API (createAgent/fromConfig)
 * builds complete shipped runtimes itself: the agent client and task-tool
 * registration, the session scheduler owner, the runtime managers, and the
 * isolated-runtime Config for subagent runtimes. Config defaults are installed
 * only where absent. Scheduler factories are supplied to session execution.
 * Nothing here registers into module-global state.
 */

import * as path from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createToolRegistry } from '@vybestack/llxprt-code-core/config/toolRegistryFactory.js';
import { CoreSkillServiceAdapter } from '@vybestack/llxprt-code-core';
import type { AnyDeclarativeTool } from '@vybestack/llxprt-code-tools';
import { ActivateMcpServerTool } from '@vybestack/llxprt-code-tools';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import {
  AsyncTaskAutoTrigger,
  AsyncTaskManager,
  AsyncTaskReminderService,
  resolveMaxAsyncTasks,
} from '@vybestack/llxprt-code-core';
import {
  resolveShellJobSettings,
  normalizeShellMaxBackgroundJobs,
} from '@vybestack/llxprt-code-core/config/asyncTaskServices.js';
import { ShellNotificationAdapter } from '@vybestack/llxprt-code-core/services/shellNotificationAdapter.js';
import { ShellJobManager } from '@vybestack/llxprt-code-core/services/shellJobManager.js';
import type { SubagentSchedulerFactory } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { createSessionSchedulerRegistry } from '@vybestack/llxprt-code-core';
import type { SchedulerHandle } from '@vybestack/llxprt-code-core/session/sessionExecutionServices.js';
import type {
  SchedulerCallbacks,
  SchedulerOptions,
  SchedulerPurpose,
} from '@vybestack/llxprt-code-core/session/sessionSchedulerRegistry.js';
import type { ToolSchedulerFactory } from '@vybestack/llxprt-code-core/core/toolSchedulerContract.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { ProfileManager, Storage } from '@vybestack/llxprt-code-settings';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IsolatedRuntimeContextHandle } from '@vybestack/llxprt-code-providers/runtime.js';
import { CoreToolScheduler } from '../core/coreToolScheduler.js';
import { buildAgentClientFactory } from './agentBootstrap.js';
import { createTaskRegistration } from './runtimeFactories.js';
import { TaskTool } from '../tools/task.js';
import { registerActivateSkillTool } from '../skill-tool-registrar.js';
import { syncActivateMcpServerTool } from '@vybestack/llxprt-code-core/config/mcp-lazy-tool-sync.js';
import type { Agent } from './agent.js';

const DEFAULT_MODEL = 'gemini-1.5-flash';
const DEFAULT_DEBUG_MODE = false;

export interface SessionApprovalBus {
  readonly messageBus: MessageBus;
  dispose(): void;
}

export function createSessionApprovalBus(
  config: Config,
  borrowedBus?: MessageBus,
): SessionApprovalBus {
  const messageBus =
    borrowedBus ??
    new MessageBus(config.getPolicyEngine(), config.getDebugMode());
  return {
    messageBus,
    dispose: () => {
      if (borrowedBus === undefined) {
        messageBus.removeAllListeners();
      }
    },
  };
}

export interface SessionSchedulerOwner {
  setToolRegistry(registry: ToolRegistry, source: ToolRegistry): void;
  getToolRegistry(): ToolRegistry;
  acquire(
    owner: object,
    purpose: SchedulerPurpose,
    callbacks: SchedulerCallbacks,
    options: SchedulerOptions | undefined,
    dependencies: { messageBus: MessageBus; toolRegistry: ToolRegistry },
  ): Promise<SchedulerHandle>;
  release(owner: object, purpose: SchedulerPurpose, handle: object): void;
  setInteractiveSubagentSchedulerFactory(
    factory: SubagentSchedulerFactory | undefined,
  ): void;
  getInteractiveSubagentSchedulerFactory():
    | SubagentSchedulerFactory
    | undefined;
  cancelAll(): Promise<void>;
  dispose(): Promise<void>;
}

function sessionSchedulerFactory(
  config: Config,
  factory: ToolSchedulerFactory,
): Parameters<typeof createSessionSchedulerRegistry>[0]['createScheduler'] {
  return async (options) => {
    const { messageBus, toolRegistry } = options;
    if (messageBus === undefined || toolRegistry === undefined) {
      throw new Error('Scheduler acquisition requires a bus and tool registry');
    }
    return factory({
      config,
      messageBus,
      toolRegistry,
      toolContextInteractiveMode: options.interactiveMode ?? true,
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });
  };
}

/** A registry belongs to this session, while each entry binds its first acquisition. */
export function createSessionSchedulerOwner(
  config: Config,
  factory: ToolSchedulerFactory,
): SessionSchedulerOwner {
  const registry = createSessionSchedulerRegistry({
    createScheduler: sessionSchedulerFactory(config, factory),
  });
  let closing = false;
  let interactiveSubagentSchedulerFactory: SubagentSchedulerFactory | undefined;
  const isClosing = (): boolean => closing;
  let cleanup: Promise<void> = Promise.resolve();
  let sessionRegistry: ToolRegistry | undefined;
  let sourceRegistry: ToolRegistry | undefined;
  return {
    setToolRegistry(registry, source) {
      if (sessionRegistry !== undefined) {
        throw new Error('Session tool registry was already bound');
      }
      sessionRegistry = registry;
      sourceRegistry = source;
    },
    getToolRegistry() {
      if (sessionRegistry === undefined) {
        throw new Error('Session tool registry is not bound');
      }
      return sessionRegistry;
    },
    async acquire(owner, purpose, callbacks, options, dependencies) {
      if (closing) {
        throw new Error('Session scheduler owner is disposed');
      }
      const handle = await registry.getOrCreate(owner, purpose, {
        ...options,
        ...dependencies,
        toolRegistry:
          sessionRegistry !== undefined &&
          (dependencies.toolRegistry === sourceRegistry ||
            dependencies.toolRegistry === config.getToolRegistry())
            ? sessionRegistry
            : dependencies.toolRegistry,
      });
      if (isClosing()) {
        registry.release(owner, purpose, handle);
        throw new Error('Session scheduler owner is disposed');
      }
      handle.setCallbacks({ config, ...callbacks });
      return handle;
    },
    release(owner, purpose, handle) {
      registry.release(owner, purpose, handle);
    },
    setInteractiveSubagentSchedulerFactory(factory) {
      interactiveSubagentSchedulerFactory = factory;
    },
    getInteractiveSubagentSchedulerFactory() {
      return interactiveSubagentSchedulerFactory;
    },
    cancelAll() {
      return registry.cancelAll();
    },
    dispose() {
      if (!closing) {
        closing = true;
        cleanup = registry.disposeAll();
      }
      return cleanup;
    },
  };
}

export async function createSessionAgentClient(
  config: Config,
  registry: ToolRegistry,
  runtimeState: AgentRuntimeState,
): Promise<AgentClientContract> {
  const factory = config.getAgentClientFactory();
  if (factory === undefined) {
    throw new Error('Session client requires an agent client factory');
  }
  const view = new Proxy(config, {
    get(target, property) {
      if (property === 'getToolRegistry') return () => registry;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const client = factory(view, runtimeState);
  if (client === config.getAgentClient()) {
    throw new Error('Session client factory returned the caller-owned client');
  }
  try {
    const history = await config.getAgentClient().getHistory();
    if (history.length > 0) {
      await client.storeHistoryForLaterUse(history);
    }
    const contentGeneratorConfig = config.getContentGeneratorConfig();
    if (contentGeneratorConfig !== undefined) {
      await client.initialize(contentGeneratorConfig);
    }
    return client;
  } catch (error) {
    await client.dispose();
    throw error;
  }
}

export async function bindSessionTaskTools(
  config: Config,
  messageBus: MessageBus,
  taskManager: AsyncTaskManager,
  schedulerOwner: SessionSchedulerOwner,
  shellJobs: ShellJobManager,
): Promise<void> {
  const source = config.getToolRegistry();
  const { registry } = await createToolRegistry(
    config,
    config,
    messageBus,
    () => taskManager,
    () => shellJobs,
  );
  const task = registry.getTool(TaskTool.Name);
  if (task instanceof TaskTool) {
    task.bindSessionExecution(schedulerOwner, messageBus, () => taskManager);
  }
  schedulerOwner.setToolRegistry(registry, source);
  publishSessionSkills(config, registry, messageBus);
  await refreshSessionMcpTools(source, registry, messageBus);
}

function publishSessionSkills(
  config: Config,
  registry: ToolRegistry,
  messageBus: MessageBus,
): void {
  if (!config.isSkillsSupportEnabled()) return;
  (config.getPostSkillDiscoveryToolRegistrar() ?? registerActivateSkillTool)(
    registry,
    new CoreSkillServiceAdapter(config),
    messageBus,
  );
}

function isMcpTool(tool: AnyDeclarativeTool): tool is AnyDeclarativeTool & {
  serverName: string;
  forSession(messageBus: MessageBus): AnyDeclarativeTool;
} {
  return (
    'serverName' in tool &&
    typeof tool.serverName === 'string' &&
    'forSession' in tool &&
    typeof tool.forSession === 'function'
  );
}

export async function refreshSessionMcpTools(
  source: ToolRegistry,
  registry: ToolRegistry,
  messageBus: MessageBus,
): Promise<void> {
  const discovered = source.getAllTools().filter(isMcpTool);
  const names = new Set(discovered.map((tool) => tool.name));
  for (const tool of registry.getAllTools()) {
    if (isMcpTool(tool) && !names.has(tool.name)) {
      registry.unregisterTool(tool.name);
    }
  }
  for (const tool of discovered) {
    registry.unregisterTool(tool.name);
    registry.registerTool(tool.forSession(messageBus));
  }
  if (
    registry.getTool(ActivateMcpServerTool.Name) instanceof
    ActivateMcpServerTool
  ) {
    registry.unregisterTool(ActivateMcpServerTool.Name);
  }
  await syncActivateMcpServerTool(registry, messageBus, () =>
    refreshSessionMcpTools(source, registry, messageBus),
  );
}

export function bindSessionSurfaceUpdates(
  config: Config,
  messageBus: MessageBus,
  tasks: SessionTaskServices,
  schedulerOwner: SessionSchedulerOwner,
  client: AgentClientContract,
): void {
  const source = config.getToolRegistry();
  tasks.registerCleanup(
    config.subscribeSkillSurface(async () => {
      publishSessionSkills(
        config,
        schedulerOwner.getToolRegistry(),
        messageBus,
      );
      if (client.isInitialized()) {
        await client.setTools();
      }
    }),
  );
  tasks.registerCleanup(
    config.subscribeMcpSurface(async () => {
      await refreshSessionMcpTools(
        source,
        schedulerOwner.getToolRegistry(),
        messageBus,
      );
      await client.setTools();
      await client.updateSystemInstruction();
    }),
  );
}

export function createShellJobManager(
  options: ReturnType<typeof resolveShellJobSettings>,
): ShellJobManager {
  return new ShellJobManager(options);
}

export class SessionTaskServices {
  readonly manager: AsyncTaskManager;
  readonly shellJobs: ShellJobManager;
  private readonly reminder: AsyncTaskReminderService;
  private autoTrigger: AsyncTaskAutoTrigger | undefined;
  private readonly subscriptions = new Set<() => void>();
  private readonly admissionFailures: unknown[] = [];
  private disposed = false;
  private disposal: Promise<void> | undefined;
  private readonly onSettingsChanged: (event: { key: string }) => void;

  constructor(private readonly settings: SettingsService) {
    this.manager = new AsyncTaskManager(resolveMaxAsyncTasks(settings));
    this.shellJobs = createShellJobManager(resolveShellJobSettings(settings));
    this.reminder = new AsyncTaskReminderService(this.manager);
    const shellSource = new ShellNotificationAdapter(this.shellJobs);
    this.reminder.setShellNotificationSource(shellSource);
    this.onSettingsChanged = (event) => {
      if (event.key === 'task-max-async') {
        this.manager.setMaxAsyncTasks(resolveMaxAsyncTasks(this.settings));
      }
      if (event.key === 'shell-max-background-jobs') {
        this.shellJobs.setMaxBackgroundJobs(
          normalizeShellMaxBackgroundJobs(
            this.settings.get('shell-max-background-jobs'),
          ),
        );
      }
    };
    this.settings.on('change', this.onSettingsChanged);
  }

  registerCleanup(cleanup: () => void): void {
    if (this.disposed) {
      throw new Error('Session task services are disposed');
    }
    this.subscriptions.add(cleanup);
  }

  setupAutoTrigger(
    isAgentBusy: () => boolean,
    triggerAgentTurn: (message: string) => Promise<void>,
  ): () => void {
    if (this.disposed) {
      throw new Error('Session task services are disposed');
    }
    const shellSource = new ShellNotificationAdapter(this.shellJobs);
    if (this.autoTrigger === undefined) {
      this.autoTrigger = new AsyncTaskAutoTrigger(
        this.manager,
        this.reminder,
        isAgentBusy,
        triggerAgentTurn,
      );
    } else {
      this.autoTrigger.updateCallbacks(isAgentBusy, triggerAgentTurn);
    }
    this.autoTrigger.setShellNotificationSource(shellSource);
    const unsubscribe = this.autoTrigger.subscribe();
    let subscribed = true;
    const cleanup = (): void => {
      if (!subscribed) return;
      subscribed = false;
      this.subscriptions.delete(cleanup);
      unsubscribe();
    };
    this.subscriptions.add(cleanup);
    return cleanup;
  }

  stopAdmissions(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.manager.stopAdmissions();
    this.shellJobs.stopAdmissions();
    for (const unsubscribe of [...this.subscriptions]) {
      this.subscriptions.delete(unsubscribe);
      try {
        unsubscribe();
      } catch (error) {
        this.admissionFailures.push(error);
      }
    }
  }

  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal;
    let resolveDisposal: (() => void) | undefined;
    let rejectDisposal: ((error: unknown) => void) | undefined;
    const disposal = new Promise<void>((resolve, reject) => {
      resolveDisposal = resolve;
      rejectDisposal = reject;
    });
    this.disposal = disposal;
    this.stopAdmissions();
    const failures: unknown[] = [...this.admissionFailures];
    const pending: Array<Promise<void>> = [];
    const start = (action: () => void | Promise<void>): void => {
      try {
        pending.push(Promise.resolve(action()));
      } catch (error) {
        failures.push(error);
      }
    };
    start(() => this.manager.close());
    start(() => this.shellJobs.dispose());
    for (const unsubscribe of [...this.subscriptions]) {
      try {
        unsubscribe();
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      this.settings.off('change', this.onSettingsChanged);
    } catch (error) {
      failures.push(error);
    }
    void Promise.allSettled(pending)
      .then((results) => {
        for (const result of results) {
          if (result.status === 'rejected') {
            if (result.reason instanceof AggregateError) {
              failures.push(...result.reason.errors);
            } else {
              failures.push(result.reason);
            }
          }
        }
        if (failures.length > 0) {
          throw new AggregateError(failures, 'Session task cleanup failed');
        }
      })
      .then(
        () => resolveDisposal?.(),
        (error: unknown) => rejectDisposal?.(error),
      );
    return this.disposal;
  }
}

export function createSessionTaskServices(
  settings: SettingsService,
): SessionTaskServices {
  return new SessionTaskServices(settings);
}

/** Assemble the two per-agent services before activation or adoption. */
export function createAgentSessionExecution(
  config: Config,
  settings: SettingsService,
  factory?: ToolSchedulerFactory,
): {
  tasks: SessionTaskServices;
  schedulerOwner: SessionSchedulerOwner;
} {
  return {
    tasks: createSessionTaskServices(settings),
    schedulerOwner: createSessionSchedulerOwner(
      config,
      factory ?? ((options) => new CoreToolScheduler(options)),
    ),
  };
}

/**
 * Installs the agent client factory and task registration defaults on Config
 * only when absent. Scheduler construction belongs to session execution and
 * its optional caller-supplied factory, not to Config.
 */
export function ensureAgentRuntimeFactories(config: Config): void {
  if (config.getAgentClientFactory() === undefined) {
    config.setAgentClientFactory(buildAgentClientFactory());
  }
  if (config.getTaskToolRegistration() === undefined) {
    config.setTaskToolRegistration(createTaskRegistration());
  }
}

/**
 * Ensures the runtime managers are attached to a Config. Mirrors the exact
 * resolution the providers runtime factory performed for every isolated
 * runtime: an explicit profileManager wins, then the Config's own, then a
 * fresh ProfileManager under the global config dir; the SubagentManager
 * adopts the Config's own or is built under the global config dir. Setters
 * run only when the Config reports absence.
 */
export function ensureRuntimeManagers(
  config: Config,
  profileManager?: ProfileManager,
): void {
  const llxprtDir = Storage.getGlobalConfigDir();
  // Option-first precedence: an explicit profileManager wins over the
  // Config's own; only when both are absent does a fresh one get built.
  const resolvedProfileManager =
    profileManager ??
    config.getProfileManager() ??
    new ProfileManager(path.join(llxprtDir, 'profiles'));
  config.setProfileManager(resolvedProfileManager);
  if (config.getSubagentManager() === undefined) {
    config.setSubagentManager(
      new SubagentManager(
        path.join(llxprtDir, 'subagents'),
        resolvedProfileManager,
      ),
    );
  }
}

/** Inputs for {@link buildIsolatedAgentConfig}. */
export interface IsolatedAgentConfigInputs {
  readonly sessionId: string;
  readonly workspaceDir?: string;
  readonly model?: string;
  readonly settingsService: SettingsService;
  readonly profileManager?: ProfileManager;
}

/**
 * Builds the isolated-runtime Config for agent-owned runtimes (subagents,
 * compression, role runtimes): fresh Config with the provider-factory
 * construction defaults, then agent-owned factories and runtime managers.
 */
export function buildIsolatedAgentConfig(
  inputs: IsolatedAgentConfigInputs,
): Config {
  const workspaceDir = inputs.workspaceDir ?? process.cwd();
  const config = new Config({
    sessionId: inputs.sessionId,
    targetDir: workspaceDir,
    debugMode: DEFAULT_DEBUG_MODE,
    cwd: workspaceDir,
    model: inputs.model ?? DEFAULT_MODEL,
    settingsService: inputs.settingsService,
  });
  ensureAgentRuntimeFactories(config);
  ensureRuntimeManagers(config, inputs.profileManager);
  return config;
}

/**
 * Extra teardown context for {@link cleanupFailedRuntimeBootstrap} beyond the
 * isolated runtime handle.
 */
export interface FailedBootstrapTeardown {
  readonly sessionClient?: AgentClientContract;
  readonly approvalBus?: SessionApprovalBus;
  readonly taskServices?: SessionTaskServices;
  readonly schedulerOwner?: SessionSchedulerOwner;
  /**
   * The fully built Agent facade, when the failure happened AFTER finalize
   * (e.g. session-start). Its idempotent dispose() is the complete teardown —
   * isolated handle, agent-owned Config, hooks — and replaces piecemeal
   * cleanup.
   */
  readonly facade?: Agent;
  /**
   * The agent-owned Config to dispose when no facade exists yet. Disposed
   * AFTER the isolated handle (children before parents): initialize() started
   * MCP discovery, the extension loader, LSP and the AgentClient on it, and
   * only Config.dispose() releases those — except the LSP service, which
   * Config.dispose() does NOT stop and which cleanupFailedRuntimeBootstrap
   * shuts down explicitly after the dispose. Caller-owned Configs (fromConfig
   * adopts one) are never passed here.
   */
  readonly ownedConfig?: Config;
}

async function attemptBootstrapCleanup(
  action: () => void | Promise<void>,
  failures: unknown[],
): Promise<void> {
  try {
    await action();
  } catch (error) {
    failures.push(error);
  }
}

async function cleanupPartialBootstrap(
  handle: IsolatedRuntimeContextHandle,
  teardown: FailedBootstrapTeardown,
  failures: unknown[],
): Promise<void> {
  const {
    sessionClient,
    schedulerOwner,
    taskServices,
    approvalBus,
    ownedConfig,
  } = teardown;
  if (sessionClient !== undefined) {
    await attemptBootstrapCleanup(() => sessionClient.dispose(), failures);
  }
  if (schedulerOwner !== undefined) {
    await attemptBootstrapCleanup(() => schedulerOwner.dispose(), failures);
  }
  if (taskServices !== undefined) {
    await attemptBootstrapCleanup(() => taskServices.dispose(), failures);
  }
  if (approvalBus !== undefined) {
    await attemptBootstrapCleanup(() => approvalBus.dispose(), failures);
  }
  await attemptBootstrapCleanup(() => handle.cleanup(), failures);
  if (ownedConfig !== undefined) {
    await attemptBootstrapCleanup(() => ownedConfig.dispose(), failures);
    await attemptBootstrapCleanup(
      () => ownedConfig.shutdownLspService(),
      failures,
    );
  }
}

/**
 * Cleans up a failed agent bootstrap and surfaces the ORIGINAL error. When
 * cleanup also fails, every error surfaces through an AggregateError so
 * neither is swallowed.
 */
export async function cleanupFailedRuntimeBootstrap(
  handle: IsolatedRuntimeContextHandle,
  primaryError: unknown,
  source: string,
  teardown: FailedBootstrapTeardown = {},
): Promise<never> {
  const cleanupErrors: unknown[] = [];
  if (teardown.facade !== undefined) {
    const { facade } = teardown;
    await attemptBootstrapCleanup(() => facade.dispose(), cleanupErrors);
  } else {
    await cleanupPartialBootstrap(handle, teardown, cleanupErrors);
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      `${source} bootstrap failed and isolated runtime cleanup also failed`,
    );
  }
  throw primaryError;
}
