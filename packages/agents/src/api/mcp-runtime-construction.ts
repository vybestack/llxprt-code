import { createMcpApprovalPolicy } from '@vybestack/llxprt-code-core/policy/mcp-approval.js';
import { persistPolicyToToml } from '@vybestack/llxprt-code-core/policy/config.js';
import type { McpApprovalPolicy } from '@vybestack/llxprt-code-mcp';
import { WorkspaceAuthorityComposition } from './workspace-authority-composition.js';
import type { WorkspaceMcpSettings } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { WorkspaceCheckpointOwner } from '@vybestack/llxprt-code-core';
import type { SessionMcpSettingsReads } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import type { McpConstructionResources } from './mcp-construction-resources.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  Config,
  WorkspaceTrustControlPort,
  WorkspaceIdePort,
  WorkspaceCheckpointOperations,
  WorkspaceDefinitionOwner,
  ProfileDefinitionReads,
  ProfileDefinitionWrites,
  SubagentDefinitionReads,
  SubagentDefinitionWrites,
  DiscoveredMCPResource,
} from '@vybestack/llxprt-code-core';
import type { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type {
  WorkspaceLspOwner,
  WorkspaceLspInspection,
} from '@vybestack/llxprt-code-core/lsp/workspace-lsp-owner.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import type {
  McpClientManager,
  DiscoveredMCPPrompt,
  TokenStorage,
  McpOAuthBinding,
} from '@vybestack/llxprt-code-mcp';
import type { McpHostServices } from '@vybestack/llxprt-code-mcp/host/hostServices.js';
import type {
  McpRuntimeStatusView,
  McpControlDeps,
} from './control/mcpControl.js';
import type { MemoryHandoff } from './mcpOAuthAssembly.js';

export interface AgentMcpOperations {
  readonly trust: WorkspaceTrustControlPort;
  readonly ide: WorkspaceIdePort;
  closeAdmission(): void;
  readonly profileDefinitions: ProfileDefinitionReads;
  readonly profileWrites: ProfileDefinitionWrites;
  readonly subagentDefinitions: SubagentDefinitionReads;
  readonly subagentWrites: SubagentDefinitionWrites;
  readonly checkpointOperations: WorkspaceCheckpointOperations;
  readonly workspacePaths: WorkspaceFilesystemOwner['paths'];
  readonly workspaceFiles: WorkspaceFilesystemOwner['files'];
  readonly workspaceIgnore: WorkspaceFilesystemOwner['ignore'];
  readonly workspaceScans: WorkspaceFilesystemOwner['scans'];
  readonly workspaceSearch: WorkspaceFilesystemOwner['search'];
  readonly addWorkspaceDirectory: (directory: string) => void;
  readonly lspInspection: WorkspaceLspInspection;
  readonly policyInspection: RuntimePolicyOwner['session']['inspection'];
  readonly performOAuth: NonNullable<McpControlDeps['performOAuth']>;
  readonly readOAuthCredentials: TokenStorage['getCredentials'];
  listPrompts(server: string): DiscoveredMCPPrompt[];
  listResources(): DiscoveredMCPResource[];
  findResource(identifier: string): DiscoveredMCPResource | undefined;
  readResource(server: string, uri: string): Promise<unknown>;
  status(): McpRuntimeStatusView | undefined;
  subscribeStatus(listener: () => void): () => void;
  refresh(server?: string): Promise<void>;
  reload(): Promise<void>;
  readServerSettings(): WorkspaceMcpSettings;
  awaitDiscovery(): Promise<ReadonlyMap<string, string>>;
}

export function constructPolicyOwner(
  config: Config,
  bus: MessageBus | undefined,
  owner: RuntimePolicyOwner | undefined,
  trust: WorkspaceTrustControlPort,
): RuntimePolicyOwner {
  if (bus !== undefined && owner === undefined)
    throw new Error('MCP policy handoff requires its explicit runtime owner');
  if (bus !== undefined && bus !== owner?.session.messageBus)
    throw new Error('MCP policy handoff must retain its session MessageBus');
  if (owner !== undefined && owner.trust !== trust)
    throw new Error('Policy handoff must retain its trust authority');
  return owner ?? new RuntimePolicyOwner(config, trust);
}

