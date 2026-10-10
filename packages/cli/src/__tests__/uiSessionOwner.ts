/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { IdeControl } from '../../../agents/src/api/control/ideControl.js';
import { wrapToolHandle } from '../../../agents/src/api/control/toolControl.js';
import { WorkspaceIdeOwner } from '@vybestack/llxprt-code-core/services/workspace-ide-owner.js';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';

import { installDefinitionRuntimeFixture } from './definition-runtime-fixture.js';
const definitionFixture = installDefinitionRuntimeFixture();

import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  SessionSettingsOwner,
  type WorkspaceMcpSettings,
  type SessionMcpSettingsReads,
} from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';

import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { afterEach } from 'bun:test';
import {
  Config,
  ApprovalMode,
  WorkspaceCheckpointOwner,
  LocalMediaStore,
  WorkspaceMcpCatalogOwner,
  assembleWorkspaceMemory,
} from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { buildAgentClientFactory } from '../../../agents/src/api/agentBootstrap.js';
import { SessionClientOwner } from '../../../agents/src/session/session-client-owner.js';
import { subscribeSessionStats } from '../../../agents/src/api/agentStatsProjector.js';
import { resolve } from 'node:path';
import { HookControl } from '../../../agents/src/api/control/hooks.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';

let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  const pending = cleanups;
  cleanups = [];
  await Promise.all(pending.map((cleanup) => cleanup()));
});

function createUiMedia(): LocalMediaStore {
  return new LocalMediaStore({
    rootDirectory: resolve(
      import.meta.dirname,
      '../../../../tmp/session-client-frontend-migration/ui-media',
      crypto.randomUUID(),
    ),
    quotaBytes: 1024 * 1024,
  });
}

type UiSessionOwner = Pick<
  Agent,
  | 'agentClient'
  | 'sessionClient'
  | 'providerManager'
  | 'workspace'
  | 'memory'
  | 'hooks'
  | 'ide'
  | 'getApprovalMode'
  | 'setApprovalMode'
  | 'getModel'
  | 'getProvider'
  | 'getEphemeralSetting'
  | 'getEphemeralSettings'
  | 'setEphemeralSetting'
  | 'getActiveProfileName'
  | 'onStats'
> & {
  mcp: Pick<
    Agent['mcp'],
    | 'listPrompts'
    | 'listResources'
    | 'subscribeStatus'
    | 'listServers'
    | 'listBlockedServers'
  >;
  tools: Pick<Agent['tools'], 'describeConfiguration' | 'get'>;
  settingsOwner: SessionSettingsOwner;
};

export function createUiSessionOwner(
  suppliedConfig?: Config,
  suppliedSettings?: {
    readonly settingsService: SettingsService;
    readonly settingsOwner: SessionSettingsOwner;
  },
  mcpSettings?: WorkspaceMcpSettings,
): UiSessionOwner {
  const config =
    suppliedConfig ??
    new Config({
      sessionId: crypto.randomUUID(),
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'ui-test-model',
    });
  const { settingsService, settings } = assembleUiSettings(
    config,
    suppliedSettings,
  );
  const declarations = mcpSettings ?? {
    mcpServers: config.getMcpServers() ?? {},
    settingsMcpServers: config.getMcpServers() ?? {},
    blockedMcpServers: config.getBlockedMcpServers() ?? [],
  };
  settings.bindMcpSettings(declarations, async () => declarations);
  const selectedMcpSettings = settings.readMcpSettingsBinding();
  if (selectedMcpSettings === undefined)
    throw new Error('Missing fixture MCP settings binding');
  const subscriptions = new Set<() => void>();
  const runtime = assembleUiInfrastructure(config, settingsService, settings);
  const hooks = createUiHookControl(
    config,
    runtime.sessionClient,
    runtime.hookBus,
  );
  const { manager, media, filesystem, catalogs, sessionClient, memory } =
    runtime;
  cleanups.push(async () => {
    const releases = [
      () => {
        for (const unsubscribe of subscriptions) unsubscribe();
        subscriptions.clear();
      },
      () => hooks.detach(),
      () => sessionClient.dispose(),
      async () => {
        if (!suppliedSettings) await settings.dispose();
      },
      () => manager.dispose(),
      () => media.close(),
      () => catalogs.dispose(),
      () => memory.dispose(),
      () => filesystem.dispose(),
      () => runtime.checkpoints.dispose(),
      () => runtime.ide.dispose(),
      () => runtime.trust.dispose(),
      () => (suppliedConfig === undefined ? config.dispose() : undefined),
    ];
    await retireUiResources(releases);
  });
  return projectUiSessionOwner(
    config,
    settingsService,
    settings,
    runtime,
    subscriptions,
    hooks,
    selectedMcpSettings,
  );
}

