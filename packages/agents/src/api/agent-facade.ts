import type { ToolSelection } from '@vybestack/llxprt-code-tools';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type Config,
  type RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import type { RuntimeKind } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { WorkspaceSkillOperations } from '@vybestack/llxprt-code-core/skills/workspace-skill-owner.js';
import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { resolveShellJobSettings } from '@vybestack/llxprt-code-core/config/asyncTaskServices.js';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ChildToolDisplay } from '../session/childToolDisplay.js';
import type { SessionClientOwner } from '../session/session-client-owner.js';
import { ShellJobOwner } from '../session/shell-job-owner.js';
import type { TaskLaunchOwner } from '../session/task-launch-owner.js';
import type { Agent } from './agent.js';
import {
  AgentOperations,
  createAgentApprovalOwner,
  createAgentTurnOwners,
} from './agent-operations.js';
import { createAgentFacade, type AgentFacadeComposition } from './agentImpl.js';
import {
  buildFacadeState,
  type OwnershipRecord,
  type StableDisplayCallbacksHolder,
  type StableEditorCallbacksHolder,
} from './agentBootstrap.js';
import type {
  AgentAuth,
  AgentConfig,
  AgentSchedulerHandle,
  EditorCallbacks,
} from './config-types.js';
import {
  createAgentAuthState,
  type AgentAuthState,
} from './control/authState.js';
import type { HookControl } from './control/hooks.js';
import { assembleIdeControl, type IdeControl } from './control/ideControl.js';
import { LspControl } from './control/lspControl.js';
import type { McpControl } from './control/mcpControl.js';
import { buildOwnedMcpControl } from './control/mcpControlWiring.js';
import { PolicyControl } from './control/policyControl.js';
import {
  assembleSessionAuthentication,
  clearProviderAuthenticationCache,
} from './control/session-authentication.js';
import type { SessionControl } from './control/sessionControl.js';
import { SkillsControl } from './control/skillsControl.js';
import { createTasksControl } from './control/tasksControl.js';
import type { ToolControl } from './control/toolControl.js';
import { assembleToolKeys } from './control/toolKeysControl.js';
import { WorkspaceControl } from './control/workspaceControl.js';
import type {
  FacadePublicationPort,
  McpTeardownPort,
  WorkspaceFacadeMcpPort,
} from './mcpRuntimePorts.js';
import { createNewSessionAdmission } from './new-session-admission.js';
import { assembleProfilePersistence } from './profilePersistenceAssembly.js';
import { idleClient } from './session-control-assembly.js';
import {
  createSessionProviderControl,
  type SessionProviderControl,
} from './session-provider-reads.js';

export interface WorkspaceFacadeControls {
  readonly workspace: WorkspaceControl;
  readonly ide: IdeControl;
  readonly lsp: LspControl;
  readonly mcp: McpControl;
}

/**
 * Builds the workspace, IDE, LSP and MCP controls the agent facade publishes,
 * for every construction path. Subagent definitions come from
 * the runtime's `subagentDefinitions`, which is the one place that filters
 * extension subagents by workspace trust.
 */
export function assembleWorkspaceFacade(
  runtime: WorkspaceFacadeMcpPort,
  config: Config,
  toolSelection: ToolSelection,
  refreshToolDefinitions: () => Promise<void>,
  auth: AgentAuthState,
  editors: StableEditorCallbacksHolder,
): WorkspaceFacadeControls {
  return {
    workspace: new WorkspaceControl(
      runtime.profileDefinitions,
      runtime.profileWrites,
      runtime.subagentDefinitions,
      runtime.subagentWrites,
      runtime.checkpointOperations,
      runtime.workspaceIgnore,
      runtime.workspaceSearch,
      runtime.workspaceFiles,
      runtime.workspacePaths.contains,
      runtime.workspacePaths.directories,
      runtime.addWorkspaceDirectory,
      config.getTargetDir(),
      config.getProjectRoot(),
    ),
    ide: assembleIdeControl(
      runtime.trust,
      runtime.ide,
      () => editors.editorCallbacks,
    ),
    lsp: new LspControl(runtime.lspInspection),
    mcp: buildOwnedMcpControl(
      runtime.readServerSettings.bind(runtime),
      toolSelection,
      runtime.listPrompts.bind(runtime),
      runtime.listResources.bind(runtime),
      runtime.readOAuthCredentials.bind(runtime),
      runtime.performOAuth.bind(runtime),
      runtime.status.bind(runtime),
      runtime.refresh.bind(runtime),
      runtime.reload.bind(runtime),
      (server) => auth.mcpAuth.has(server),
      (server) => auth.mcpAuth.add(server),
      refreshToolDefinitions,
      runtime.subscribeStatus.bind(runtime),
      runtime.findResource.bind(runtime),
      runtime.readResource.bind(runtime),
    ),
  };
}

