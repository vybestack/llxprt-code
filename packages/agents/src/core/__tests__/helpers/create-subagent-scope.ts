/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type {
  EnvironmentContextLoader,
  ModelConfig,
  OutputConfig,
  PromptConfig,
  RunConfig,
  ToolConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import type {
  AgentRuntimeContext,
  ReadonlySettingsSnapshot,
  ToolRegistryView,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { AdmittedModelParameters } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import type { ProviderRetryOperations } from '@vybestack/llxprt-code-core/runtime/contracts/ProviderRetryOperations.js';
import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { InstructionReadOperations } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import { SubAgentScope, type SubAgentDependencies } from '../../subagent.js';

export interface SubAgentLaunchInput {
  readonly name: string;
  readonly prompt: PromptConfig;
  readonly model: ModelConfig;
  readonly run: RunConfig;
  readonly toolConfig: ToolConfig | undefined;
  readonly outputConfig: OutputConfig | undefined;
  readonly parentSignal?: AbortSignal;
}

export interface SubAgentRuntimeInput {
  readonly foregroundConfig: Config;
  readonly admittedRuntime: AgentRuntimeContext | undefined;
  readonly contentGenerator: ContentGenerator | undefined;
  readonly telemetry: RootTelemetry | undefined;
  readonly toolRegistry: ToolSelection | undefined;
  readonly toolsView: ToolRegistryView | undefined;
  readonly settingsSnapshot: ReadonlySettingsSnapshot | undefined;
}

export interface SubAgentOperationPorts {
  readonly instructions: InstructionReadOperations;
  readonly workspacePaths: WorkspacePathOperations;
  readonly readMcpInstructions: () => string | undefined;
  readonly messageBus: MessageBus;
  readonly loadEnvironmentContext: EnvironmentContextLoader | undefined;
  readonly readApprovalMode: (() => ApprovalMode) | undefined;
  readonly admitModelParameters: (() => AdmittedModelParameters) | undefined;
  readonly providerFiles: object | undefined;
  readonly hooks: HookExecutionOwner | undefined;
  readonly tryBucketFailover: ProviderRetryOperations['tryBucketFailover'];
  readonly readCurrentBucket: ProviderRetryOperations['readCurrentBucket'];
  readonly dependencies?: SubAgentDependencies;
}

export function createSubagentScope(
  launch: SubAgentLaunchInput,
  runtime: SubAgentRuntimeInput,
  operations: SubAgentOperationPorts,
): Promise<SubAgentScope> {
  return SubAgentScope.create(
    launch.name,
    runtime.foregroundConfig,
    launch.prompt,
    launch.model,
    launch.run,
    launch.toolConfig,
    launch.outputConfig,
    runtime.admittedRuntime,
    runtime.contentGenerator,
    runtime.telemetry,
    runtime.toolRegistry,
    runtime.toolsView,
    operations.instructions,
    operations.workspacePaths,
    operations.readMcpInstructions,
    operations.messageBus,
    runtime.settingsSnapshot,
    operations.loadEnvironmentContext,
    operations.readApprovalMode,
    operations.admitModelParameters,
    operations.providerFiles,
    operations.hooks,
    operations.tryBucketFailover,
    operations.readCurrentBucket,
    launch.parentSignal,
    operations.dependencies,
  );
}
