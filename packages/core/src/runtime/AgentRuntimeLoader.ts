/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { HistoryService } from '../services/history/HistoryService.js';
import type { Config } from '../config/config.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import type { ProviderManager } from '../providers/ProviderManager.js';
import type { IProviderManager } from '../providers/IProviderManager.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from './runtimeAdapters.js';
import type {
  AgentRuntimeContext,
  AgentRuntimeProviderAdapter,
  AgentRuntimeTelemetryAdapter,
  ToolRegistryView,
  ReadonlySettingsSnapshot,
} from './AgentRuntimeContext.js';
import type { AgentRuntimeState } from './AgentRuntimeState.js';
import { createAgentRuntimeContext } from './createAgentRuntimeContext.js';
import type { ProviderRuntimeContext } from './providerRuntimeContext.js';
import {
  createContentGenerator,
  type ContentGenerator,
  type ContentGeneratorConfig,
} from '../core/contentGenerator.js';

export interface AgentRuntimeProfileSnapshot {
  config: Config;
  state: AgentRuntimeState;
  settings: ReadonlySettingsSnapshot;
  providerRuntime: ProviderRuntimeContext;
  contentGeneratorConfig?: ContentGeneratorConfig;
  toolRegistry?: ToolRegistry;
  providerManager?: ProviderManager | IProviderManager;
}

export interface AgentRuntimeLoaderOverrides {
  providerAdapter?: AgentRuntimeProviderAdapter;
  telemetryAdapter?: AgentRuntimeTelemetryAdapter;
  toolsView?: ToolRegistryView;
  historyService?: HistoryService;
  contentGenerator?: ContentGenerator;
  contentGeneratorFactory?: ContentGeneratorFactory;
}

export interface AgentRuntimeLoaderOptions {
  profile: AgentRuntimeProfileSnapshot;
  overrides?: AgentRuntimeLoaderOverrides;
}

export interface AgentRuntimeLoaderResult {
  runtimeContext: AgentRuntimeContext;
  history: HistoryService;
  providerAdapter: AgentRuntimeProviderAdapter;
  telemetryAdapter: AgentRuntimeTelemetryAdapter;
  toolsView: ToolRegistryView;
  contentGenerator: ContentGenerator;
}

export type ContentGeneratorFactory = (
  config: ContentGeneratorConfig,
  context: Config,
  sessionId: string,
) => Promise<ContentGenerator>;

const defaultContentGeneratorFactory: ContentGeneratorFactory = (
  contentConfig,
  config,
  sessionId,
) => createContentGenerator(contentConfig, config, sessionId);

export async function loadAgentRuntime(
  options: AgentRuntimeLoaderOptions,
): Promise<AgentRuntimeLoaderResult> {
  const { profile, overrides = {} } = options;
  if (!profile) {
    throw new Error('AgentRuntimeLoader requires a profile option.');
  }

  const history = overrides.historyService ?? new HistoryService();

  const providerAdapter: AgentRuntimeProviderAdapter =
    overrides.providerAdapter ??
    createProviderAdapterFromManager(
      profile.providerManager ?? profile.config.getProviderManager?.(),
    );

  const telemetryAdapter: AgentRuntimeTelemetryAdapter =
    overrides.telemetryAdapter ??
    createTelemetryAdapterFromConfig(profile.config);

  const toolsView: ToolRegistryView =
    overrides.toolsView ??
    createToolRegistryViewFromRegistry(
      profile.toolRegistry ?? profile.config.getToolRegistry?.(),
    );

  const runtimeContext = createAgentRuntimeContext({
    state: profile.state,
    settings: profile.settings,
    provider: providerAdapter,
    telemetry: telemetryAdapter,
    tools: toolsView,
    history,
    providerRuntime: profile.providerRuntime,
  });

  let contentGenerator: ContentGenerator;
  if (overrides.contentGenerator) {
    contentGenerator = overrides.contentGenerator;
  } else {
    const contentConfig = profile.contentGeneratorConfig;
    if (!contentConfig) {
      throw new Error(
        'AgentRuntimeLoader requires contentGeneratorConfig when no contentGenerator override is supplied.',
      );
    }
    const factory =
      overrides.contentGeneratorFactory ?? defaultContentGeneratorFactory;
    contentGenerator = await factory(
      contentConfig,
      profile.config,
      profile.state.sessionId,
    );
  }

  return {
    runtimeContext,
    history,
    providerAdapter,
    telemetryAdapter,
    toolsView,
    contentGenerator,
  };
}