/** Session-scoped owners the published agent keeps for its whole life. */
export interface AgentFacadeOwners {
  readonly session: SessionClientOwner;
  readonly media: SessionMediaOwner | undefined;
  readonly tasks: TaskLaunchOwner;
  readonly shell: ShellJobOwner;
  readonly workspaceSkills: WorkspaceSkillOperations;
  readonly config: Config;
  readonly readRuntimeKind: () => RuntimeKind;
  readonly runtimeId: string;
  readonly runtimeState: AgentRuntimeState;
  readonly ownership: OwnershipRecord;
  readonly sessionIdentityOwnership: 'config' | 'facade';
  readonly initialAuth: AgentAuth | undefined;
  readonly onOAuthPrompt: AgentConfig['onOAuthPrompt'];
  readonly closeRuntime: () => Promise<void> | void;
  readonly awaitMcpDiscovery: McpTeardownPort['awaitDiscovery'];
  readonly closeMcpAdmission: () => void;
}

export interface AgentFacadeControls {
  readonly workspace: WorkspaceControl;
  readonly ide: IdeControl;
  readonly lsp: LspControl;
  readonly mcp: McpControl;
  readonly editors: { editorCallbacks: EditorCallbacks };
  readonly display: StableDisplayCallbacksHolder;
  readonly childDisplay: ChildToolDisplay | undefined;
  readonly authentication: Agent['authentication'];
  readonly authState: AgentAuthState;
}

export interface AgentFacadeSettings {
  readonly settingsOwner: SessionSettingsOwner;
  readonly settingsService: SettingsService;
}

export interface AgentFacadeProviders {
  readonly providers: RuntimeProviderManager;
}

export interface AgentFacadeAuth {
  readonly oauth: OAuthManager;
}

/** The authentication surface over the owner's OAuth and provider managers. */
export function assembleOwnerAuthentication(
  oauth: OAuthManager,
  providers: RuntimeProviderManager,
): Agent['authentication'] {
  return assembleSessionAuthentication(oauth, (provider) =>
    clearProviderAuthenticationCache(providers.getProviderByName(provider)),
  );
}

function buildToolControl(
  createToolControl: SessionClientOwner['createToolControl'],
  tasks: TaskLaunchOwner,
  shell: ShellJobOwner,
  controls: AgentFacadeControls,
  providerControl: SessionProviderControl,
): ToolControl {
  const assertSessionAdmission = (): void =>
    providerControl.coordinator.assertNoCommit();
  tasks.bindSessionAdmission(assertSessionAdmission);
  shell.bindSessionAdmission(assertSessionAdmission);
  return createToolControl(
    assertSessionAdmission,
    controls.childDisplay,
    controls.editors,
    controls.display,
    assembleToolKeys(),
  );
}

function buildSessionControl(
  createSessionControl: SessionClientOwner['createSessionControl'],
  rebuildExecution: () => void,
  identityOwnership: 'config' | 'facade',
  runtimeId: string,
  tasks: TaskLaunchOwner,
  shell: ShellJobOwner,
  providerControl: SessionProviderControl,
  tools: ToolControl,
): SessionControl {
  return createSessionControl(
    identityOwnership,
    () => runtimeId,
    createNewSessionAdmission(
      tasks,
      shell,
      providerControl.coordinator,
      tools,
      () => providerControl.assertProfileIdle(),
    ),
    () => providerControl.coordinator.closeAdmission(),
    rebuildExecution,
    () => providerControl.getProvider(),
    () => providerControl.getModel(),
  );
}

