import {
  RootTelemetry,
  logUserPrompt,
  logSlashCommand,
} from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Storage } from '@vybestack/llxprt-code-settings';
import type {
  WorkspacePromptSelection,
  WorkspaceCheckpointOperations,
  WorkspaceResourceSelection,
  AgentClientContract,
  BucketFailoverHandler,
  FileFilteringOptions,
  IdeClient,
  MCPServerConfig,
  SchedulerCallbacks,
  ToolSchedulerContract,
  ShellExecutionConfig,
  ShellReplacementMode,
  TelemetrySettings,
} from '@vybestack/llxprt-code-core';
import {
  coreEvents,
  CoreEvent,
  WorkspaceMcpCatalogOwner,
  WorkspaceCheckpointOwner,
  LocalMediaStore,
} from '@vybestack/llxprt-code-core';

import { afterEach, vi } from 'bun:test';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
const createFilesystem = installTestWorkspaceFilesystem();
let root: ReturnType<typeof createFilesystem> | undefined;
afterEach(async () => {
  root = undefined;
  const pending = [...checkpointRoots];
  checkpointRoots.clear();
  await Promise.all(pending.map((owner) => owner.dispose()));
});
function fixtureRoot() {
  root ??= createFilesystem({
    targetDir: process.cwd(),
    isTrusted: () => true,
  });
  return root;
}
function fixturePaths() {
  return fixtureRoot().paths;
}

const checkpointRoots = new Set<WorkspaceCheckpointOwner>();

function fixtureCheckpoints(source: object): WorkspaceCheckpointOperations {
  const owner = new WorkspaceCheckpointOwner(
    process.cwd(),
    new Storage(process.cwd()).getHistoryDir(),
    call(source, 'getCheckpointingEnabled', false),
  );
  checkpointRoots.add(owner);
  return owner.operations;
}

import type { Agent } from '@vybestack/llxprt-code-agents';
import { createFakeAgent } from './helpers/createFakeAgent.js';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type {
  RefreshMemoryResult,
  StreamRuntime,
  UiContentGeneratorConfig,
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
  events?: Partial<StreamRuntime['events']>;
  bucketFailover?: Partial<StreamRuntime['bucketFailover']>;
  checkpoint?: Partial<StreamRuntime['checkpoint']>;
  sessionLimits?: Partial<StreamRuntime['sessionLimits']>;
  interactive?: Partial<StreamRuntime['interactive']>;
  ephemeral?: Partial<StreamRuntime['ephemeral']>;
  projectTempDir?: string;
  projectCheckpointsDir?: string;
  historyFilePath?: string;
  projectChatsDir?: string;
  userCommandsDir?: string;
  projectCommandsDir?: string;
}

type LegacyRuntimeSource = object;

function hasPromptSelection(
  source: object,
): source is WorkspacePromptSelection {
  return 'listPrompts' in source && typeof source.listPrompts === 'function';
}

function hasResourceSelection(
  source: object,
): source is Pick<WorkspaceResourceSelection, 'listResources'> {
  return (
    'listResources' in source && typeof source.listResources === 'function'
  );
}

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

const reactToolSchedulerRuntimeCache = new WeakMap<
  LegacyRuntimeSource,
  Pick<StreamRuntime, 'session'> & { agent: Agent }
>();

const DEFAULT_EMPTY_SOURCE: LegacyRuntimeSource = {};

function makeAgentClient(source: LegacyRuntimeSource): AgentClientContract {
  return call(source, 'getAgentClient', {
    getHistory: vi.fn(async () => []),
  } as unknown as AgentClientContract);
}

