/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';
import type {
  AgentClientContract,
  AsyncTaskManager,
  BucketFailoverHandler,
  FileDiscoveryService,
  FileFilteringOptions,
  FileSystemService,
  HookSystem,
  IdeClient,
  MCPServerConfig,
  MessageBus,
  RuntimeProviderManager,
  SchedulerCallbacks,
  SchedulerOptions,
  ShellExecutionConfig,
  ShellReplacementMode,
  SkillManager,
  TelemetrySettings,
  ToolRegistry,
  ToolSchedulerContract,
} from '@vybestack/llxprt-code-core';
import { MCPDiscoveryState } from '@vybestack/llxprt-code-mcp';
import type { SettingsService, Storage } from '@vybestack/llxprt-code-settings';
import type {
  RefreshMemoryResult,
  StreamRuntime,
  UiContentGeneratorConfig,
  UiMcpClientManager,
  UiPromptRegistry,
  UiResourceRegistry,
  UiWorkspaceContext,
} from '../../../cliUiRuntime.js';

export interface StreamRuntimeTestOverrides {
  session?: Partial<StreamRuntime['session']>;
  model?: Partial<StreamRuntime['model']>;
  agentClientSource?: Partial<StreamRuntime['agentClientSource']>;
  shell?: Partial<StreamRuntime['shell']>;
  files?: Partial<StreamRuntime['files']>;
  memory?: Partial<StreamRuntime['memory']>;
  ide?: Partial<StreamRuntime['ide']>;
  hooks?: Partial<StreamRuntime['hooks']>;
  mcp?: Partial<StreamRuntime['mcp']>;
  settings?: Partial<StreamRuntime['settings']>;
  scheduler?: Partial<StreamRuntime['scheduler']>;
  asyncTasks?: Partial<StreamRuntime['asyncTasks']>;
  bucketFailover?: Partial<StreamRuntime['bucketFailover']>;
  checkpoint?: Partial<StreamRuntime['checkpoint']>;
  sessionLimits?: Partial<StreamRuntime['sessionLimits']>;
  interactive?: Partial<StreamRuntime['interactive']>;
  ephemeral?: Partial<StreamRuntime['ephemeral']>;
  storage?: StreamRuntime['storage'];
}

type LegacyRuntimeSource = object;

function getMember(source: LegacyRuntimeSource, name: string): unknown {
  return Reflect.get(source, name);
}

function call<T>(source: LegacyRuntimeSource, name: string, fallback: T): T {
  const fn = getMember(source, name);
  return typeof fn === 'function' ? (fn as () => T).call(source) : fallback;
}

function delegateVoid(
  source: LegacyRuntimeSource,
  name: string,
  ...args: unknown[]
): void {
  const fn = getMember(source, name);
  if (typeof fn === 'function') {
    (fn as (...values: unknown[]) => void).call(source, ...args);
  }
}

function makeSettingsService(): SettingsService {
  return {
    get: vi.fn(() => undefined),
    getCurrentProfileName: vi.fn(() => null),
  } as unknown as SettingsService;
}

function makeStorage(): Storage {
  return {
    getProjectTempCheckpointsDir: vi.fn(() => '/tmp/checkpoints'),
    getProjectTempDir: vi.fn(() => '/tmp'),
  } as unknown as Storage;
}

const reactToolSchedulerRuntimeCache = new WeakMap<
  LegacyRuntimeSource,
  Pick<StreamRuntime, 'scheduler' | 'session'>
>();

const DEFAULT_EMPTY_SOURCE: LegacyRuntimeSource = {};

function makeAgentClient(source: LegacyRuntimeSource): AgentClientContract {
  return call(source, 'getAgentClient', {
    getHistory: vi.fn(async () => []),
  } as unknown as AgentClientContract);
}

function makeWorkspaceContext(source: LegacyRuntimeSource): UiWorkspaceContext {
  return call(source, 'getWorkspaceContext', {
    getDirectories: () => ['/tmp'],
    addDirectory: () => undefined,
    isPathWithinWorkspace: () => true,
  });
}

