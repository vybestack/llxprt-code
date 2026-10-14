/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ChildAgentLaunch } from '../api/child-agent-assembly.js';
import { assembleChildAgent } from '../api/agentRuntimeAssembly.js';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import type { InteractiveAuthPromptOperation } from '@vybestack/llxprt-code-core/runtime/contracts/InteractiveAuthPrompt.js';
import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';

import type { WorkspaceTrustControlPort } from '@vybestack/llxprt-code-core';

import type { InstructionReadOperations } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { randomUUID } from 'node:crypto';
import type { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type {
  ProfileDefinitionReads,
  SubagentDefinitionReads,
} from '@vybestack/llxprt-code-core';
import {
  isLoadBalancerProfile,
  type Profile,
} from '@vybestack/llxprt-code-settings';
import {
  resolveRuntimeProfile,
  type RuntimeProfileResolution,
} from './subagentProfileResolution.js';
import { getStringSetting } from './subagentSettingsAccess.js';
import { normalizeDefaultToolSet } from './subagentSettingsPopulation.js';
import type { SubagentConfig } from '@vybestack/llxprt-code-core/config/types.js';
import { SubAgentScope } from './subagent.js';
import type {
  ModelConfig,
  PromptConfig,
  RunConfig,
  ToolConfig,
  OutputConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { buildResolvedRunConfig } from './subagent-run-policy.js';
import type { SubagentRunPolicy } from '@vybestack/llxprt-code-core/session/session-settings-policies.js';

import {
  createAgentRuntimeState,
  type AgentRuntimeState,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { AgentRuntimeFactoryBindings } from '@vybestack/llxprt-code-core';

import {
  loadAgentRuntime,
  type AgentRuntimeLoaderOptions,
  type AgentRuntimeLoaderResult,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';

const LOAD_BALANCER_PROVIDER_NAME = 'load-balancer';

type RuntimeLoader = (
  options: AgentRuntimeLoaderOptions,
) => Promise<AgentRuntimeLoaderResult>;

type ScopeFactory = typeof SubAgentScope.create;

const createAbortError = (message: string): Error => {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
};

export const DEFAULT_DISABLED_TOOLS = [] as const;

export interface SubagentLaunchRequest {
  name: string;
  runConfig?: RunConfig;
  behaviourPrompts?: string[];
  toolConfig?: ToolConfig;
  outputConfig?: OutputConfig;
}

export interface SubagentLaunchResult {
  agentId: string;
  scope: SubAgentScope;
  dispose: () => Promise<void>;
  prompt: PromptConfig;
  profile: Profile;
  config: SubagentConfig;
  runtime: AgentRuntimeLoaderResult;
}

export interface SubagentOrchestratorOptions {
  readonly credentialAuthority?: CredentialAuthority;
  readonly requestInteractiveAuth?: InteractiveAuthPromptOperation;
  instructions: InstructionReadOperations;
  toolRegistry?: ToolSelection;
  readMcpInstructions: () => string | undefined;
  workspacePaths: WorkspacePathOperations;
  subagentManager: Pick<
    SubagentDefinitionReads,
    'loadSubagent' | 'listSubagents'
  >;
  profileManager: Pick<ProfileDefinitionReads, 'loadProfile'>;
  foregroundConfig: Config;
  readonly hookOwner?: SessionHookOwner;
  readonly workspaceTrust?: WorkspaceTrustControlPort;
  createChildSettings: () => SettingsService;
  readonly telemetry?: RootTelemetry;
  readRunPolicy: () => SubagentRunPolicy;
  runtimeFactoryBindings?: AgentRuntimeFactoryBindings;
  runtimeLoader?: RuntimeLoader;
  scopeFactory?: ScopeFactory;
  idFactory?: () => string;
  /**
   * Required session/runtime MessageBus threaded into the SubAgentScope so
   * non-interactive subagent tool execution can satisfy
   * the child scheduler owner’s explicit MessageBus dependency (Issue #2312).
   */
  messageBus: MessageBus;
}

export class SubagentOrchestrator {
  private readonly runtimeLoader: RuntimeLoader;
  private readonly scopeFactory: ScopeFactory;
  private readonly idFactory: () => string;
  private readonly defaultDisabledTools = normalizeDefaultToolSet(
    DEFAULT_DISABLED_TOOLS,
  );

  constructor(private readonly options: SubagentOrchestratorOptions) {
    this.runtimeLoader = options.runtimeLoader ?? loadAgentRuntime;
    this.scopeFactory =
      options.scopeFactory ?? SubAgentScope.create.bind(SubAgentScope);
    this.idFactory = options.idFactory ?? randomUUID;
  }

  /**
   * Launches a subagent by name, returning the created {@link SubAgentScope}
   * and associated agent metadata.
   */
  private resolveRunConfig(
    profile: Profile,
    custom: RunConfig | undefined,
  ): RunConfig {
    return buildResolvedRunConfig(
      profile,
      custom,
      this.options.readRunPolicy(),
    );
  }

  async launch(
    request: SubagentLaunchRequest,
    signal?: AbortSignal,
  ): Promise<SubagentLaunchResult> {
    this.throwIfAborted(signal, 'Subagent launch aborted before start.');
    const subagent = await this.loadSubagentConfig(request.name);
    this.throwIfAborted(
      signal,
      'Subagent launch aborted while loading config.',
    );
    const profile = await this.options.profileManager.loadProfile(
      subagent.profile,
    );
    this.throwIfAborted(
      signal,
      'Subagent launch aborted while loading profile.',
    );
    const runtimeProfile = await resolveRuntimeProfile(
      profile,
      this.options.profileManager,
    );
    this.throwIfAborted(
      signal,
      'Subagent launch aborted while resolving runtime profile.',
    );

    const promptConfig = this.buildPromptConfig(
      subagent.systemPrompt,
      request.behaviourPrompts,
    );
    const modelConfig = this.buildModelConfig(
      SubagentOrchestrator.getRuntimeStateProfile(runtimeProfile),
    );
    const runConfig = this.resolveRunConfig(profile, request.runConfig);
    this.throwIfAborted(
      signal,
      'Subagent launch aborted before runtime assembly.',
    );

    const authority = this.options.credentialAuthority;
    if (authority === undefined)
      throw new Error('Child assembly requires captured credential authority');
    return assembleChildAgent(
      this.createLaunchData(
        subagent,
        runtimeProfile,
        profile,
        modelConfig,
        promptConfig,
        runConfig,
        request,
        signal,
      ),
      authority,
      this.options.messageBus,
      this.options.requestInteractiveAuth,
      this.options.profileManager,
      this.options.subagentManager,
      this.options.telemetry,
      this.options.createChildSettings,
      this.options.foregroundConfig,
      this.options.instructions,
      this.options.workspacePaths,
      this.options.readMcpInstructions,
      this.options.workspaceTrust,
      this.options.toolRegistry,
      this.options.hookOwner,
      this.options.runtimeFactoryBindings?.agentClientFactory,
      this.runtimeLoader,
      this.scopeFactory,
    );
  }

  private createLaunchData(
    subagent: SubagentConfig,
    runtimeProfile: RuntimeProfileResolution,
    profile: Profile,
    modelConfig: ModelConfig,
    promptConfig: PromptConfig,
    runConfig: RunConfig,
    request: SubagentLaunchRequest,
    signal: AbortSignal | undefined,
  ): ChildAgentLaunch {
    const agentRuntimeId = this.createRuntimeId(subagent.name);
    const activationProfile =
      SubagentOrchestrator.getActivationProfile(runtimeProfile);
    const runtimeStateProfile =
      SubagentOrchestrator.getRuntimeStateProfile(runtimeProfile);
    return {
      subagent,
      activationProfile,
      runtimeStateProfile,
      effectiveProfile: runtimeProfile.effectiveProfile,
      profile,
      model: modelConfig,
      prompt: promptConfig,
      run: runConfig,
      request,
      state: this.createRuntimeState(
        runtimeStateProfile,
        modelConfig,
        agentRuntimeId,
        subagent.name,
      ),
      runtimeId: agentRuntimeId,
      disabledTools: this.defaultDisabledTools,
      signal,
    };
  }

  private throwIfAborted(signal: AbortSignal | undefined, message: string) {
    if (signal?.aborted === true) {
      throw createAbortError(message);
    }
  }

  private async loadSubagentConfig(name: string): Promise<SubagentConfig> {
    if (!name.trim()) {
      throw new Error('Subagent name is required.');
    }
    try {
      return await this.options.subagentManager.loadSubagent(name);
    } catch (error) {
      if (error instanceof Error) {
        // Check if this is a "subagent not found" error
        if (error.message.includes(`'${name}' not found`)) {
          throw new Error(
            `Unable to load subagent '${name}': Subagent not found. Use the list_subagents tool to discover available subagents before calling the task tool.`,
          );
        }
        throw new Error(`Unable to load subagent '${name}': ${error.message}`);
      }
      throw error;
    }
  }

  private buildPromptConfig(
    basePrompt: string,
    additions?: string[],
  ): PromptConfig {
    const trimmedBase = basePrompt.trim();
    const trimmedAdditions = (additions ?? [])
      .map((part) => part.trim())
      .filter((part): part is string => part.length > 0);

    const promptSections: string[] = [];

    if (trimmedBase) {
      promptSections.push(trimmedBase);
    }

    if (trimmedAdditions.length > 0) {
      const numberedInstructions = trimmedAdditions
        .map((instruction, index) => `(${index + 1}) ${instruction}`)
        .join('\n');
      promptSections.push(
        [
          '--- CURRENT TASK DIRECTIVES ---',
          'Follow these instructions precisely for this run. They take precedence over any default behaviours.',
          numberedInstructions,
        ].join('\n'),
      );
    }

    const merged = promptSections.join('\n\n');

    return {
      systemPrompt: merged,
    };
  }

  private buildModelConfig(profile: Profile): ModelConfig {
    return {
      model: profile.model,
      temp: profile.modelParams.temperature ?? 0.7,
      top_p: profile.modelParams.top_p ?? 1,
    };
  }

  private static getActivationProfile(
    runtimeProfile: RuntimeProfileResolution,
  ): Profile {
    return isLoadBalancerProfile(runtimeProfile.effectiveProfile)
      ? runtimeProfile.effectiveProfile
      : runtimeProfile.primaryProfile;
  }

  private static getRuntimeStateProfile(
    runtimeProfile: RuntimeProfileResolution,
  ): Profile {
    if (!isLoadBalancerProfile(runtimeProfile.effectiveProfile)) {
      return runtimeProfile.primaryProfile;
    }
    // Keep load-balancer profile metadata/settings while stamping runtime
    // provider/model to the registered load-balancer provider identity.
    return {
      ...runtimeProfile.effectiveProfile,
      ephemeralSettings: {
        ...runtimeProfile.effectiveProfile.ephemeralSettings,
      },
      modelParams: { ...runtimeProfile.effectiveProfile.modelParams },
      provider: LOAD_BALANCER_PROVIDER_NAME,
      model: LOAD_BALANCER_PROVIDER_NAME,
    };
  }

  private baseSessionId(): string {
    const { foregroundConfig } = this.options;
    if (typeof foregroundConfig.getSessionId === 'function') {
      const session = foregroundConfig.getSessionId();
      if (session) {
        return String(session);
      }
    }
    return 'llxprt-session';
  }

  private createRuntimeId(subagentName: string): string {
    const suffix = this.idFactory().slice(0, 8);
    return `${this.baseSessionId()}#${subagentName}#${suffix}`;
  }

  private createRuntimeState(
    profile: Profile,
    modelConfig: ModelConfig,
    agentRuntimeId: string,
    subagentName: string,
  ): AgentRuntimeState {
    const sessionId = `${this.baseSessionId()}::${agentRuntimeId}`;
    const baseUrl = getStringSetting(profile.ephemeralSettings, ['base-url']);

    return createAgentRuntimeState({
      runtimeId: agentRuntimeId,
      provider: profile.provider,
      model: modelConfig.model,
      baseUrl,
      proxyUrl: getStringSetting(profile.ephemeralSettings, [
        'proxy',
        'proxy-url',
      ]),
      modelParams: {
        temperature: modelConfig.temp,
        topP: modelConfig.top_p,
        maxTokens: profile.modelParams.max_tokens ?? undefined,
      },
      sessionId,
      // The foreground agent's runtime id. `resolveRuntimeId` defaults a
      // runtime's id to its session id when no explicit id is supplied
      // (see runtimeStateFactory), which is how the foreground runtime is
      // built, so this is that runtime's id and not merely a session key.
      // The orchestrator is reached through the tool framework, which does
      // not carry the caller's runtime context; if that changes, pass the
      // parent runtime id in explicitly rather than re-deriving it here.
      parentRuntimeId: this.baseSessionId(),
      subagentName,
    });
  }
}