interface SessionScopedControls {
  readonly tools: ToolControl;
  readonly session: SessionControl;
  readonly hooks: HookControl;
  readonly policy: PolicyControl;
  readonly skills: SkillsControl;
}

function buildSessionScopedControls(
  owners: AgentFacadeOwners,
  controls: AgentFacadeControls,
  providerControl: SessionProviderControl,
): SessionScopedControls {
  const tools = buildToolControl(
    owners.session.createToolControl.bind(owners.session),
    owners.tasks,
    owners.shell,
    controls,
    providerControl,
  );
  const session = buildSessionControl(
    owners.session.createSessionControl.bind(owners.session),
    owners.session.clients.rebuildExecution.bind(owners.session.clients),
    owners.sessionIdentityOwnership,
    owners.runtimeId,
    owners.tasks,
    owners.shell,
    providerControl,
    tools,
  );
  return {
    tools,
    session,
    hooks: owners.session.createHookControl(session),
    policy: new PolicyControl(owners.session.policyInspection),
    skills: new SkillsControl(owners.workspaceSkills),
  };
}

interface PublishedControls {
  readonly providerControl: SessionProviderControl;
  readonly scoped: SessionScopedControls;
  readonly profilePersistence: ReturnType<typeof assembleProfilePersistence>;
}

function buildOperations(
  owners: AgentFacadeOwners,
  controls: AgentFacadeControls,
  settings: AgentFacadeSettings,
  providers: AgentFacadeProviders,
  published: PublishedControls,
): AgentOperations {
  const { providerControl, scoped, profilePersistence } = published;
  const { session, config } = owners;
  return new AgentOperations(
    createAgentTurnOwners(
      {
        hookOperations: session.hookOperations,
        resolveExecution: () => session.clients.resolveExecution(),
        generateText: (...args) => session.clients.generateText(...args),
        generateJson: (...args) => session.clients.generateJson(...args),
        generateEmbedding: (...args) =>
          session.clients.generateEmbedding(...args),
        resetChat: session.clients.conversationBinding.conversation.resetChat,
        compressHistory: (...args) =>
          session.clients.conversationBinding.compressHistory(...args),
      },
      providerControl,
      scoped.session,
      scoped.tools,
      settings.settingsService,
      providers.providers,
      owners.awaitMcpDiscovery,
    ),
    createAgentApprovalOwner(controls.ide, config),
    {
      ownership: owners.ownership,
      session: {
        closeAdmission: () => session.clients.closeAdmission(),
        closeHookAdmission: session.closeHookAdmission,
        joinAuxiliaryShutdown: () => session.clients.joinAuxiliaryShutdown(),
        closeImageAdmission: session.closeImageAdmission,
        closeToolAdmission: () => session.toolCatalog.closeAdmission(),
        abortExecution: () => session.clients.abortExecution(),
        dispose: () => session.dispose(),
      },
      coordinator: providerControl.coordinator,
      tasks: owners.tasks,
      shell: owners.shell,
      hooks: scoped.hooks,
      releaseHooks: session.transferHookRelease(),
      profilePersistence,
      closeMcpAdmission: owners.closeMcpAdmission,
      skills: scoped.skills,
      workspace: controls.workspace,
      sessionControl: scoped.session,
      ide: controls.ide,
      tools: scoped.tools,
      profiles: providerControl.profiles,
      mcp: controls.mcp,
      closeRuntime: owners.closeRuntime,
      media: owners.media,
    },
  );
}

