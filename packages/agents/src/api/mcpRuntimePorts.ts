/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The MCP operations each collaborator reads, declared apart from the owner
 * that implements them. `McpRuntimeOwner` is held whole only by the code that
 * constructs it and the code that disposes it.
 *
 * Each port below names one consumer and the members that consumer reads. The
 * construction-path ports at the end intersect several of them because those
 * paths perform every one of the steps: they acquire, bind, initialize,
 * publish, settle discovery and dispose. A path that skips a step is typed by
 * fewer ports, as the adopted path is.
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
 * Read by `SessionClientAcquisitionOwner` for the whole session: the IDE
 * context it forwards to each client, the trust control loop construction
 * takes, the stopped flag instruction publication checks, and the hook reload
 * binding it registers.
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

/**
 * Read by `SessionClientOwner.bindSessionApproval`. It chooses between the
 * borrowed session policy and one it owns, and forwards decisions, so the
 * policy owner is the only member this consumer reads.
 */
export interface SessionPolicyCompositionPort {
  readonly policyOwner: Pick<RuntimePolicyOwner, 'workspace' | 'session'>;
}

/**
 * Read by `SessionMcpBindingPort`'s child launch registration and by the
 * adopted session acquisition: the workspace paths a child inherits, the trust
 * it reads, and the instructions it shares.
 */
export interface ChildTaskInheritancePort {
  readonly workspacePaths: WorkspaceFilesystemOwner['paths'];
  readonly trust: WorkspaceTrustControlPort;
  readonly readInstructions: () => string | undefined;
}

/**
 * Read by the session tool catalog composition: the workspace readers the tool
 * selection is built from, the diagnostics it exposes, the memory owner the
 * instructions bind to, and the definition readers a child inherits.
 */
export interface SessionToolCompositionPort {
  readonly workspaceFiles: WorkspaceFilesystemOwner['files'];
  readonly workspaceIgnore: WorkspaceFilesystemOwner['ignore'];
  readonly workspaceScans: WorkspaceFilesystemOwner['scans'];
  readonly workspaceLsp: Pick<WorkspaceLspOwner, 'diagnostics'>;
  readonly workspaceMemory: WorkspaceMemoryOwner;
  readonly toolSelection: ToolSelection;
  readonly profileDefinitions: ProfileDefinitionReads;
  readonly subagentDefinitions: SubagentDefinitionReads;
}

/** The publication callbacks a bound client registers with its runtime. */
export interface SessionClientPublicationPort {
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
 * What `SessionClientOwner.bindMcpRuntime` reads. That one method performs all
 * five roles above: it binds the IDE context, keeps the workspace authority,
 * composes the policy, builds the tool catalog and hands the runtime back its
 * publication callbacks. Every member is read on that path.
 */
export type SessionMcpBindingPort = SessionWorkspaceAuthorityPort &
  SessionPolicyCompositionPort &
  ChildTaskInheritancePort &
  SessionToolCompositionPort &
  SessionClientPublicationPort;

/**
 * What `bindCreatedSessionClient` reads: the binding it forwards, plus the one
 * bus the client it constructs is given.
 */
export type CreatedSessionMcpPort = SessionMcpBindingPort & {
  readonly messageBus: MessageBus;
};

/**
 * What the adopted session acquisition reads: only the two workspace values
 * its `acquireSessionClient` call forwards.
 */
export type SessionWorkspaceReadsPort = Pick<
  ChildTaskInheritancePort,
  'workspacePaths' | 'readInstructions'
>;

/** The one activation step a session binding performs on its runtime. */
export interface McpInitializationPort {
  initialize(): Promise<void>;
}

/**
 * Read by `activateCreatedSession`: the created-agent path asserts the runtime
 * belongs to this Config and bus, then initializes it before activation.
 */
export type AgentActivationPort = McpInitializationPort & {
  assertConfig(config: Config, messageBus: MessageBus): void;
};

/** Read at teardown by the construction paths that hold the runtime. */
export interface McpTeardownPort {
  dispose(): Promise<void>;
  awaitDiscovery(): Promise<ReadonlyMap<string, string>>;
  closeAdmission(): void;
}

/**
 * Read by `buildOwnedMcpControl`, which builds the published `McpControl` from
 * these operations and nothing else.
 */
export interface McpControlReadPort {
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
 * Read by `assembleWorkspaceFacade`, which builds the workspace, IDE, LSP and
 * MCP controls. Every member is read there: the six definition operations and
 * the workspace readers go to `WorkspaceControl`, trust and IDE context to
 * `IdeControl`, the inspection to `LspControl`, and `McpControlReadPort` to the
 * MCP control.
 */
export interface WorkspaceFacadeMcpPort extends McpControlReadPort {
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
}

/** Read by the published facade's `SkillsControl`. */
export interface AgentSkillsPort {
  readonly workspaceSkills: Pick<WorkspaceSkillOwner, 'operations'>;
}

/** Read by the foreground host, which registers the extension restart hook. */
export interface AgentExtensionOperationsPort {
  readonly extensionOperations: WorkspaceExtensionOperations;
}

/**
 * What `publishLeafFacade` reads: the facade controls it assembles and the
 * skill operations it hands the published `SkillsControl`. It reads no
 * teardown member; the construction paths that build the leaf closures own
 * those.
 */
export type FacadePublicationPort = WorkspaceFacadeMcpPort & AgentSkillsPort;

/**
 * Read by `ForegroundAssembly`. It reads the facade controls for publication
 * and builds the leaf teardown closures from the same value, so it reads both
 * parts.
 */
export type PublishedMcpPort = FacadePublicationPort & McpTeardownPort;

/**
 * Read by `AgentActivationBootstrap`'s foreground completion: it binds the
 * session client, initializes the workspace, publishes the facade, registers
 * the host's skill and extension hooks, and disposes on failure. Every part is
 * read on that path.
 */
export type ForegroundMcpPort = PublishedMcpPort &
  SessionMcpBindingPort &
  McpInitializationPort &
  AgentExtensionOperationsPort;

/**
 * Read by `AgentRuntimeAssembly` for the created agent's whole life: it binds
 * the session, publishes the facade, activates, settles discovery and disposes
 * at teardown. Every part is read on that path.
 */
export type AgentRuntimeMcpPort = CreatedSessionMcpPort &
  WorkspaceFacadeMcpPort &
  AgentSkillsPort &
  AgentActivationPort &
  McpTeardownPort;

/**
 * Read by `AdoptedAgentAssembly`: it binds the session client it acquires,
 * initializes the workspace, publishes the facade controls through the
 * foreground it builds, and disposes when the adopted prefix rolls back. The
 * adopted path registers no extension hook, so that member is absent.
 */
export type AdoptedMcpPort = CreatedSessionMcpPort &
  WorkspaceFacadeMcpPort &
  AgentSkillsPort &
  McpInitializationPort &
  McpTeardownPort;
