/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The MCP operations each collaborator reads, declared apart from the owner
 * that implements them. `McpRuntimeOwner` is held whole only by the code that
 * constructs it and the code that disposes it; every other consumer is typed
 * by the ports below.
 *
 * Each port names the calls of one collaborator. The composed ports at the end
 * exist for the construction paths that really acquire, bind, activate, publish
 * and tear down in one operation; they are intersections of the narrow ports,
 * not inheritance chains that hand a whole runtime to an ordinary consumer.
 */
import type {
  Config,
  ProfileDefinitionReads,
  ProfileDefinitionWrites,
  SubagentDefinitionReads,
  SubagentDefinitionWrites,
  WorkspaceCheckpointOperations,
  WorkspaceIdePort,
  WorkspaceTrustControlPort,
  DiscoveredMCPResource,
} from '@vybestack/llxprt-code-core';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type {
  WorkspaceLspInspection,
  WorkspaceLspOwner,
} from '@vybestack/llxprt-code-core/lsp/workspace-lsp-owner.js';
import type { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { WorkspaceMemoryOwner } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import type { WorkspaceSkillOwner } from '@vybestack/llxprt-code-core/skills/workspace-skill-owner.js';
import type { WorkspaceExtensionOperations } from '@vybestack/llxprt-code-core/utils/workspace-extension-owner.js';
import type { WorkspaceMcpSettings } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type {
  TokenStorage,
  DiscoveredMCPPrompt,
} from '@vybestack/llxprt-code-mcp';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import type {
  McpRuntimeStatusView,
  McpControlDeps,
} from './control/mcpControl.js';
import type { SessionClientHookBinding } from './session-hook-binding.js';

/**
 * What the session client's acquisition keeps reading for the whole session:
 * IDE context, folder trust, whether the runtime behind it still accepts work,
 * and the hook reload registration.
 */
export interface SessionWorkspaceAuthorityPort {
  readonly ide: WorkspaceIdePort;
  readonly trust: WorkspaceTrustControlPort;
  isStopped(): boolean;
  /** Registers a session hook reload for this binding token. */
  bindSessionHookReload(
    token: symbol,
    reloadHooks: () => Promise<void>,
  ): () => void;
}

/** The workspace readers one child task launch inherits from its session. */
export interface ChildTaskWorkspacePort {
  readonly workspacePaths: WorkspaceFilesystemOwner['paths'];
  readonly trust: WorkspaceTrustControlPort;
  readonly policyOwner: Pick<RuntimePolicyOwner, 'workspace' | 'session'>;
  readonly readInstructions: () => string | undefined;
}

/**
 * What one bound session client reads from the MCP runtime. `bindMcpRuntime`
 * reads every member here: it binds the IDE context and instructions, keeps the
 * workspace authority for its lifetime, composes the tool catalog, registers
 * child launches from the inherited readers, and hands the runtime back the
 * publication callbacks.
 */
export interface SessionMcpBindingPort {
  readonly ide: WorkspaceIdePort;
  readonly trust: WorkspaceTrustControlPort;
  isStopped(): boolean;
  /** Registers a session hook reload for this binding token. */
  bindSessionHookReload(
    token: symbol,
    reloadHooks: () => Promise<void>,
  ): () => void;
  readonly workspacePaths: WorkspaceFilesystemOwner['paths'];
  readonly policyOwner: Pick<RuntimePolicyOwner, 'workspace' | 'session'>;
  readonly readInstructions: () => string | undefined;
  readonly workspaceFiles: WorkspaceFilesystemOwner['files'];
  readonly workspaceIgnore: WorkspaceFilesystemOwner['ignore'];
  readonly workspaceScans: WorkspaceFilesystemOwner['scans'];
  readonly workspaceLsp: Pick<WorkspaceLspOwner, 'diagnostics'>;
  readonly workspaceMemory: WorkspaceMemoryOwner;
  readonly toolSelection: ToolSelection;
  readonly profileDefinitions: ProfileDefinitionReads;
  readonly subagentDefinitions: SubagentDefinitionReads;
  bindSessionClient(
    config: Config,
    token: symbol,
    readClient: () => AgentClientContract,
    publishTools: () => Promise<void>,
    publishInstructions: () => Promise<void>,
    bindInstructions: (
      read: () => string | undefined,
      release: () => void,
    ) => void,
    acceptSkillPublication?: SessionClientHookBinding['acceptSkillPublication'],
  ): void;
}

/**
 * The binding a freshly acquired session client reads from MCP: the binding
 * port plus the one bus it hands the client it constructs.
 */
export type CreatedSessionMcpPort = SessionMcpBindingPort & {
  readonly messageBus: MessageBus;
};

/** The one activation step a session binding performs on its runtime. */
export interface McpInitializationPort {
  initialize(): Promise<void>;
}

/**
 * The runtime a foreground construction binds then initializes, before it
 * hands the facade controls over: `bindMcpRuntime` plus `initialize`.
 */
export type SessionBindingActivationPort = SessionMcpBindingPort &
  McpInitializationPort;

/** The two workspace reads an adopted session client is constructed with. */
export interface SessionWorkspaceReadsPort {
  readonly workspacePaths: WorkspaceFilesystemOwner['paths'];
  readonly readInstructions: () => string | undefined;
}

/** Activation steps the MCP runtime performs for the agent that owns it. */
export type AgentActivationPort = McpInitializationPort & {
  assertConfig(config: Config, messageBus: MessageBus): void;
};

/** Teardown and discovery settling, the MCP work a construction path records. */
export interface McpTeardownPort {
  dispose(): Promise<void>;
  awaitDiscovery(): Promise<ReadonlyMap<string, string>>;
  closeAdmission(): void;
}

/**
 * The workspace and MCP controls the published facade exposes.
 * `assembleWorkspaceFacade` reads every member of this port.
 */
export interface WorkspaceFacadeMcpPort {
  readonly profileDefinitions: ProfileDefinitionReads;
  readonly profileWrites: ProfileDefinitionWrites;
  readonly subagentDefinitions: SubagentDefinitionReads;
  readonly subagentWrites: SubagentDefinitionWrites;
  readonly checkpointOperations: WorkspaceCheckpointOperations;
  readonly workspaceIgnore: WorkspaceFilesystemOwner['ignore'];
  readonly workspaceSearch: WorkspaceFilesystemOwner['search'];
  readonly workspaceFiles: WorkspaceFilesystemOwner['files'];
  readonly workspacePaths: WorkspaceFilesystemOwner['paths'];
  readonly addWorkspaceDirectory: (directory: string) => void;
  readonly trust: WorkspaceTrustControlPort;
  readonly ide: WorkspaceIdePort;
  readonly lspInspection: WorkspaceLspInspection;
  readonly readOAuthCredentials: TokenStorage['getCredentials'];
  readonly performOAuth: NonNullable<McpControlDeps['performOAuth']>;
  listPrompts(server: string): DiscoveredMCPPrompt[];
  listResources(): DiscoveredMCPResource[];
  findResource(identifier: string): DiscoveredMCPResource | undefined;
  readResource(server: string, uri: string): Promise<unknown>;
  status(): McpRuntimeStatusView | undefined;
  subscribeStatus(listener: () => void): () => void;
  refresh(server?: string): Promise<void>;
  reload(): Promise<void>;
  readServerSettings(): WorkspaceMcpSettings;
}

/** The skill operations the published facade's `SkillsControl` reads. */
export interface AgentSkillsPort {
  readonly workspaceSkills: Pick<WorkspaceSkillOwner, 'operations'>;
}

/** The extension restart hook the foreground host registers. */
export interface AgentExtensionOperationsPort {
  readonly extensionOperations: WorkspaceExtensionOperations;
}

/**
 * The runtime a publishing foreground is handed: it reads the facade controls,
 * publishes the skills, and settles at teardown. Publication binds no session
 * and activates nothing, because the construction path that acquired the
 * runtime already did both.
 */
export type PublishedMcpPort = WorkspaceFacadeMcpPort &
  AgentSkillsPort &
  McpTeardownPort;

/**
 * The runtime a foreground construction holds while it binds and activates the
 * session client, registers the host's skill and extension hooks, and hands the
 * facade controls to the publication. Every part is read on that path.
 */
export type ForegroundMcpPort = PublishedMcpPort &
  SessionMcpBindingPort &
  McpInitializationPort &
  AgentExtensionOperationsPort;

/**
 * The runtime a created agent holds for its whole life: it binds the session,
 * publishes the facade, activates, settles discovery and disposes at teardown.
 * The created-agent assembly performs all of those steps.
 */
export type AgentRuntimeMcpPort = CreatedSessionMcpPort &
  WorkspaceFacadeMcpPort &
  AgentSkillsPort &
  AgentActivationPort &
  McpTeardownPort;

/**
 * The runtime the adopted (`fromConfig`) construction builds for itself: it
 * binds the session client it acquires, initializes the workspace, publishes
 * the facade controls, and tears the runtime down when the adopted prefix rolls
 * back. The adopted path registers no extension hook, so that member is absent.
 */
export type AdoptedMcpPort = CreatedSessionMcpPort &
  WorkspaceFacadeMcpPort &
  AgentSkillsPort &
  McpInitializationPort &
  McpTeardownPort;
