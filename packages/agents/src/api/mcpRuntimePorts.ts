/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The MCP operations each collaborator reads, declared apart from the owner
 * that implements them. `McpRuntimeOwner` is held whole only by the code that
 * constructs it and the code that disposes it; every other consumer is typed
 * by one of the ports below.
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
 * The workspace authority a bound session keeps reading: IDE context, folder
 * trust, and whether the runtime behind it is still accepting work.
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

/** The session tool composition a bound MCP runtime supplies. */
export interface SessionMcpBindingPort
  extends SessionWorkspaceAuthorityPort,
    ChildTaskWorkspacePort {
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

/** The binding a freshly acquired session client reads from MCP. */
export interface CreatedSessionMcpPort extends SessionMcpBindingPort {
  readonly messageBus: MessageBus;
}

/** Activation steps the MCP runtime performs for the agent that owns it. */
export interface AgentActivationPort {
  assertConfig(config: Config, messageBus: MessageBus): void;
  initialize(): Promise<void>;
}

/** Teardown and discovery settling, the MCP work a construction path records. */
export interface McpTeardownPort {
  dispose(): Promise<void>;
  awaitDiscovery(): Promise<ReadonlyMap<string, string>>;
  closeAdmission(): void;
}

/**
 * The runtime a created agent holds for its whole life: it binds the session,
 * publishes the facade, activates, settles discovery and disposes at teardown.
 */
export interface AgentRuntimeMcpPort
  extends CreatedSessionMcpPort,
    AgentFacadeMcpPort,
    AgentActivationPort,
    McpTeardownPort {}

/**
 * The runtime a publishing foreground is handed: it reads the facade controls
 * and settles at teardown. Publication binds no session and activates nothing,
 * because the construction path that acquired the runtime already did both.
 */
export interface PublishedMcpPort extends AgentFacadeMcpPort, McpTeardownPort {}

/** The MCP operations the published agent facade exposes. */
export interface AgentFacadeMcpPort {
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
  readonly workspaceSkills: Pick<WorkspaceSkillOwner, 'operations'>;
  readonly extensionOperations: WorkspaceExtensionOperations;
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

/**
 * The runtime an acquiring foreground path holds until it hands it over: it
 * binds and activates the session client, publishes the facade controls,
 * settles discovery, closes admission and disposes.
 */
export interface ForegroundMcpPort
  extends AgentFacadeMcpPort,
    SessionMcpBindingPort,
    AgentActivationPort,
    McpTeardownPort {}