function composeAgent(
  runtimeId: string,
  tasks: TaskLaunchOwner,
  shell: ShellJobOwner,
  conversationBinding: SessionClientOwner['clients']['conversationBinding'],
  sessionClient: Agent['sessionClient'],
  memory: Agent['memory'],
  controls: AgentFacadeControls,
  settings: AgentFacadeSettings,
  published: PublishedControls,
  operations: AgentOperations,
): AgentFacadeComposition {
  const { providerControl, scoped, profilePersistence } = published;
  const metrics = settings.settingsOwner.telemetry.localMetrics;
  return {
    workspace: controls.workspace,
    ide: controls.ide,
    lsp: controls.lsp,
    mcp: controls.mcp,
    runtimeId,
    authentication: controls.authentication,
    execution: providerControl.execution,
    modelParameters: providerControl.modelParameters,
    settings: providerControl.settings,
    conversation: conversationBinding.conversation,
    getStats: () => conversationBinding.readStats(metrics),
    onStats: (cb) => conversationBinding.observeStats(cb, metrics),
    toolFormat: providerControl.toolFormat,
    metrics,
    providerReads: providerControl.providerReads,
    hasActiveProvider: providerControl.hasActiveProvider,
    getProviderContextLimit: providerControl.getProviderContextLimit,
    listAvailableModels: providerControl.listAvailableModels,
    sessionClient,
    captureProfile: profilePersistence.captureProfile,
    saveProfileSnapshot: profilePersistence.saveProfileSnapshot,
    deleteProfileByName: profilePersistence.deleteProfileByName,
    getActiveProfileName: profilePersistence.getActiveProfileName,
    setDefaultProfileName: profilePersistence.setDefaultProfileName,
    getRuntimeDiagnosticsSnapshot:
      profilePersistence.getRuntimeDiagnosticsSnapshot,
    tools: scoped.tools,
    profiles: providerControl.profiles,
    auth: providerControl.auth,
    session: scoped.session,
    hooks: scoped.hooks,
    policy: scoped.policy,
    tasks: createTasksControl(tasks, shell),
    memory,
    skills: scoped.skills,
    injectSteer: operations.injectSteer.bind(operations),
    stream: operations.stream.bind(operations),
    getProvider: providerControl.getProvider,
    setProvider: providerControl.setProvider,
    getProviderStatus: providerControl.getProviderStatus,
    getModel: providerControl.getModel,
    setModel: providerControl.setModel,
    getApprovalMode: operations.getApprovalMode.bind(operations),
    setApprovalMode: operations.setApprovalMode.bind(operations),
    getModelParams: providerControl.getModelParams,
    resetChat: operations.resetChat.bind(operations),
    compress: operations.compress.bind(operations),
    generate: operations.generate.bind(operations),
    generateJson: operations.generateJson.bind(operations),
    generateEmbedding: operations.generateEmbedding.bind(operations),
    listProviders: providerControl.listProviders,
    dispose: operations.dispose.bind(operations),
  };
}

/**
 * Builds the live agent from persistent owners. Everything the agent keeps is
 * created here from owner values, never inside an assembly, so no assembly
 * instance is reachable from the agent after publication.
 */
export function publishAgentFacade(
  owners: AgentFacadeOwners,
  controls: AgentFacadeControls,
  settings: AgentFacadeSettings,
  providers: AgentFacadeProviders,
  auth: AgentFacadeAuth,
): Agent {
  const { session, config } = owners;
  const providerControl = createSessionProviderControl(
    {
      settingsOwner: settings.settingsOwner,
      settingsService: settings.settingsService,
    },
    providers.providers,
    auth.oauth,
    {
      rebuildExecution: () => session.clients.rebuildExecution(),
      refreshAuth: () => session.clients.refreshAuth(),
      restoreChatVisibility: () =>
        session.clients.conversationBinding.restoreChatVisibility(),
      isCurrentExecution: (execution) =>
        session.clients.isCurrentExecution(execution),
      prepareProfileExecution: (...args) =>
        session.clients.prepareProfileExecution(...args),
      subscribeBucketConsent: session.subscribeBucketConsent,
      respondToBucketConsent: session.respondToBucketConsent,
    },
    {
      config,
      authState: controls.authState,
      ownership: owners.ownership,
      runtimeState: owners.runtimeState,
      initialAuth: owners.initialAuth,
      onOAuthPrompt: owners.onOAuthPrompt,
      workspace: controls.workspace,
      readRuntimeKind: owners.readRuntimeKind,
    },
  );
  const published: PublishedControls = {
    providerControl,
    profilePersistence: assembleProfilePersistence(
      () => config.getModel(),
      () => config.getProvider(),
      settings.settingsService,
      providers.providers,
      () => settings.settingsOwner.captureNamedParameters(),
      controls.workspace.profileWrites,
    ),
    scoped: buildSessionScopedControls(owners, controls, providerControl),
  };
  const operations = buildOperations(
    owners,
    controls,
    settings,
    providers,
    published,
  );
  return createAgentFacade(
    session.clients.createProviderFileOperations(() =>
      providerControl.coordinator.assertSettingsAdmission(),
    ),
    composeAgent(
      owners.runtimeId,
      owners.tasks,
      owners.shell,
      session.clients.conversationBinding,
      idleClient(session.operations, providerControl.coordinator, () =>
        session.clients.rebuildExecution(),
      ),
      session.clients.memoryOperations,
      controls,
      settings,
      published,
      operations,
    ),
  );
}