function makePromptRegistry(source: LegacyRuntimeSource): UiPromptRegistry {
  return call(source, 'getPromptRegistry', {
    getPromptsByServer: () => [],
    getAllPrompts: () => [],
    getPrompt: () => undefined,
    clear: () => undefined,
  });
}

function makeResourceRegistry(source: LegacyRuntimeSource): UiResourceRegistry {
  return call(source, 'getResourceRegistry', {
    getAllResources: () => [],
    findResourceByUri: () => undefined,
  });
}

function makeMcpClientManager(
  source: LegacyRuntimeSource,
): UiMcpClientManager | undefined {
  return call(source, 'getMcpClientManager', {
    getDiscoveryState: () => MCPDiscoveryState.COMPLETED,
    getMcpServerCount: () => 0,
    restartServer: async () => undefined,
  });
}

function makeStorageFromSource(
  source: LegacyRuntimeSource,
  override: StreamRuntime['storage'] | undefined,
): Storage {
  const maybeStorage = getMember(source, 'storage');
  return (
    override ??
    (maybeStorage !== undefined ? (maybeStorage as Storage) : undefined) ??
    makeStorage()
  );
}

function makeSessionRuntime(
  source: LegacyRuntimeSource,
  override: StreamRuntimeTestOverrides['session'],
): StreamRuntime['session'] {
  return {
    getSessionId: () => call(source, 'getSessionId', 'test-session'),
    getTargetDir: () => call(source, 'getTargetDir', '/tmp'),
    getProjectRoot: () => call(source, 'getProjectRoot', '/tmp'),
    getWorkingDir: () => call(source, 'getWorkingDir', '/tmp'),
    getProjectTempDir: () => call(source, 'getProjectTempDir', '/tmp'),
    getGeminiDir: () => call(source, 'getGeminiDir', '/tmp/.llxprt'),
    ...override,
  };
}

function makeModelRuntime(
  source: LegacyRuntimeSource,
  override: StreamRuntimeTestOverrides['model'],
): StreamRuntime['model'] {
  return {
    getModel: () => call(source, 'getModel', 'test-model'),
    getProvider: () =>
      call(source, 'getProvider', undefined as string | undefined),
    setProvider: (provider: string) => {
      const fn = getMember(source, 'setProvider');
      if (typeof fn === 'function') {
        (fn as (value: string) => void).call(source, provider);
      }
    },
    getProviderManager: () =>
      call(
        source,
        'getProviderManager',
        undefined as RuntimeProviderManager | undefined,
      ),
    getContentGeneratorConfig: () =>
      call(source, 'getContentGeneratorConfig', {
        model: 'test-model',
      } as UiContentGeneratorConfig),
    ...override,
  };
}

function makeShellRuntime(
  source: LegacyRuntimeSource,
  override: StreamRuntimeTestOverrides['shell'],
): StreamRuntime['shell'] {
  return {
    getShouldUseNodePtyShell: () =>
      call(source, 'getShouldUseNodePtyShell', false),
    getEnableInteractiveShell: () =>
      call(source, 'getEnableInteractiveShell', false),
    getPtyTerminalWidth: () =>
      call(source, 'getPtyTerminalWidth', undefined as number | undefined),
    getPtyTerminalHeight: () =>
      call(source, 'getPtyTerminalHeight', undefined as number | undefined),
    setPtyTerminalSize: (width, height) =>
      delegateVoid(source, 'setPtyTerminalSize', width, height),
    getTerminalBackground: () =>
      call(source, 'getTerminalBackground', undefined as string | undefined),
    getShellReplacement: () =>
      call(source, 'getShellReplacement', 'off' as ShellReplacementMode),
    getShellExecutionConfig: () =>
      call(source, 'getShellExecutionConfig', {} as ShellExecutionConfig),
    ...override,
  };
}

