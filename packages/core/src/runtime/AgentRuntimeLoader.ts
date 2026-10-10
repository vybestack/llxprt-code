import type { ProviderRequestDiagnostics } from './providerRequestDiagnostics.js';
import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RuntimeTokenizerFactory } from './contracts/RuntimeTokenizerFactory.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { createHistoryProviderFileBindingStore } from '../services/history/provider-file-binding.js';
import type { Config } from '../config/config.js';
import type { LocalMediaStore } from '../storage/local-media-store.js';
import { MediaAdmissionService } from '../storage/media-admission-service.js';
import { RequestMediaResolver } from '../storage/request-media-resolver.js';
import {
  hasToolSchema,
  resolveToolDescription,
  type ToolSelection,
  isToolBlocked,
  type ToolGovernance,
} from '@vybestack/llxprt-code-tools';
import type { RuntimeProviderManager } from './contracts/RuntimeProviderManager.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapter,
} from './runtimeAdapters.js';
import type {
  AgentRuntimeContext,
  AgentRuntimeProviderAdapter,
  AgentRuntimeTelemetryAdapter,
  ToolRegistryView,
  ReadonlySettingsSnapshot,
  PrepareProviderInvocation,
} from './AgentRuntimeContext.js';
import type { AgentRuntimeState } from './AgentRuntimeState.js';
import { createAgentRuntimeContext } from './createAgentRuntimeContext.js';
import type { ProviderRequestCollaborators } from './providerRuntimeContext.js';
import {
  createContentGenerator,
  type ContentGenerator,
  type ContentGeneratorConfig,
} from '../core/contentGenerator.js';

export interface AgentRuntimeProfileSnapshot {
  readonly promptEstimator?: Pick<
    RuntimeTokenizerFactory,
    'estimatePrompt' | 'claimsModel' | 'getEstimatorFamily'
  >;
  config: Config;
  requestDiagnostics?: ProviderRequestDiagnostics;
  telemetry: RootTelemetry;
  state: AgentRuntimeState;
  settings: ReadonlySettingsSnapshot;
  providerRuntime: ProviderRequestCollaborators;
  prepareProviderInvocation: PrepareProviderInvocation;
  readRuntimeSettings?: () => ReadonlySettingsSnapshot;
  readToolGovernance: () => ToolGovernance;
  contentGeneratorConfig?: ContentGeneratorConfig;
  toolRegistry?: ToolSelection;
  providerManager?: RuntimeProviderManager;
}

export interface AgentRuntimeLoaderOverrides {
  providerAdapter?: AgentRuntimeProviderAdapter;
  telemetryAdapter?: AgentRuntimeTelemetryAdapter;
  toolsView?: ToolRegistryView;
  historyService?: HistoryService;
  mediaAdmission?: MediaAdmissionService;
  mediaResolver?: RequestMediaResolver;
  contentGenerator?: ContentGenerator;
  contentGeneratorFactory?: ContentGeneratorFactory;
}

export interface AgentRuntimeLoaderOptions {
  profile: AgentRuntimeProfileSnapshot;
  mediaStore: LocalMediaStore;
  overrides?: AgentRuntimeLoaderOverrides;
  signal?: AbortSignal;
}