export type FacadeParsedConfig = Parameters<typeof buildFacadeState>[0] & {
  readonly auth?: AgentAuth;
};

/** Values the construction path made before publication, read once. */
export interface FacadeConstruction {
  readonly parsed: FacadeParsedConfig;
  readonly baseUrl: string | undefined;
  readonly handles: AgentSchedulerHandle[];
  readonly tasks: TaskLaunchOwner;
  readonly shell: ShellJobOwner;
  readonly child: ChildToolDisplay;
  readonly editors: StableEditorCallbacksHolder;
  readonly display: StableDisplayCallbacksHolder;
}

/** What differs between the construction paths. */
export interface LeafFacadeValues {
  readonly runtimeId: string;
  readonly readRuntimeKind: () => RuntimeKind;
  readonly ownership: OwnershipRecord;
  readonly sessionIdentityOwnership: 'config' | 'facade';
  readonly onOAuthPrompt: AgentConfig['onOAuthPrompt'];
  readonly closeRuntime: () => Promise<void> | void;
  readonly awaitMcpDiscovery: McpTeardownPort['awaitDiscovery'];
  readonly closeMcpAdmission: () => void;
}

export function assembleShellOwner(settings: SettingsService): ShellJobOwner {
  return new ShellJobOwner(() => resolveShellJobSettings(settings));
}

/**
 * Builds the five publication records every construction path shares and
 * publishes the agent. Each leaf's `facadeInputsFor<Leaf>` supplies the
 * ownership record and the closures that differ.
 */
export function publishLeafFacade(
  runtime: FacadePublicationPort,
  config: Config,
  session: SessionClientOwner,
  settingsOwner: SessionSettingsOwner,
  media: SessionMediaOwner | undefined,
  settingsService: SettingsService,
  providers: RuntimeProviderManager,
  oauth: OAuthManager,
  construction: FacadeConstruction,
  leaf: LeafFacadeValues,
): Agent {
  const authState = createAgentAuthState();
  const workspaceControls = assembleWorkspaceFacade(
    runtime,
    config,
    session.toolCatalog.selection,
    session.clients.refreshToolDefinitions,
    authState,
    construction.editors,
  );
  return publishAgentFacade(
    {
      session,
      media,
      tasks: construction.tasks,
      shell: construction.shell,
      workspaceSkills: runtime.workspaceSkills.operations,
      config,
      readRuntimeKind: leaf.readRuntimeKind,
      runtimeId: leaf.runtimeId,
      runtimeState: buildFacadeState(
        construction.parsed,
        construction.baseUrl,
        leaf.runtimeId,
      ),
      ownership: leaf.ownership,
      sessionIdentityOwnership: leaf.sessionIdentityOwnership,
      initialAuth: construction.parsed.auth,
      onOAuthPrompt: leaf.onOAuthPrompt,
      closeRuntime: leaf.closeRuntime,
      awaitMcpDiscovery: leaf.awaitMcpDiscovery,
      closeMcpAdmission: leaf.closeMcpAdmission,
    },
    {
      ...workspaceControls,
      editors: construction.editors,
      display: construction.display,
      childDisplay: construction.child,
      authentication: assembleOwnerAuthentication(oauth, providers),
      authState,
    },
    { settingsOwner, settingsService },
    { providers },
    { oauth },
  );
}