function makeFilesRuntime(
  source: LegacyRuntimeSource,
  override: StreamRuntimeTestOverrides['files'],
): StreamRuntime['files'] {
  return {
    getFileService: () =>
      call(source, 'getFileService', {} as FileDiscoveryService),
    getFileFilteringOptions: () =>
      call(source, 'getFileFilteringOptions', {} as FileFilteringOptions),
    getFileFilteringDisableFuzzySearch: () =>
      call(source, 'getFileFilteringDisableFuzzySearch', false),
    getFileExclusions: () =>
      call(source, 'getFileExclusions', {
        getGlobExcludes: () => [],
        getReadManyFilesExcludes: () => [],
      }),
    getFileFilteringRespectLlxprtIgnore: () =>
      call(source, 'getFileFilteringRespectLlxprtIgnore', true),
    getFileFilteringRespectGitIgnore: () =>
      call(source, 'getFileFilteringRespectGitIgnore', true),
    getFileSystemService: () =>
      call(source, 'getFileSystemService', {} as FileSystemService),
    getEnableRecursiveFileSearch: () =>
      call(source, 'getEnableRecursiveFileSearch', true),
    getWorkspaceContext: () => makeWorkspaceContext(source),
    ...override,
  };
}

function makeMemoryRuntime(
  source: LegacyRuntimeSource,
  override: StreamRuntimeTestOverrides['memory'],
): StreamRuntime['memory'] {
  return {
    getUserMemory: () => call(source, 'getUserMemory', ''),
    setUserMemory: (memory) => delegateVoid(source, 'setUserMemory', memory),
    setCoreMemory: (memory) => delegateVoid(source, 'setCoreMemory', memory),
    getLlxprtMdFileCount: () => call(source, 'getLlxprtMdFileCount', 0),
    getCoreMemoryFileCount: () => call(source, 'getCoreMemoryFileCount', 0),
    getLlxprtMdFilePaths: () => call(source, 'getLlxprtMdFilePaths', []),
    setLlxprtMdFileCount: (count) =>
      delegateVoid(source, 'setLlxprtMdFileCount', count),
    setLlxprtMdFilePaths: (paths) =>
      delegateVoid(source, 'setLlxprtMdFilePaths', paths),
    refreshMemory: async () =>
      call(source, 'refreshMemory', {
        memoryContent: '',
        fileCount: 0,
        filePaths: [],
      } as RefreshMemoryResult),
    shouldLoadMemoryFromIncludeDirectories: () =>
      call(source, 'shouldLoadMemoryFromIncludeDirectories', false),
    ...override,
  };
}

function makeIdeRuntime(
  source: LegacyRuntimeSource,
  override: StreamRuntimeTestOverrides['ide'],
): StreamRuntime['ide'] {
  return {
    getIdeClient: () =>
      call(source, 'getIdeClient', undefined as IdeClient | undefined),
    getIdeMode: () => call(source, 'getIdeMode', false),
    setIdeMode: (enabled) => delegateVoid(source, 'setIdeMode', enabled),
    setIdeClientConnected: () => delegateVoid(source, 'setIdeClientConnected'),
    setIdeClientDisconnected: () =>
      delegateVoid(source, 'setIdeClientDisconnected'),
    getLspConfig: () => call(source, 'getLspConfig', undefined),
    getLspServiceClient: () => call(source, 'getLspServiceClient', undefined),
    ...override,
  };
}

function makeHooksRuntime(
  source: LegacyRuntimeSource,
  override: StreamRuntimeTestOverrides['hooks'],
): StreamRuntime['hooks'] {
  return {
    getHookSystem: () =>
      call(source, 'getHookSystem', undefined as HookSystem | undefined),
    getEnableHooks: () => call(source, 'getEnableHooks', false),
    getDisabledHooks: () => call(source, 'getDisabledHooks', []),
    setDisabledHooks: (disabledHooks) =>
      delegateVoid(source, 'setDisabledHooks', disabledHooks),
    isSkillsSupportEnabled: () => call(source, 'isSkillsSupportEnabled', false),
    getEnableHooksUI: () => call(source, 'getEnableHooksUI', false),
    reloadSkills: () => {
      const fn = getMember(source, 'reloadSkills');
      return typeof fn === 'function'
        ? Promise.resolve((fn as () => Promise<void>).call(source))
        : Promise.resolve();
    },
    getSkillManager: () => call(source, 'getSkillManager', {} as SkillManager),
    ...override,
  };
}