function createUiHookControl(
  config: Config,
  client: SessionClientOwner,
  bus: MessageBus,
): HookControl {
  return new HookControl({
    hookOperations: client.hookOperations,
    messageBus: bus,
    sessionId: () => config.getSessionId(),
    cwd: () => config.getTargetDir(),
  });
}

function uiWorkspace(
  config: Config,
  filesystem: WorkspaceFilesystemOwner,
  checkpoints: WorkspaceCheckpointOwner,
): Agent['workspace'] {
  return {
    ...definitionFixture(),
    checkpoints: checkpoints.operations,
    ...filesystem.ignore,
    ...filesystem.search,
    getDirectories: () => [...filesystem.paths.directories()],
    addDirectory: (directory) => filesystem.addDirectory(directory),
    containsPath: (filePath) => filesystem.paths.contains(filePath),
    getWorkingDirectory: () => config.getWorkingDir(),
    getProjectRoot: () => config.getProjectRoot(),
  };
}

function assembleUiInfrastructure(
  config: Config,
  settingsService: SettingsService,
  settings: SessionSettingsOwner,
) {
  const trust = new WorkspaceTrustLifecycle({
    localTrust: config.initialWorkspaceTrust,
  });
  const ide = new WorkspaceIdeOwner(
    config,
    trust,
    trust,
    undefined,
    config.getIdeMode(),
  );
  const manager = new ProviderManager({
    config,
    sessionSettings: settings,
    settingsService,
  });
  const media = createUiMedia();
  const filesystem = new WorkspaceFilesystemOwner({
    targetDir: process.cwd(),
    isTrusted: () => trust.isTrustedFolder(),
  });
  const catalogs = new WorkspaceMcpCatalogOwner(
    () => trust.isTrustedFolder(),
    async () => {
      throw new Error('UI fixture has no resource transport');
    },
  );
  const factories = configureProviderRuntimeFactories(config, manager);
  const sessionClient = SessionClientOwner.createWithBackgroundRollback(
    config,
    assembleTaskSchemaPolicy(settingsService),
    manager,
    buildAgentClientFactory(media),
    media,
    () => undefined,
    filesystem.paths,
    settings,
    factories.contentGeneratorFactory,
    factories.tokenizerFactory,
  );
  const hookBus = new MessageBus();
  sessionClient.bindHooks(undefined, hookBus, trust);
  const memory = assembleWorkspaceMemory(config, filesystem, trust);
  sessionClient.bindWorkspaceInstructions(memory);
  const checkpoints = new WorkspaceCheckpointOwner(
    config.getProjectRoot(),
    config.projectHistoryDir,
    config.getCheckpointingEnabled(),
  );
  return {
    trust,
    ide,
    manager,
    media,
    filesystem,
    catalogs,
    sessionClient,
    memory,
    checkpoints,
    hookBus,
  };
}