export interface AgentRuntimeLoaderResult {
  telemetryRoot: RootTelemetry;
  runtimeContext: AgentRuntimeContext;
  history: HistoryService;
  providerAdapter: AgentRuntimeProviderAdapter;
  telemetryAdapter: AgentRuntimeTelemetryAdapter;
  toolsView: ToolRegistryView;
  contentGenerator: ContentGenerator;
  toolRegistry?: ToolSelection;
  settingsSnapshot?: ReadonlySettingsSnapshot;
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

function hydrateContentGeneratorConfig(
  profile: AgentRuntimeProfileSnapshot,
  contentConfig: ContentGeneratorConfig,
): ContentGeneratorConfig {
  const contentGeneratorFactory = contentConfig.contentGeneratorFactory;

  return {
    ...contentConfig,
    ...(contentGeneratorFactory == null ? {} : { contentGeneratorFactory }),
  };
}

function createFilteredToolRegistryView(
  registry: ToolSelection | undefined,
  readGovernance: () => ToolGovernance,
): ToolRegistryView {
  if (!registry) {
    return {
      listToolNames: () => [],
      getToolMetadata: () => undefined,
    };
  }

  const getTools = (): ReturnType<ToolSelection['getAllTools']> =>
    registry.getAllTools();

  return {
    listToolNames: () =>
      getTools()
        .filter((tool) => !isToolBlocked(tool.name, readGovernance()))
        .map((tool) => tool.name),
    getToolMetadata: (name) => {
      if (isToolBlocked(name, readGovernance())) {
        return undefined;
      }
      const tool = getTools().find((candidate) => candidate.name === name);
      if (!tool) {
        return undefined;
      }
      const schema = hasToolSchema(tool) ? tool.schema : undefined;
      const description = resolveToolDescription(schema, tool.description);
      const parameterSchema = structuredClone(schema?.parametersJsonSchema);

      return {
        name: tool.name,
        description,
        parameterSchema,
      };
    },
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  const error = new Error('Runtime load aborted');
  error.name = 'AbortError';
  throw error;
}

export async function loadAgentRuntime(
  options: AgentRuntimeLoaderOptions,
): Promise<AgentRuntimeLoaderResult> {
  const { profile, mediaStore, overrides = {}, signal } = options;
  throwIfAborted(signal);

  const history = overrides.historyService ?? new HistoryService();

  const providerAdapter: AgentRuntimeProviderAdapter =
    overrides.providerAdapter ??
    createProviderAdapterFromManager(profile.providerManager);

  const telemetryAdapter: AgentRuntimeTelemetryAdapter =
    overrides.telemetryAdapter ??
    createTelemetryAdapter(profile.config, profile.telemetry);

  const toolsView: ToolRegistryView =
    overrides.toolsView ??
    createFilteredToolRegistryView(
      profile.toolRegistry,
      profile.readToolGovernance,
    );
  const mediaAdmission =
    overrides.mediaAdmission ?? new MediaAdmissionService(mediaStore);
  const mediaResolver =
    overrides.mediaResolver ?? new RequestMediaResolver(mediaStore);
  const requestMediaBudgetBytes = profile.config.getImagePayloadBudgetBytes();

  const runtimeContext = createAgentRuntimeContext({
    state: profile.state,
    promptEstimator: profile.promptEstimator,
    settings: profile.settings,
    provider: providerAdapter,
    telemetry: telemetryAdapter,
    requestDiagnostics: profile.requestDiagnostics,
    tools: toolsView,
    history,
    readRuntimeSettings: profile.readRuntimeSettings,
    prepareProviderInvocation: profile.prepareProviderInvocation,
    providerRuntime: {
      ...profile.providerRuntime,
      mediaResolver,
      requestMediaBudgetBytes,
      providerFileBindings: createHistoryProviderFileBindingStore(history),
    },
    mediaStore,
    mediaAdmission,
    mediaResolver,
  });

  await history.settleMediaOwnership();
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

    const hydratedConfig = hydrateContentGeneratorConfig(
      profile,
      contentConfig,
    );

    const factory =
      overrides.contentGeneratorFactory ?? defaultContentGeneratorFactory;
    contentGenerator = await factory(
      hydratedConfig,
      profile.config,
      profile.state.sessionId,
    );
  }

  return {
    runtimeContext,
    history,
    providerAdapter,
    telemetryAdapter,
    telemetryRoot: options.profile.telemetry,
    toolsView,
    contentGenerator,
    toolRegistry: profile.toolRegistry,
    settingsSnapshot: profile.settings,
  };
}