function makeMcpRuntime(
  source: LegacyRuntimeSource,
  override: StreamRuntimeTestOverrides['mcp'],
): StreamRuntime['mcp'] {
  return {
    getMcpServers: () =>
      call(
        source,
        'getMcpServers',
        undefined as Record<string, MCPServerConfig> | undefined,
      ),
    getMcpServerCommand: () =>
      call(source, 'getMcpServerCommand', undefined as string | undefined),
    getMcpClientManager: () => makeMcpClientManager(source),
    getBlockedMcpServers: () => call(source, 'getBlockedMcpServers', undefined),
    getResourceRegistry: () => makeResourceRegistry(source),
    getPromptRegistry: () => makePromptRegistry(source),
    ...override,
  };
}

function makeSettingsRuntime(
  source: LegacyRuntimeSource,
  override: StreamRuntimeTestOverrides['settings'],
): StreamRuntime['settings'] {
  return {
    getSettingsService: () =>
      call(source, 'getSettingsService', makeSettingsService()),
    getProxy: () => call(source, 'getProxy', undefined as string | undefined),
    getBugCommand: () => call(source, 'getBugCommand', undefined),
    getTelemetrySettings: () =>
      call(
        source,
        'getTelemetrySettings',
        {} as TelemetrySettings & { [key: string]: unknown },
      ),
    updateTelemetrySettings: (settings) =>
      delegateVoid(source, 'updateTelemetrySettings', settings),
    getTelemetryLogPromptsEnabled: () =>
      call(source, 'getTelemetryLogPromptsEnabled', false),
    getTelemetryEnabled: () => call(source, 'getTelemetryEnabled', false),
    getTelemetryOutfile: () =>
      call(source, 'getTelemetryOutfile', undefined as string | undefined),
    getTelemetryTarget: () => call(source, 'getTelemetryTarget', 'local'),
    getTelemetryOtlpEndpoint: () =>
      call(source, 'getTelemetryOtlpEndpoint', ''),
    getConversationLoggingEnabled: () =>
      call(source, 'getConversationLoggingEnabled', false),
    getEmbeddingModel: () =>
      call(source, 'getEmbeddingModel', undefined as string | undefined),
    getSandbox: () => call(source, 'getSandbox', undefined),
    getRedactionConfig: () =>
      call(source, 'getRedactionConfig', {
        redactApiKeys: false,
        redactCredentials: false,
        redactFilePaths: false,
        redactUrls: false,
        redactEmails: false,
        redactPersonalInfo: false,
      }),
    ...override,
  };
}

function makeSchedulerRuntime(
  source: LegacyRuntimeSource,
  override: StreamRuntimeTestOverrides['scheduler'],
): StreamRuntime['scheduler'] {
  return {
    disposeScheduler: (sessionId: string) => {
      const fn = getMember(source, 'disposeScheduler');
      if (typeof fn === 'function') {
        (fn as (value: string) => void).call(source, sessionId);
      }
    },
    getOrCreateScheduler: async (
      sessionId: string,
      callbacks: SchedulerCallbacks,
      options?: SchedulerOptions,
      dependencies?: {
        messageBus?: MessageBus;
        toolRegistry?: ToolRegistry;
      },
    ) => {
      const fn = getMember(source, 'getOrCreateScheduler');
      if (typeof fn === 'function') {
        return (fn as StreamRuntime['scheduler']['getOrCreateScheduler']).call(
          source,
          sessionId,
          callbacks,
          options,
          dependencies,
        );
      }
      return {
        schedule: vi.fn(),
        dispose: vi.fn(),
      } as unknown as ToolSchedulerContract;
    },
    setInteractiveSubagentSchedulerFactory: (factory) => {
      const fn = getMember(source, 'setInteractiveSubagentSchedulerFactory');
      if (typeof fn === 'function') {
        (
          fn as StreamRuntime['scheduler']['setInteractiveSubagentSchedulerFactory']
        ).call(source, factory);
      }
    },
    ...override,
  };
}