function makeSessionRuntime(
  source: LegacyRuntimeSource,
  override: StreamRuntimeTestOverrides['session'],
): StreamRuntime['session'] {
  const getSessionRecordingQueueByteLimit =
    override?.getSessionRecordingQueueByteLimit ??
    (() => call(source, 'getSessionRecordingQueueByteLimit', 1024 * 1024));
  return {
    getSessionId: () => call(source, 'getSessionId', 'test-session'),
    adoptSessionId: (sessionId) =>
      delegateVoid(source, 'adoptSessionId', sessionId),
    getTargetDir: () => call(source, 'getTargetDir', '/tmp'),
    getProjectRoot: () => call(source, 'getProjectRoot', '/tmp'),
    getWorkingDir: () => call(source, 'getWorkingDir', '/tmp'),
    getProjectTempDir: () => call(source, 'getProjectTempDir', '/tmp'),
    getSessionRecordingQueueByteLimit,
    getLlxprtDir: () => call(source, 'getLlxprtDir', '/tmp/.llxprt'),
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
    ignore: fixtureRoot().ignore,
    search: fixtureRoot().search.search,
    initializeSearch: fixtureRoot().search.initializeSearch,
    getFileFilteringOptions: () =>
      call(source, 'getFileFilteringOptions', {} as FileFilteringOptions),
    getFileFilteringDisableFuzzySearch: () =>
      call(source, 'getFileFilteringDisableFuzzySearch', false),
    getFileFilteringRespectLlxprtIgnore: () =>
      call(source, 'getFileFilteringRespectLlxprtIgnore', true),
    getFileFilteringRespectGitIgnore: () =>
      call(source, 'getFileFilteringRespectGitIgnore', true),
    getEnableRecursiveFileSearch: () =>
      call(source, 'getEnableRecursiveFileSearch', true),
    directories: () => fixturePaths().directories(),
    addDirectory: () => {
      throw new Error('Use explicit workspace override for directory mutation');
    },
    contains: (filePath) => fixturePaths().contains(filePath),
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
    ...override,
  };
}

function makeHooksRuntime(
  source: LegacyRuntimeSource,
  override: StreamRuntimeTestOverrides['hooks'],
): StreamRuntime['hooks'] {
  return {
    endHookSession: async (reason) => {
      const endHookSession = getMember(source, 'endHookSession');
      if (typeof endHookSession === 'function')
        await endHookSession.call(source, reason);
    },
    getEnableHooks: () => call(source, 'getEnableHooks', false),
    getDisabledHooks: () => call(source, 'getDisabledHooks', []),
    setDisabledHooks: (disabledHooks) =>
      delegateVoid(source, 'setDisabledHooks', disabledHooks),
    isSkillsSupportEnabled: () => call(source, 'isSkillsSupportEnabled', false),
    getEnableHooksUI: () => call(source, 'getEnableHooksUI', false),
    isAdminSkillsEnabled: () => call(source, 'isAdminSkillsEnabled', true),
    ...override,
  };
}

let catalogs: readonly WorkspaceMcpCatalogOwner[] = [];
afterEach(async () => {
  const retained = catalogs;
  catalogs = [];
  for (const catalog of retained) await catalog.dispose();
});
function makeMcpRuntime(
  source: LegacyRuntimeSource,
  override: StreamRuntimeTestOverrides['mcp'],
): StreamRuntime['mcp'] {
  const catalog = new WorkspaceMcpCatalogOwner(
    () => true,
    async () => {
      throw new Error('Stream fixture has no resource transport');
    },
  );
  catalogs = [...catalogs, catalog];
  if (hasPromptSelection(source)) {
    const servers = call<Record<string, MCPServerConfig> | undefined>(
      source,
      'getMcpServers',
      undefined,
    );
    for (const server of Object.keys(servers ?? {}))
      for (const prompt of source.listPrompts(server))
        catalog.promptPublication.registerPrompt(prompt);
  }
  const resources = hasResourceSelection(source) ? source.listResources() : [];
  for (const server of new Set(
    resources.map((resource) => resource.serverName),
  ))
    catalog.resourcePublication.setResourcesForServer(
      server,
      resources.filter((resource) => resource.serverName === server),
    );
  return {
    getMcpServers: () =>
      call(
        source,
        'getMcpServers',
        undefined as Record<string, MCPServerConfig> | undefined,
      ),
    getMcpServerCommand: () =>
      call(source, 'getMcpServerCommand', undefined as string | undefined),
    getBlockedMcpServers: () => call(source, 'getBlockedMcpServers', undefined),
    ...catalog.promptSelection,
    listResources: catalog.resourceSelection.listResources,
    ...override,
  };
}

