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
  toolRegistry?: ToolRegistry;
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

import { normalizeToolName } from '../tools/toolNameUtils.js';

type ToolGovernance = {
  allowed: Set<string>;
  disabled: Set<string>;
  excluded: Set<string>;
};

function buildToolGovernance(
  profile: AgentRuntimeProfileSnapshot,
): ToolGovernance {
  const allowedRaw = Array.isArray(profile.settings.tools?.allowed)
    ? profile.settings.tools?.allowed
    : undefined;
  const disabledRaw = Array.isArray(profile.settings.tools?.disabled)
    ? profile.settings.tools?.disabled
    : undefined;
  const excludedRaw = profile.config.getExcludeTools?.() ?? [];

  return {
    allowed: new Set(
      (allowedRaw ?? []).map((tool) => normalizeToolName(tool) || tool),
    ),
    disabled: new Set(
      (disabledRaw ?? []).map((tool) => normalizeToolName(tool) || tool),
    ),
    excluded: new Set(
      excludedRaw.map((tool) => normalizeToolName(tool) || tool),
    ),
  };
}

function isToolPermitted(
  toolName: string,
  governance: ToolGovernance,
): boolean {
  const canonical = normalizeToolName(toolName) || toolName;
  if (governance.excluded.has(canonical)) {
    return false;
  }
  if (governance.disabled.has(canonical)) {
    return false;
  }
  if (governance.allowed.size > 0 && !governance.allowed.has(canonical)) {
    return false;
  }
  return true;
}

function createFilteredToolRegistryView(
  registry: ToolRegistry | undefined,
  governance: ToolGovernance,
): ToolRegistryView {
  if (!registry) {
    return {
      listToolNames: () => [],
      getToolMetadata: () => undefined,
    };
  }

  const getTools = (): ReturnType<ToolRegistry['getAllTools']> =>
    registry.getAllTools();

  return {
    listToolNames: () =>
      getTools()
        .filter((tool) => isToolPermitted(tool.name, governance))
        .map((tool) => tool.name),
    getToolMetadata: (name) => {
      if (!isToolPermitted(name, governance)) {
        return undefined;
      }
      const tool = getTools().find((candidate) => candidate.name === name);
      if (!tool) {
        return undefined;
      }
      const schema = (tool as unknown as { schema?: Record<string, unknown> })
        .schema;
      const description =
        typeof schema?.description === 'string'
          ? (schema.description as string)
          : typeof (tool as { description?: string }).description === 'string'
            ? ((tool as { description: string }).description as string)
            : '';
      const parameterSchema =
        (schema as { parameters?: Record<string, unknown> })?.parameters ??
        (schema as { parametersJsonSchema?: Record<string, unknown> })
          ?.parametersJsonSchema;

      return {
        name: (tool as { name?: string }).name ?? name,
        description,
        parameterSchema,
      };
    },
  };
}

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

  const governance = buildToolGovernance(profile);
  const toolsView: ToolRegistryView =
    overrides.toolsView ??
    createFilteredToolRegistryView(
      profile.toolRegistry ?? profile.config.getToolRegistry?.(),
      governance,
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
    toolRegistry: profile.toolRegistry,
    settingsSnapshot: profile.settings,
  };
}