function projectUiSessionOwner(
  config: Config,
  settingsService: SettingsService,
  settings: SessionSettingsOwner,
  runtime: ReturnType<typeof assembleUiInfrastructure>,
  subscriptions: Set<() => void>,
  hooks: Agent['hooks'],
  mcpSettings: SessionMcpSettingsReads,
): ReturnType<typeof createUiSessionOwner> {
  const { sessionClient, catalogs, filesystem, manager } = runtime;
  return {
    settingsOwner: settings,
    ide: new IdeControl({
      trust: runtime.trust,
      ide: runtime.ide,
      ideModeEnabled: () => runtime.ide.isEnabled(),
      getEditorCallbacks: () => ({}),
    }),
    getApprovalMode: () =>
      runtime.trust.isTrustedFolder()
        ? config.getApprovalMode()
        : ApprovalMode.DEFAULT,
    setApprovalMode: (mode) => {
      if (!runtime.trust.isTrustedFolder() && mode !== ApprovalMode.DEFAULT)
        throw new Error('untrusted');
      config.setApprovalMode(mode);
    },
    hooks,
    getModel: () => settings.readSelectedModel() ?? config.getModel(),
    getProvider: () => settings.readSelectedProvider() ?? '',
    getEphemeralSetting: (key) => settings.readNamedParameter(key),
    getEphemeralSettings: () => settings.captureNamedParameters(),
    setEphemeralSetting: settings.writeUserParameter.bind(settings),
    getActiveProfileName: () => settingsService.getCurrentProfileName(),
    onStats: (listener) => {
      const unsubscribe = subscribeSessionStats(
        () => sessionClient.getAgentClient().getHistoryService(),
        listener,
      );
      subscriptions.add(unsubscribe);
      return () => {
        subscriptions.delete(unsubscribe);
        unsubscribe();
      };
    },
    memory: sessionClient.memoryOperations,
    tools: {
      get: (name) => {
        const tool = sessionClient.toolCatalog.selection.getTool(name);
        return tool === undefined ? undefined : wrapToolHandle(tool);
      },
      describeConfiguration: () =>
        sessionClient.toolCatalog.describeConfiguration(),
    },
    mcp: {
      ...catalogs.promptSelection,
      ...catalogs.resourceSelection,
      subscribeStatus: () => () => {},
      listBlockedServers: () => mcpSettings.read().blockedMcpServers,
      listServers: () =>
        Object.entries(mcpSettings.read().mcpServers).map(([name, config]) => ({
          name,
          config,
          status: 'disconnected',
        })),
    },
    workspace: uiWorkspace(config, filesystem, runtime.checkpoints),
    providerManager: manager,
    sessionClient: {
      runImageOperation: (input) => sessionClient.runImageOperation(input),
      refreshAuth: (method) => sessionClient.refreshAuth(method),
      publishTools: () => sessionClient.publishTools(),
      createDetachedAgentClient: (id) =>
        sessionClient.createDetachedAgentClient(id),
    },
    get agentClient() {
      return sessionClient.getAgentClient();
    },
  };
}

function assembleUiSettings(
  config: Config,
  suppliedSettings: Parameters<typeof createUiSessionOwner>[1],
) {
  const settingsService =
    suppliedSettings?.settingsService ?? new SettingsService();
  if (!suppliedSettings)
    for (const [key, value] of Object.entries(config.getInitialSettings()))
      settingsService.set(key, value);
  const settings =
    suppliedSettings?.settingsOwner ??
    new SessionSettingsOwner(settingsService);
  settings.assertSettingsIdentity(settingsService);
  settings.bindTelemetry(config);
  settings.initializeProviderSelection(config.getProvider(), config.getModel());
  return { settingsService, settings };
}

async function retireUiResources(
  releases: ReadonlyArray<() => void | Promise<void>>,
): Promise<void> {
  const failures: unknown[] = [];
  for (const release of releases) {
    const [result] = await Promise.allSettled([
      Promise.resolve().then(release),
    ]);
    if (result.status === 'rejected') failures.push(result.reason);
  }
  if (failures.length > 0)
    throw new AggregateError(failures, 'UI session fixture cleanup failed');
}
