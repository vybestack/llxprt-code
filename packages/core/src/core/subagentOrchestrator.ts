/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type { Config } from '../config/config.js';
import type { SubagentManager } from '../config/subagentManager.js';
import type { ProfileManager } from '../config/profileManager.js';
import type { SubagentConfig } from '../config/types.js';
import type { Profile } from '../types/modelParams.js';
import {
  SubAgentScope,
  type ModelConfig,
  type PromptConfig,
  type RunConfig,
  type ToolConfig,
  type OutputConfig,
} from './subagent.js';
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import {
  createAgentRuntimeState,
  type AgentRuntimeState,
} from '../runtime/AgentRuntimeState.js';
import {
  createProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '../runtime/providerRuntimeContext.js';
import {
  loadAgentRuntime,
  type AgentRuntimeLoaderOptions,
  type AgentRuntimeLoaderResult,
} from '../runtime/AgentRuntimeLoader.js';
import type { ReadonlySettingsSnapshot } from '../runtime/AgentRuntimeContext.js';
import { SettingsService } from '../settings/SettingsService.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import { AuthType, type ContentGeneratorConfig } from './contentGenerator.js';
import { getEnvironmentContext } from '../utils/environmentContext.js';

type RuntimeLoader = (
  options: AgentRuntimeLoaderOptions,
) => Promise<AgentRuntimeLoaderResult>;

type ScopeFactory = typeof SubAgentScope.create;

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
  subagentManager: SubagentManager;
  profileManager: ProfileManager;
  foregroundConfig: Config;
  runtimeLoader?: RuntimeLoader;
  scopeFactory?: ScopeFactory;
  idFactory?: () => string;
}

/**
 * Light-weight orchestrator responsible for resolving subagent configuration,
 * building isolated runtime bundles, and launching {@link SubAgentScope} instances.
 *
 * @plan PLAN-20251029-SUBAGENTORCHESTRATION
 * @requirement REQ-SUBAGENT-ORCH-001, REQ-SUBAGENT-ORCH-002
 */
export class SubagentOrchestrator {
  private readonly runtimeLoader: RuntimeLoader;
  private readonly scopeFactory: ScopeFactory;
  private readonly idFactory: () => string;

  constructor(private readonly options: SubagentOrchestratorOptions) {
    this.runtimeLoader = options.runtimeLoader ?? loadAgentRuntime;
    this.scopeFactory =
      options.scopeFactory ??
      (SubAgentScope.create.bind(SubAgentScope) as ScopeFactory);
    this.idFactory = options.idFactory ?? randomUUID;
  }

  /**
   * Launches a subagent by name, returning the created {@link SubAgentScope}
   * and associated agent metadata.
   */
  async launch(request: SubagentLaunchRequest): Promise<SubagentLaunchResult> {
    const subagent = await this.loadSubagentConfig(request.name);
    const profile = await this.options.profileManager.loadProfile(
      subagent.profile,
    );

    const promptConfig = this.buildPromptConfig(
      subagent.systemPrompt,
      request.behaviourPrompts,
    );
    const modelConfig = this.buildModelConfig(profile);
    const runConfig = this.buildRunConfig(profile, request.runConfig);

    const agentRuntimeId = this.createRuntimeId(subagent.name);
    const runtimeResult = await this.createRuntimeBundle({
      subagent,
      profile,
      modelConfig,
      agentRuntimeId,
    });

    const scope = await this.scopeFactory(
      subagent.name,
      this.options.foregroundConfig,
      promptConfig,
      modelConfig,
      runConfig,
      request.toolConfig,
      request.outputConfig,
      {
        runtimeBundle: runtimeResult,
        environmentContextLoader: async (_runtime) =>
          getEnvironmentContext(this.options.foregroundConfig),
      },
    );

    const agentId =
      typeof scope.getAgentId === 'function'
        ? scope.getAgentId()
        : `${subagent.name}-${agentRuntimeId}`;

    return {
      agentId,
      scope,
      prompt: promptConfig,
      profile,
      config: subagent,
      runtime: runtimeResult,
      dispose: async () => {
        const history = runtimeResult.history ?? scope.runtimeContext.history;
        if (history && typeof history.clear === 'function') {
          history.clear();
        }
      },
    };
  }

  private async loadSubagentConfig(name: string): Promise<SubagentConfig> {
    if (!name?.trim()) {
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
    const trimmedBase = basePrompt?.trim();
    const trimmedAdditions = (additions ?? [])
      .map((part) => part?.trim())
      .filter((part) => part && part.length > 0);

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
      temp: (profile.modelParams.temperature as number | undefined) ?? 0.7,
      top_p: (profile.modelParams.top_p as number | undefined) ?? 1,
    };
  }

