/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import type {
  RuntimeProviderManager,
  RuntimeTokenizerFactory,
  RuntimeContentGeneratorFactory,
  ContentGenerator,
} from '@vybestack/llxprt-code-core';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { ReadonlySettingsSnapshot } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { ContentGeneratorConfig } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { ToolSelectedRuntimeLoaderOptions } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';

export function buildSubagentRuntimeLoaderOptions(
  config: Config,
  settingsOwner: SessionSettingsOwner,
  mediaStore: LocalMediaStore,
  providerManager: RuntimeProviderManager,
  tokenizerFactory: RuntimeTokenizerFactory,
  contentGeneratorFactory: RuntimeContentGeneratorFactory<ContentGenerator>,
  toolRegistry: ToolSelection,
  runtimeState: AgentRuntimeState,
  settingsSnapshot: ReadonlySettingsSnapshot,
  providerRuntime: ProviderRuntimeContext,
  contentGeneratorConfig: ContentGeneratorConfig,
  signal: AbortSignal | undefined,
): ToolSelectedRuntimeLoaderOptions {
  return {
    mediaStore,
    profile: {
      config,
      telemetry: settingsOwner.telemetry,
      state: runtimeState,
      prepareProviderInvocation: (provider, parameters, signal) =>
        settingsOwner.prepareProviderInvocation(
          runtimeState.runtimeId,
          provider,
          parameters,
          signal,
          runtimeState.sessionId,
          providerManager.fetchNetwork,
        ),
      readRuntimeSettings: () => settingsOwner.readRuntimePolicy(),
      readToolGovernance: () =>
        settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
      settings: settingsSnapshot,
      providerRuntime,
      promptEstimator: {
        estimatePrompt: (request) => tokenizerFactory.estimatePrompt(request),
        claimsModel: (model) => tokenizerFactory.claimsModel?.(model) ?? false,
        getEstimatorFamily: (model) =>
          tokenizerFactory.getEstimatorFamily?.(model),
      },
      contentGeneratorConfig: {
        ...contentGeneratorConfig,
        contentGeneratorFactory,
      },
      toolRegistry,
      providerManager,
    },
    signal,
  };
}
