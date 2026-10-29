/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { McpClientManager } from '@vybestack/llxprt-code-mcp';
import { defaultFeedbackSink } from '@vybestack/llxprt-code-mcp/host/hostServices.js';
import type { HostFeedbackSink } from '@vybestack/llxprt-code-mcp/host/hostServices.js';
import type { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import type { SessionMcpSettingsReads } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { WorkspaceMemoryOwner } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import { McpRuntimeOwner } from '../../mcpRuntimeAssembly.js';
import type {
  McpCapability,
  McpOwnerHandoff,
  McpPolicyHandoff,
  McpRuntimeAcquisition,
  McpTrustHandoff,
} from '../../mcp-runtime-construction.js';

type Supplied<Handoff> = OwnerOf<Extract<Handoff, { kind: 'supplied' }>>;

type OwnerOf<Handoff> = Handoff extends { readonly owner: infer Owner }
  ? Owner
  : never;

/** A supplied owner with who releases it; omitted ownership is per field. */
export interface McpRuntimeTestOwner<Owner> {
  readonly owner: Owner;
  readonly ownership?: 'runtime' | 'caller' | 'agent';
}

export interface McpRuntimeTestAcquisition {
  readonly oauth: McpRuntimeAcquisition['oauth'];
  readonly config: McpRuntimeAcquisition['config'];
  readonly managerFactory?: McpRuntimeAcquisition['managerFactory'];
  readonly extensionLoader?: Supplied<McpRuntimeAcquisition['extensionLoader']>;
  readonly policy?: {
    readonly owner: Supplied<McpPolicyHandoff>;
    readonly ownership?: 'runtime' | 'caller';
  };
  readonly lspOwner?: Supplied<McpRuntimeAcquisition['lsp']>;
  readonly lspOwnership?: 'runtime' | 'caller' | 'agent';
  readonly filesystemOwner?: Supplied<McpRuntimeAcquisition['filesystem']>;
  readonly filesystemOwnership?: 'runtime' | 'caller' | 'agent';
  readonly filesystemService?: Supplied<
    McpRuntimeAcquisition['filesystemService']
  >;
  readonly memoryOwner?: McpRuntimeTestOwner<WorkspaceMemoryOwner>;
  readonly definitionOwner?: Supplied<McpRuntimeAcquisition['definitions']>;
  readonly definitionOwnership?: 'runtime' | 'caller' | 'agent';
  readonly trustPort?: Supplied<McpTrustHandoff>;
  readonly trustCleanup?: () => Promise<void>;
  readonly idePort?: Supplied<McpRuntimeAcquisition['ide']>;
}

export interface McpRuntimeTestOperations {
  readonly emitFeedback?: HostFeedbackSink;
  readonly skillOperations?: WorkspaceSkillAssemblyOperations;
  readonly mcpSettings?: SessionMcpSettingsReads;
}

/**
 * A test names the owner and who releases it. `agent` keeps the pre-handoff
 * meaning of an owner MCP builds and releases; an omitted ownership keeps the
 * per-field default the constructor used before these keys were required.
 */
function handoffOf<Owner>(
  owner: Owner | undefined,
  ownership: 'runtime' | 'caller' | 'agent' | undefined,
  fallback: 'runtime' | 'caller',
): McpOwnerHandoff<Owner> {
  if (owner === undefined) return { kind: 'none' };
  return {
    kind: 'supplied',
    owner,
    ownership: ownership === 'agent' ? 'runtime' : (ownership ?? fallback),
  };
}

function capabilityOf<Capability>(
  capability: Capability | undefined,
): McpCapability<Capability> {
  return capability === undefined
    ? { kind: 'none' }
    : { kind: 'supplied', capability };
}

/**
 * The only test code that knows the shape of `McpRuntimeOwner.create`. An
 * omitted member takes the value the constructor applied before every member
 * became a required handoff.
 */
export function createTestMcpRuntime(
  acquisition: McpRuntimeTestAcquisition,
  operations: McpRuntimeTestOperations,
): Promise<McpRuntimeOwner> {
  const policy: McpPolicyHandoff =
    acquisition.policy === undefined
      ? { kind: 'none' }
      : {
          kind: 'supplied',
          owner: acquisition.policy.owner,
          ownership: acquisition.policy.ownership ?? 'caller',
        };
  const trust: McpTrustHandoff =
    acquisition.trustPort === undefined
      ? { kind: 'none' }
      : {
          kind: 'supplied',
          owner: acquisition.trustPort,
          cleanup: acquisition.trustCleanup,
        };
  const memory =
    acquisition.memoryOwner === undefined
      ? { kind: 'none' as const }
      : {
          kind: 'supplied' as const,
          owner: acquisition.memoryOwner.owner,
          ownership:
            acquisition.memoryOwner.ownership === 'agent'
              ? ('runtime' as const)
              : (acquisition.memoryOwner.ownership ?? ('runtime' as const)),
        };
  return McpRuntimeOwner.create(
    {
      oauth: acquisition.oauth,
      config: acquisition.config,
      managerFactory: acquisition.managerFactory ?? McpClientManager,
      extensionLoader: handoffOf(
        acquisition.extensionLoader,
        'caller',
        'caller',
      ),
      policy,
      lsp: handoffOf(acquisition.lspOwner, acquisition.lspOwnership, 'runtime'),
      filesystem: handoffOf(
        acquisition.filesystemOwner,
        acquisition.filesystemOwnership,
        'runtime',
      ),
      filesystemService:
        acquisition.filesystemService === undefined
          ? { kind: 'none' }
          : {
              kind: 'supplied',
              owner: acquisition.filesystemService,
              ownership: 'caller',
            },
      memory,
      definitions: handoffOf(
        acquisition.definitionOwner,
        acquisition.definitionOwnership,
        'runtime',
      ),
      trust,
      ide: handoffOf(acquisition.idePort, 'caller', 'caller'),
    },
    {
      emitFeedback: operations.emitFeedback ?? defaultFeedbackSink,
      skillOperations: capabilityOf(operations.skillOperations),
      mcpSettings: capabilityOf(operations.mcpSettings),
    },
  );
}
