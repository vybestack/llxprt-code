/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Agent } from '@vybestack/llxprt-code-agents';
import {
  buildSettingsRuntime,
  type SessionSettingsOperations,
} from '../runtime/createRuntimeOwnerFeatures.js';
import {
  buildSessionRuntime,
  buildModelRuntime,
  buildShellRuntime,
  buildFilesRuntime,
  buildMemoryRuntime,
  buildHooksRuntime,
  buildMcpRuntime,
  buildAppEventRuntime,
  buildAppRuntime,
  buildApprovalRuntime,
  buildExtensionRuntime,
  type StreamRuntime,
  type StreamRuntimeDeclarationSource,
  type UiRuntimeDeclarationSource,
  type BucketFailoverRuntime,
  type ApprovalState,
  type ExtensionRuntime,
  type AppStateRuntime,
  type McpUiSelection,
} from '../ui/cliUiRuntime.js';
interface UiComposition extends StreamRuntime {
  approval: ApprovalState;
  extensions: ExtensionRuntime;
  app: AppStateRuntime;
}
function buildStreamWorkspaceRuntime(
  source: StreamRuntimeDeclarationSource,
  workspace: Pick<
    Agent,
    | 'hooks'
    | 'workspace'
    | 'memory'
    | 'sessionClient'
    | 'getModel'
    | 'getProvider'
    | 'getEphemeralSetting'
    | 'getEphemeralSettings'
    | 'setEphemeralSetting'
    | 'getActiveProfileName'
    | 'onStats'
    | 'getApprovalMode'
    | 'setApprovalMode'
  > & {
    mcp: McpUiSelection;
  },
  telemetrySettings?: SessionSettingsOperations,
): StreamRuntime {
  return {
    session: buildSessionRuntime(source),
    model: buildModelRuntime(workspace),
    shell: buildShellRuntime(source),
    files: buildFilesRuntime(source, workspace),
    memory: buildMemoryRuntime(source, workspace),
    hooks: buildHooksRuntime(source, workspace.hooks),
    mcp: buildMcpRuntime(source, workspace.mcp),
    settings: buildSettingsRuntime(source, workspace, telemetrySettings),
    events: buildAppEventRuntime(workspace.mcp),
    bucketFailover: {
      resetBuckets: source.resetBuckets?.bind(source),
      resetBucketSession: source.resetBucketSession?.bind(source),
      ensureBucketsAuthenticated:
        source.ensureBucketsAuthenticated?.bind(source),
      readFailoverBuckets: source.readFailoverBuckets?.bind(source),
      readCurrentBucket: source.readCurrentBucket?.bind(source),
    },
    checkpoint: {
      checkpoints: workspace.workspace.checkpoints,
      getCheckpointingEnabled: () => source.getCheckpointingEnabled(),
    },
    sessionLimits: { getMaxSessionTurns: () => source.getMaxSessionTurns() },
    interactive: { isInteractive: () => source.isInteractive() },
    ephemeral: {
      getEphemeralSetting: (key) => workspace.getEphemeralSetting(key),
    },
    projectTempDir: source.projectTempDir,
    projectChatsDir: source.projectChatsDir,
    projectCheckpointsDir: source.projectCheckpointsDir,
    historyFilePath: source.historyFilePath,
    userCommandsDir: source.userCommandsDir,
    projectCommandsDir: source.projectCommandsDir,
  };
}

function buildUiWorkspaceRuntime(
  source: UiRuntimeDeclarationSource,
  workspace: Parameters<typeof buildStreamWorkspaceRuntime>[1] &
    Pick<Agent, 'getApprovalMode' | 'setApprovalMode' | 'ide'> & {
      tools: Pick<Agent['tools'], 'get'>;
    },
  bucketFailover?: BucketFailoverRuntime,
  telemetrySettings?: SessionSettingsOperations,
): UiComposition {
  return {
    ...buildStreamWorkspaceRuntime(source, workspace, telemetrySettings),
    ...(bucketFailover ? { bucketFailover } : {}),
    approval: buildApprovalRuntime(source, workspace),
    extensions: buildExtensionRuntime(source),
    app: buildAppRuntime(source, workspace),
  };
}

export function buildUiRuntimeFromSource(
  source: UiRuntimeDeclarationSource,
  agent: Pick<
    Agent,
    | 'ide'
    | 'getApprovalMode'
    | 'setApprovalMode'
    | 'sessionClient'
    | 'hooks'
    | 'workspace'
    | 'memory'
    | 'getModel'
    | 'getProvider'
    | 'getEphemeralSetting'
    | 'getEphemeralSettings'
    | 'setEphemeralSetting'
    | 'getActiveProfileName'
    | 'onStats'
  > & {
    tools: Pick<Agent['tools'], 'get'>;
    mcp: McpUiSelection;
  },
  bucketFailover?: BucketFailoverRuntime,
  telemetrySettings?: SessionSettingsOperations,
): UiComposition {
  return buildUiWorkspaceRuntime(
    source,
    agent,
    bucketFailover,
    telemetrySettings,
  );
}