  private buildRunConfig(profile: Profile, custom?: RunConfig): RunConfig {
    const profileMaxTime = this.getNumberSetting(profile.ephemeralSettings, [
      'subagent.max_time_minutes',
      'max_time_minutes',
    ]);

    const runConfig: RunConfig = {
      max_time_minutes:
        custom?.max_time_minutes ??
        (profileMaxTime !== undefined
          ? profileMaxTime
          : Number.POSITIVE_INFINITY),
    };

    const profileMaxTurns = this.getNumberSetting(profile.ephemeralSettings, [
      'maxTurnsPerPrompt',
    ]);

    const maxTurns =
      custom?.max_turns !== undefined ? custom.max_turns : profileMaxTurns;

    if (maxTurns !== undefined && maxTurns > 0) {
      runConfig.max_turns = Math.floor(maxTurns);
    }

    return runConfig;
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

  private buildContentGeneratorConfig(
    profile: Profile,
    modelConfig: ModelConfig,
  ): ContentGeneratorConfig {
    const authKey = profile.ephemeralSettings['auth-key'];
    const proxy = this.getStringSetting(profile.ephemeralSettings, [
      'proxy',
      'proxy-url',
    ]);

    let authType: AuthType | undefined;
    if (authKey) {
      authType = profile.provider.includes('gemini')
        ? AuthType.USE_GEMINI
        : AuthType.API_KEY;
    } else {
      authType = AuthType.USE_PROVIDER;
    }

    return {
      model: modelConfig.model,
      authType,
      apiKey: typeof authKey === 'string' ? authKey : undefined,
      proxy,
    };
  }

  private createSettingsSnapshot(profile: Profile): ReadonlySettingsSnapshot {
    const allowed = this.getStringArraySetting(profile.ephemeralSettings, [
      'tools.allowed',
      'tools_allowed',
    ]);
    const disabled = this.getStringArraySetting(profile.ephemeralSettings, [
      'tools.disabled',
      'disabled-tools',
    ]);

    return {
      compressionThreshold: this.getNumberSetting(profile.ephemeralSettings, [
        'compression-threshold',
      ]),
      contextLimit: this.getNumberSetting(profile.ephemeralSettings, [
        'context-limit',
      ]),
      preserveThreshold: this.getNumberSetting(profile.ephemeralSettings, [
        'compression-preserve-threshold',
      ]),
      toolFormatOverride: this.getStringSetting(profile.ephemeralSettings, [
        'tool-format',
      ]),
      tools: {
        allowed,
        disabled,
      },
    };
  }

  private populateSettingsService(
    service: SettingsService,
    profile: Profile,
  ): void {
    const provider = profile.provider;
    service.set('activeProvider', provider);
    service.set(`providers.${provider}.model`, profile.model);

    const temperature = profile.modelParams.temperature;
    if (typeof temperature === 'number') {
      service.set(`providers.${provider}.temperature`, temperature);
    }

    const maxTokens = profile.modelParams.max_tokens;
    if (typeof maxTokens === 'number') {
      service.set(`providers.${provider}.maxTokens`, maxTokens);
    }

    const baseUrl = this.getStringSetting(profile.ephemeralSettings, [
      'base-url',
    ]);
    if (baseUrl) {
      service.set(`providers.${provider}.baseUrl`, baseUrl);
    }

    const authKey = profile.ephemeralSettings['auth-key'];
    if (typeof authKey === 'string') {
      service.set('auth-key', authKey);
      service.set(`providers.${provider}.apiKey`, authKey);
    }
    const authKeyfile = this.getStringSetting(profile.ephemeralSettings, [
      'auth-keyfile',
    ]);
    if (authKeyfile) {
      const expandedKeyfile = authKeyfile.replace(/^~(?=$|[\\/])/, homedir());
      service.set('auth-keyfile', expandedKeyfile);
      service.set(`providers.${provider}.apiKeyfile`, expandedKeyfile);
      if (!service.get(`providers.${provider}.apiKey`)) {
        try {
          const resolvedPath = path.resolve(expandedKeyfile);
          if (fs.existsSync(resolvedPath)) {
            const content = fs.readFileSync(resolvedPath, 'utf8').trim();
            if (content) {
              service.set(`providers.${provider}.apiKey`, content);
            }
          }
        } catch (error) {
          console.warn(
            `SubagentOrchestrator: unable to read auth key file '${authKeyfile}': ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }

    const contextLimit = this.getNumberSetting(profile.ephemeralSettings, [
      'context-limit',
    ]);
    if (contextLimit !== undefined) {
      service.set('context-limit', contextLimit);
    }

    const compressionThreshold = this.getNumberSetting(
      profile.ephemeralSettings,
      ['compression-threshold'],
    );
    if (compressionThreshold !== undefined) {
      service.set('compression-threshold', compressionThreshold);
    }

    const preserveThreshold = this.getNumberSetting(profile.ephemeralSettings, [
      'compression-preserve-threshold',
    ]);
    if (preserveThreshold !== undefined) {
      service.set('compression-preserve-threshold', preserveThreshold);
    }

    const toolFormat = this.getStringSetting(profile.ephemeralSettings, [
      'tool-format',
    ]);
    if (toolFormat) {
      service.set('tool-format-override', toolFormat);
    }

    const allowed = this.getStringArraySetting(profile.ephemeralSettings, [
      'tools.allowed',
      'tools_allowed',
    ]);
    if (allowed) {
      service.set('tools.allowed', allowed);
    }

    const disabled = this.getStringArraySetting(profile.ephemeralSettings, [
      'tools.disabled',
      'disabled-tools',
    ]);
    if (disabled) {
      service.set('tools.disabled', disabled);
    }
  }

  private getNumberSetting(
    settings: Profile['ephemeralSettings'],
    keys: string[],
  ): number | undefined {
    for (const key of keys) {
      const value = this.getSetting(settings, key);
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return undefined;
  }

  private getStringSetting(
    settings: Profile['ephemeralSettings'],
    keys: string[],
  ): string | undefined {
    for (const key of keys) {
      const value = this.getSetting(settings, key);
      if (typeof value === 'string' && value.trim().length > 0) {
        return value;
      }
    }
    return undefined;
  }

  private getStringArraySetting(
    settings: Profile['ephemeralSettings'],
    keys: string[],
  ): string[] | undefined {
    for (const key of keys) {
      const value = this.getSetting(settings, key);
      if (Array.isArray(value)) {
        return value.map(String);
      }
    }
    return undefined;
  }

  private getSetting(
    settings: Profile['ephemeralSettings'],
    key: string,
  ): unknown {
    return (settings as Record<string, unknown>)[key];
  }

  private createRuntimeState(
    profile: Profile,
    modelConfig: ModelConfig,
    agentRuntimeId: string,
  ): AgentRuntimeState {
    const authKey = profile.ephemeralSettings['auth-key'];
    const authType =
      typeof authKey === 'string'
        ? profile.provider.includes('gemini')
          ? AuthType.USE_GEMINI
          : AuthType.API_KEY
        : AuthType.USE_PROVIDER;

    const sessionId = `${this.baseSessionId()}::${agentRuntimeId}`;

    return createAgentRuntimeState({
      runtimeId: agentRuntimeId,
      provider: profile.provider,
      model: modelConfig.model,
      authType,
      authPayload:
        typeof authKey === 'string' ? { apiKey: authKey } : undefined,
      proxyUrl: this.getStringSetting(profile.ephemeralSettings, [
        'proxy',
        'proxy-url',
      ]),
      modelParams: {
        temperature: modelConfig.temp,
        topP: modelConfig.top_p,
        maxTokens:
          (profile.modelParams.max_tokens as number | undefined) ?? undefined,
      },
      sessionId,
    });
  }

  private async createRuntimeBundle(params: {
    subagent: SubagentConfig;
    profile: Profile;
    modelConfig: ModelConfig;
    agentRuntimeId: string;
  }): Promise<AgentRuntimeLoaderResult> {
    const { profile, modelConfig, agentRuntimeId, subagent } = params;

    const runtimeState = this.createRuntimeState(
      profile,
      modelConfig,
      agentRuntimeId,
    );
    const settingsService = new SettingsService();
    this.populateSettingsService(settingsService, profile);

    const providerRuntime: ProviderRuntimeContext =
      createProviderRuntimeContext({
        settingsService,
        config: this.options.foregroundConfig,
        runtimeId: agentRuntimeId,
        metadata: {
          source: 'SubagentOrchestrator',
          subagent: subagent.name,
        },
      });

    const settingsSnapshot = this.createSettingsSnapshot(profile);
    const contentGeneratorConfig = this.buildContentGeneratorConfig(
      profile,
      modelConfig,
    );
    const providerManager =
      typeof this.options.foregroundConfig.getProviderManager === 'function'
        ? this.options.foregroundConfig.getProviderManager()
        : undefined;
    if (providerManager) {
      contentGeneratorConfig.providerManager = providerManager;
    }

    const toolRegistry: ToolRegistry | undefined =
      typeof this.options.foregroundConfig.getToolRegistry === 'function'
        ? this.options.foregroundConfig.getToolRegistry()
        : undefined;

    const loaderOptions: AgentRuntimeLoaderOptions = {
      profile: {
        config: this.options.foregroundConfig,
        state: runtimeState,
        settings: settingsSnapshot,
        providerRuntime,
        contentGeneratorConfig,
        toolRegistry,
        providerManager,
      },
    };

    return this.runtimeLoader(loaderOptions);
  }
}