export type McpRuntimeConstructionInputs = [
  oauth: McpOAuthBinding,
  config: Config,
  messageBus?: MessageBus,
  host?: Partial<Pick<McpHostServices, 'emitFeedback'>>,
  managerFactory?: typeof McpClientManager,
  extensionLoader?: ExtensionLoader,
  policyOwner?: RuntimePolicyOwner,
  policyOwnership?: 'runtime' | 'caller',
  lspOwner?: WorkspaceLspOwner,
  lspOwnership?: 'runtime' | 'caller',
  filesystemOwner?: WorkspaceFilesystemOwner,
  filesystemOwnership?: 'runtime' | 'caller',
  memoryOwner?: MemoryHandoff,
  definitionOwner?: WorkspaceDefinitionOwner,
  definitionOwnership?: 'runtime' | 'caller',
  trustPort?: WorkspaceTrustControlPort,
  idePort?: WorkspaceIdePort,
  trustCleanup?: () => Promise<void>,
  skillOperations?: WorkspaceSkillAssemblyOperations,
  mcpSettings?: SessionMcpSettingsReads,
];

export function retainPolicyOwner(
  resources: McpConstructionResources,
  config: Config,
  bus: MessageBus | undefined,
  supplied: RuntimePolicyOwner | undefined,
  trust: WorkspaceTrustControlPort,
  ownership: 'runtime' | 'caller',
): { owner: RuntimePolicyOwner; owned: boolean } {
  const owner = constructPolicyOwner(config, bus, supplied, trust);
  const owned = supplied === undefined || ownership === 'runtime';
  if (owned) resources.retain(() => owner.dispose());
  return { owner, owned };
}

export function retainWorkspaceCheckpoints(
  resources: McpConstructionResources,
  config: Pick<
    Config,
    'getTargetDir' | 'projectHistoryDir' | 'getCheckpointingEnabled'
  >,
): WorkspaceCheckpointOwner {
  const owner = new WorkspaceCheckpointOwner(
    config.getTargetDir(),
    config.projectHistoryDir,
    config.getCheckpointingEnabled(),
  );
  resources.retain(() => owner.dispose());
  return owner;
}

export function retainWorkspaceAuthority(
  resources: McpConstructionResources,
  config: Config,
  trust: WorkspaceTrustControlPort | undefined,
  ide: WorkspaceIdePort | undefined,
  cleanup: (() => Promise<void>) | undefined,
): WorkspaceAuthorityComposition {
  const authority = new WorkspaceAuthorityComposition(
    config,
    trust,
    ide,
    cleanup,
  );
  resources.retain(() => authority.dispose());
  return authority;
}
export function retainMcpPolicyProjection(
  resources: McpConstructionResources,
  owner: RuntimePolicyOwner,
  read: () => ReturnType<Config['getMcpServers']>,
): () => void {
  const release = owner.workspace.bindMcpServers(read);
  resources.retain(release);
  return release;
}

export function defaultWorkspaceOwnership(
  owner: object | undefined,
): 'runtime' | 'caller' {
  return owner === undefined ? 'runtime' : 'caller';
}
export function assembleWorkspaceApproval(
  owner: RuntimePolicyOwner,
  writes: Set<Promise<void>>,
  assertActive: () => void,
): McpApprovalPolicy {
  return createMcpApprovalPolicy(
    { ...owner.session.decisions, ...owner.session.confirmation },
    (message) => {
      const operation = persistPolicyToToml(message);
      writes.add(operation);
      void operation
        .finally(() => writes.delete(operation))
        .catch(() => undefined);
      return operation;
    },
    assertActive,
  );
}

export function selectMcpConstructionInputs([
  oauth,
  config,
  messageBus,
  host,
  managerFactory,
  extensionLoader,
  policyOwner,
  policyOwnership = 'caller',
  lspOwner,
  lspOwnership = defaultWorkspaceOwnership(lspOwner),
  filesystemOwner,
  filesystemOwnership = defaultWorkspaceOwnership(filesystemOwner),
  memoryOwner,
  definitionOwner,
  definitionOwnership = defaultWorkspaceOwnership(definitionOwner),
  trustPort,
  idePort,
  trustCleanup,
  skillOperations,
  mcpSettings,
]: McpRuntimeConstructionInputs) {
  return {
    oauth,
    config,
    messageBus,
    host,
    managerFactory,
    extensionLoader,
    policyOwner,
    policyOwnership,
    lspOwner,
    lspOwnership,
    filesystemOwner,
    filesystemOwnership,
    memoryOwner,
    definitionOwner,
    definitionOwnership,
    trustPort,
    idePort,
    trustCleanup,
    skillOperations,
    mcpSettings,
  };
}