function makeSettingsRuntime(
  source: LegacyRuntimeSource,
  override: StreamRuntimeTestOverrides['settings'],
): StreamRuntime['settings'] {
  const telemetry = RootTelemetry.prepare({
    enabled: false,
    sessionId: 'stream-fixture',
    maxBytes: 1024,
    maxFiles: 1,
  });
  return {
    logUserPrompt: (event) =>
      logUserPrompt(
        {
          getSessionId: () => 'stream-fixture',
          getTelemetryLogPromptsEnabled: () => false,
        },
        event,
        telemetry,
      ),
    logSlashCommand: (event) =>
      logSlashCommand(
        { getSessionId: () => 'stream-fixture' },
        event,
        telemetry,
      ),
    readCitations: () => call(source, 'readCitations', false),
    readProfileName: () =>
      call(source, 'readProfileName', null as string | null),
    readSelectedProvider: () =>
      call(source, 'readSelectedProvider', undefined as string | undefined),
    subscribeModelSelection: (listener) => {
      coreEvents.on(CoreEvent.ModelChanged, listener);
      return () => coreEvents.off(CoreEvent.ModelChanged, listener);
    },
    getProxy: () => call(source, 'getProxy', undefined as string | undefined),
    getBugCommand: () => call(source, 'getBugCommand', undefined),
    getTelemetrySettings: () =>
      call(
        source,
        'getTelemetrySettings',
        {} as TelemetrySettings & { [key: string]: unknown },
      ),
    updateTelemetrySettings: async (settings) => {
      delegateVoid(source, 'updateTelemetrySettings', settings);
    },
    getTelemetryLogPromptsEnabled: () =>
      call(source, 'getTelemetryLogPromptsEnabled', false),
    getTelemetryEnabled: () => call(source, 'getTelemetryEnabled', false),
    getTelemetryOutfile: () =>
      call(source, 'getTelemetryOutfile', undefined as string | undefined),
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

function makeCheckpointRuntime(
  source: LegacyRuntimeSource,
  override: StreamRuntimeTestOverrides['checkpoint'],
): StreamRuntime['checkpoint'] {
  return {
    checkpoints: fixtureCheckpoints(source),
    getCheckpointingEnabled: () =>
      call(source, 'getCheckpointingEnabled', false),
    ...override,
  };
}

function selectedCommandPaths(
  storage: Storage,
  overrides: StreamRuntimeTestOverrides,
): Pick<
  StreamRuntime,
  | 'projectCheckpointsDir'
  | 'historyFilePath'
  | 'projectChatsDir'
  | 'userCommandsDir'
  | 'projectCommandsDir'
> {
  return {
    projectCheckpointsDir:
      overrides.projectCheckpointsDir ??
      join(
        overrides.projectTempDir ?? storage.getProjectTempDir(),
        'checkpoints',
      ),
    historyFilePath: overrides.historyFilePath ?? storage.getHistoryFilePath(),
    projectChatsDir: overrides.projectChatsDir ?? storage.getProjectChatsDir(),
    userCommandsDir: overrides.userCommandsDir ?? Storage.getUserCommandsDir(),
    projectCommandsDir:
      overrides.projectCommandsDir ?? storage.getProjectCommandsDir(),
  };
}

export function createStreamRuntimeForTest(
  source: LegacyRuntimeSource = {},
  overrides: StreamRuntimeTestOverrides = {},
): StreamRuntime {
  const selectedStorage = new Storage(process.cwd());
  const projectTempDir =
    overrides.projectTempDir ?? selectedStorage.getProjectTempDir();
  const fallbackMediaStore = new LocalMediaStore({
    rootDirectory: join(
      projectTempDir,
      `stream-runtime-test-media-${randomUUID()}`,
    ),
    quotaBytes: 1024 * 1024,
  });
  const sourceClient = makeAgentClient(source);
  const client =
    sourceClient.mediaStore === undefined
      ? Object.assign(sourceClient, { mediaStore: fallbackMediaStore })
      : sourceClient;
  return {
    session: makeSessionRuntime(source, overrides.session),
    model: makeModelRuntime(source, overrides.model),
    agentClientSource: {
      getAgentClient: () => client,
      ...overrides.agentClientSource,
    },
    shell: makeShellRuntime(source, overrides.shell),
    files: makeFilesRuntime(source, overrides.files),
    memory: makeMemoryRuntime(source, overrides.memory),
    ide: makeIdeRuntime(source, overrides.ide),
    hooks: makeHooksRuntime(source, overrides.hooks),
    mcp: makeMcpRuntime(source, overrides.mcp),
    settings: makeSettingsRuntime(source, overrides.settings),
    events: {
      onMcpClientUpdate: () => () => undefined,
      ...overrides.events,
    },
    bucketFailover: {
      resetBuckets: () =>
        call(
          source,
          'getBucketFailoverHandler',
          undefined as BucketFailoverHandler | undefined,
        )?.reset?.(),
      resetBucketSession: () =>
        call(
          source,
          'getBucketFailoverHandler',
          undefined as BucketFailoverHandler | undefined,
        )?.resetSession?.(),
      ensureBucketsAuthenticated: async () => {
        await call(
          source,
          'getBucketFailoverHandler',
          undefined as BucketFailoverHandler | undefined,
        )?.ensureBucketsAuthenticated?.();
      },
      ...overrides.bucketFailover,
    },
    checkpoint: makeCheckpointRuntime(source, overrides.checkpoint),
    sessionLimits: {
      getMaxSessionTurns: () => call(source, 'getMaxSessionTurns', 100),
      ...overrides.sessionLimits,
    },
    interactive: {
      isInteractive: () => call(source, 'isInteractive', true),
      ...overrides.interactive,
    },
    ephemeral: makeEphemeralRuntime(source, overrides.ephemeral),
    projectTempDir,
    ...selectedCommandPaths(selectedStorage, overrides),
  };
}

export function createReactToolSchedulerRuntimeForTest(
  source: LegacyRuntimeSource = DEFAULT_EMPTY_SOURCE,
  factory: (
    callbacks: SchedulerCallbacks,
  ) => Promise<
    Pick<ToolSchedulerContract, 'schedule' | 'cancelAll' | 'dispose'>
  >,
  overrides: StreamRuntimeTestOverrides = {},
  // useReactToolScheduler memoizes by callback identity; for no-overrides scheduler
  // tests, return a stable runtime per source object to avoid test-only resubscribe
  // loops while still allowing per-test freshness through explicit overrides.
): Pick<StreamRuntime, 'session'> & { agent: Agent } {
  if (Object.keys(overrides).length === 0) {
    const cached = reactToolSchedulerRuntimeCache.get(source);
    if (cached) {
      return cached;
    }
    const runtime = createStreamRuntimeForTest(source, overrides);
    const result = {
      session: runtime.session,
      agent: createSchedulerTestAgent(factory),
    };
    reactToolSchedulerRuntimeCache.set(source, result);
    return result;
  }
  const runtime = createStreamRuntimeForTest(source, overrides);
  return {
    session: runtime.session,
    agent: createSchedulerTestAgent(factory),
  };
}

function createSchedulerTestAgent(
  factory: (
    callbacks: SchedulerCallbacks,
  ) => Promise<
    Pick<ToolSchedulerContract, 'schedule' | 'cancelAll' | 'dispose'>
  >,
): Agent {
  const agent = createFakeAgent([]);
  agent.tools.openClientChannel = () => {
    const observers = new Set<
      Parameters<Agent['tools']['setDisplayCallbacks']>[0]
    >();
    const instance = factory({
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
      onToolCallsUpdate: (calls) => {
        for (const observer of observers) observer.onToolCallsUpdate?.(calls);
      },
      outputUpdateHandler: (id, update) => {
        for (const observer of observers)
          observer.outputUpdateHandler?.(id, update);
      },
      onAllToolCallsComplete: async (calls) => {
        for (const observer of observers)
          await observer.onAllToolCallsComplete?.(calls);
      },
    });
    return {
      ready: instance.then(() => {}),
      schedule: async (request, signal) =>
        (await instance).schedule(request, signal),
      cancelAll: () => {
        void instance.then((scheduler) => scheduler.cancelAll());
      },
      subscribe: (callbacks) => {
        observers.add(callbacks);
        return () => {
          observers.delete(callbacks);
        };
      },
      release: async () => {
        observers.clear();
        (await instance).dispose();
      },
    };
  };
  return agent;
}