function makeAsyncTasksRuntime(
  source: LegacyRuntimeSource,
  override: StreamRuntimeTestOverrides['asyncTasks'],
): StreamRuntime['asyncTasks'] {
  return {
    getAsyncTaskManager: () =>
      call(
        source,
        'getAsyncTaskManager',
        undefined as AsyncTaskManager | undefined,
      ),
    setupAsyncTaskAutoTrigger: (isAgentBusy, triggerAgentTurn) => {
      const fn = getMember(source, 'setupAsyncTaskAutoTrigger');
      if (typeof fn === 'function') {
        return (
          fn as StreamRuntime['asyncTasks']['setupAsyncTaskAutoTrigger']
        ).call(source, isAgentBusy, triggerAgentTurn);
      }
      return () => undefined;
    },
    ...override,
  };
}

function makeEphemeralRuntime(
  source: LegacyRuntimeSource,
  override: StreamRuntimeTestOverrides['ephemeral'],
): StreamRuntime['ephemeral'] {
  return {
    getEphemeralSetting: (key: string) => {
      const fn = getMember(source, 'getEphemeralSetting');
      return typeof fn === 'function'
        ? (fn as (value: string) => unknown).call(source, key)
        : undefined;
    },
    ...override,
  };
}

export function createStreamRuntimeForTest(
  source: LegacyRuntimeSource = {},
  overrides: StreamRuntimeTestOverrides = {},
): StreamRuntime {
  return {
    session: makeSessionRuntime(source, overrides.session),
    model: makeModelRuntime(source, overrides.model),
    agentClientSource: {
      getAgentClient: () => makeAgentClient(source),
      ...overrides.agentClientSource,
    },
    shell: makeShellRuntime(source, overrides.shell),
    files: makeFilesRuntime(source, overrides.files),
    memory: makeMemoryRuntime(source, overrides.memory),
    ide: makeIdeRuntime(source, overrides.ide),
    hooks: makeHooksRuntime(source, overrides.hooks),
    mcp: makeMcpRuntime(source, overrides.mcp),
    settings: makeSettingsRuntime(source, overrides.settings),
    scheduler: makeSchedulerRuntime(source, overrides.scheduler),
    asyncTasks: makeAsyncTasksRuntime(source, overrides.asyncTasks),
    bucketFailover: {
      getBucketFailoverHandler: () =>
        call(
          source,
          'getBucketFailoverHandler',
          undefined as BucketFailoverHandler | undefined,
        ),
      ...overrides.bucketFailover,
    },
    checkpoint: {
      getCheckpointingEnabled: () =>
        call(source, 'getCheckpointingEnabled', false),
      ...overrides.checkpoint,
    },
    sessionLimits: {
      getMaxSessionTurns: () => call(source, 'getMaxSessionTurns', 100),
      ...overrides.sessionLimits,
    },
    interactive: {
      isInteractive: () => call(source, 'isInteractive', true),
      ...overrides.interactive,
    },
    ephemeral: makeEphemeralRuntime(source, overrides.ephemeral),
    storage: makeStorageFromSource(source, overrides.storage),
  };
}

export function createReactToolSchedulerRuntimeForTest(
  source: LegacyRuntimeSource = DEFAULT_EMPTY_SOURCE,
  overrides: StreamRuntimeTestOverrides = {},
  // useReactToolScheduler memoizes by callback identity; for no-overrides scheduler
  // tests, return a stable runtime per source object to avoid test-only resubscribe
  // loops while still allowing per-test freshness through explicit overrides.
): Pick<StreamRuntime, 'scheduler' | 'session'> {
  if (Object.keys(overrides).length === 0) {
    const cached = reactToolSchedulerRuntimeCache.get(source);
    if (cached) {
      return cached;
    }
    const runtime = createStreamRuntimeForTest(source, overrides);
    const result = { scheduler: runtime.scheduler, session: runtime.session };
    reactToolSchedulerRuntimeCache.set(source, result);
    return result;
  }
  const runtime = createStreamRuntimeForTest(source, overrides);
  return { scheduler: runtime.scheduler, session: runtime.session };
}
