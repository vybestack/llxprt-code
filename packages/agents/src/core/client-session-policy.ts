import type { ProviderRequestDiagnostics } from '@vybestack/llxprt-code-core/runtime/providerRequestDiagnostics.js';
import { LoopDetectionService } from '@vybestack/llxprt-code-core/services/loopDetectionService.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import type {
  PrepareProviderInvocation,
  ReadonlySettingsSnapshot,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { CreateChatSessionDeps } from './ChatSessionFactory.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  ProfileDefinitionReads,
  SubagentDefinitionReads,
} from '@vybestack/llxprt-code-core';

import type { ToolGovernance } from '@vybestack/llxprt-code-tools';
import { ClientToolSelection } from './client-tool-selection.js';

export class ClientSessionPolicy extends ClientToolSelection {
  protected readonly MAX_TURNS = 100;
  protected requestDiagnostics: ProviderRequestDiagnostics | undefined;
  private telemetryRoot: RootTelemetry | undefined;

  bindTelemetry(
    root: RootTelemetry,
    diagnostics?: ProviderRequestDiagnostics,
  ): void {
    this.telemetryRoot = root;
    this.requestDiagnostics = diagnostics;
  }

  protected requireTelemetry(): RootTelemetry {
    if (this.telemetryRoot === undefined)
      throw new Error('Client requires explicit session telemetry');
    return this.telemetryRoot;
  }

  protected prepareProviderInvocation: PrepareProviderInvocation | undefined;
  protected profileDefinitions:
    | Pick<ProfileDefinitionReads, 'loadProfile'>
    | undefined;
  protected subagentDefinitions:
    | Pick<SubagentDefinitionReads, 'listSubagents'>
    | undefined;

  protected chatPolicyInputs(): Pick<
    CreateChatSessionDeps,
    | 'telemetry'
    | 'requestDiagnostics'
    | 'readRuntimeSettings'
    | 'readToolGovernance'
    | 'profileDefinitions'
    | 'subagentDefinitions'
  > {
    return {
      telemetry: this.requireTelemetry(),
      requestDiagnostics: this.requestDiagnostics,
      readRuntimeSettings: this.readRuntimeSettings,
      readToolGovernance: this.readToolGovernance,
      profileDefinitions: this.profileDefinitions,
      subagentDefinitions: this.subagentDefinitions,
    };
  }

  bindProviderInvocation(prepare: PrepareProviderInvocation): void {
    this.prepareProviderInvocation = prepare;
  }

  bindWorkspaceDefinitions(
    profiles: Pick<ProfileDefinitionReads, 'loadProfile'>,
    subagents: Pick<SubagentDefinitionReads, 'listSubagents'>,
  ): void {
    this.profileDefinitions = profiles;
    this.subagentDefinitions = subagents;
  }
  protected readRuntimeSettings: (() => ReadonlySettingsSnapshot) | undefined;
  protected readToolGovernance: (() => ToolGovernance) | undefined;

  protected requireRuntimeSettings(): ReadonlySettingsSnapshot {
    if (this.readRuntimeSettings === undefined)
      throw new Error('Client requires explicit session runtime settings');
    return this.readRuntimeSettings();
  }

  protected readonly readLoopPolicy = () =>
    this.requireRuntimeSettings().loopDetection ?? {};

  protected createLoopDetector(config: Config): LoopDetectionService {
    return new LoopDetectionService(config, this.readLoopPolicy, () =>
      this.requireTelemetry(),
    );
  }

  bindRuntimeSettings(
    read: () => ReadonlySettingsSnapshot,
    readGovernance: () => ToolGovernance,
  ): void {
    this.readRuntimeSettings = read;
    this.readToolGovernance = readGovernance;
  }
}
