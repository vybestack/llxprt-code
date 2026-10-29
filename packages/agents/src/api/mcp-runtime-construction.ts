import { createMcpApprovalPolicy } from '@vybestack/llxprt-code-core/policy/mcp-approval.js';
import { persistPolicyToToml } from '@vybestack/llxprt-code-core/policy/config.js';
import type { McpApprovalPolicy } from '@vybestack/llxprt-code-mcp';
import { WorkspaceAuthorityComposition } from './workspace-authority-composition.js';
import { WorkspaceCheckpointOwner } from '@vybestack/llxprt-code-core';
import type { SessionMcpSettingsReads } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import type { McpConstructionResources } from './mcp-construction-resources.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FileSystemService } from '@vybestack/llxprt-code-core/services/fileSystemService.js';

import type {
  Config,
  WorkspaceTrustControlPort,
  WorkspaceIdePort,
  WorkspaceDefinitionOwner,
} from '@vybestack/llxprt-code-core';
import type { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { WorkspaceLspOwner } from '@vybestack/llxprt-code-core/lsp/workspace-lsp-owner.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import type {
  McpClientManager,
  McpOAuthBinding,
} from '@vybestack/llxprt-code-mcp';
import type { HostFeedbackSink } from '@vybestack/llxprt-code-mcp/host/hostServices.js';
import type { WorkspaceMemoryOwner } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';

/**
 * A caller either supplies an owner with the promise of who releases it, or
 * states that it has none and MCP builds one. `none` is a positive statement:
 * omitting the key does not compile.
 */
export type McpOwnerHandoff<Owner> =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'supplied';
      readonly owner: Owner;
      readonly ownership: 'runtime' | 'caller';
    };

export type McpPolicyHandoff = McpOwnerHandoff<RuntimePolicyOwner>;

/**
 * The trust authority a construction path hands over, with the caller's own
 * cleanup for it. `none` lets the authority build and own one.
 */
export type McpTrustHandoff =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'supplied';
      readonly owner: WorkspaceTrustControlPort;
      readonly cleanup: (() => Promise<void>) | undefined;
    };

/**
 * An optional capability a host may legitimately not have. `none` is stated,
 * so every construction path either supplies the capability or says it does
 * not have one.
 */
export type McpCapability<Capability> =
  | { readonly kind: 'none' }
  | { readonly kind: 'supplied'; readonly capability: Capability };

/** The capability a host supplied, or undefined when it stated none. */
export function capabilityValue<Capability>(
  capability: McpCapability<Capability>,
): Capability | undefined {
  return capability.kind === 'supplied' ? capability.capability : undefined;
}

/** The owner a handoff carries, or undefined when the caller had none. */
export function handoffOwner<Owner>(
  handoff: McpOwnerHandoff<Owner>,
): Owner | undefined {
  return handoff.kind === 'supplied' ? handoff.owner : undefined;
}

/**
 * Trust stated directly wins; otherwise a supplied policy owner already
 * carries the trust authority it was constructed with.
 */
export function resolveTrustHandoff(
  trust: McpTrustHandoff,
  policy: McpPolicyHandoff,
): McpTrustHandoff {
  if (trust.kind === 'supplied' || policy.kind === 'none') return trust;
  return {
    kind: 'supplied',
    owner: policy.owner.trust,
    cleanup: undefined,
  };
}

/**
 * Who releases the owner in a handoff. A buildable absence is runtime-owned,
 * which is what every construction path already did for a missing key.
 */
export function handoffOwnership<Owner>(
  handoff: McpOwnerHandoff<Owner>,
): 'runtime' | 'caller' {
  return handoff.kind === 'supplied' ? handoff.ownership : 'runtime';
}

/**
 * Everything one MCP runtime construction needs. Each field is required;
 * absence is a named variant, so no caller writes runs of `undefined`.
 */
export interface McpRuntimeAcquisition {
  readonly oauth: McpOAuthBinding;
  readonly config: Config;
  readonly managerFactory: typeof McpClientManager;
  readonly extensionLoader: McpOwnerHandoff<ExtensionLoader>;
  readonly policy: McpPolicyHandoff;
  readonly lsp: McpOwnerHandoff<WorkspaceLspOwner>;
  readonly filesystem: McpOwnerHandoff<WorkspaceFilesystemOwner>;
  readonly filesystemService: McpOwnerHandoff<FileSystemService>;
  readonly memory: McpOwnerHandoff<WorkspaceMemoryOwner>;
  readonly definitions: McpOwnerHandoff<WorkspaceDefinitionOwner>;
  readonly trust: McpTrustHandoff;
  readonly ide: McpOwnerHandoff<WorkspaceIdePort>;
}

export interface McpRuntimeOperations {
  readonly emitFeedback: HostFeedbackSink;
  /** `none` runs the default skill assembly operations. */
  readonly skillOperations: McpCapability<WorkspaceSkillAssemblyOperations>;
  /** `none` means server reload is unavailable in this composition. */
  readonly mcpSettings: McpCapability<SessionMcpSettingsReads>;
}
/**
 * Caller-supplied workspace owners handed over with runtime ownership are
 * released by the construction resources from the moment MCP accepts them, so
 * a construction failure at any point releases each of them exactly once.
 * Dependents release first because resources release in reverse order.
 */
export function retainSuppliedRuntimeOwners(
  resources: McpConstructionResources,
  inputs: Pick<
    McpRuntimeAcquisition,
    'filesystem' | 'memory' | 'definitions' | 'lsp'
  >,
): void {
  const filesystem = handoffOwner(inputs.filesystem);
  if (
    filesystem !== undefined &&
    handoffOwnership(inputs.filesystem) === 'runtime'
  )
    resources.retain(() => filesystem.dispose());
  const memory = handoffOwner(inputs.memory);
  if (memory !== undefined && handoffOwnership(inputs.memory) === 'runtime')
    resources.retain(() => memory.dispose());
  const definitions = handoffOwner(inputs.definitions);
  if (
    definitions !== undefined &&
    handoffOwnership(inputs.definitions) === 'runtime'
  )
    resources.retain(() => definitions.dispose());
  const lsp = handoffOwner(inputs.lsp);
  if (lsp !== undefined && handoffOwnership(inputs.lsp) === 'runtime')
    resources.retain(() => lsp.dispose());
}

export function constructPolicyOwner(
  config: Config,
  policy: McpPolicyHandoff,
  trust: WorkspaceTrustControlPort,
): RuntimePolicyOwner {
  const supplied = handoffOwner(policy);
  if (supplied !== undefined && supplied.trust !== trust)
    throw new Error('Policy handoff must retain its trust authority');
  return supplied ?? new RuntimePolicyOwner(config, trust);
}

export function retainPolicyOwner(
  resources: McpConstructionResources,
  config: Config,
  policy: McpPolicyHandoff,
  trust: WorkspaceTrustControlPort,
): { owner: RuntimePolicyOwner; owned: boolean } {
  const owner = constructPolicyOwner(config, policy, trust);
  const owned = handoffOwnership(policy) === 'runtime';
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
  trust: McpTrustHandoff,
  ide: McpOwnerHandoff<WorkspaceIdePort>,
): WorkspaceAuthorityComposition {
  const authority = new WorkspaceAuthorityComposition(
    config,
    trust.kind === 'supplied' ? trust.owner : undefined,
    handoffOwner(ide),
    trust.kind === 'supplied' ? trust.cleanup : undefined,
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
