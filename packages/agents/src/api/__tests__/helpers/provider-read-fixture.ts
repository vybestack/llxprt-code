/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  createSessionProviderReads,
  type AgentOpenAIProviderInfo,
  type SessionProviderReads,
  type SessionProviderStatus,
} from '../../session-provider-reads.js';

export class ProviderReadFixture implements SessionProviderReads {
  readonly #reads: SessionProviderReads;

  constructor(
    selection: SessionSettingsOwner,
    manager: RuntimeProviderManager,
    readConfiguredModel: () => string,
    readProviderSettings: (provider: string) => Record<string, unknown>,
  ) {
    this.#reads = createSessionProviderReads(
      selection,
      manager,
      readConfiguredModel,
      readProviderSettings,
    );
  }

  get inspection(): SessionProviderReads['inspection'] {
    return this.#reads.inspection;
  }

  refreshAliases(): Promise<void> {
    return this.#reads.refreshAliases();
  }

  readOpenAIInfo(): AgentOpenAIProviderInfo {
    return this.#reads.readOpenAIInfo();
  }

  readActiveProviderName(): string | null {
    return this.#reads.readActiveProviderName();
  }

  getActiveProviderName(): string {
    return this.#reads.getActiveProviderName();
  }

  getActiveModelName(): string {
    return this.#reads.getActiveModelName();
  }

  getActiveModelParams(): Record<string, unknown> {
    return this.#reads.getActiveModelParams();
  }

  listProviders(): string[] {
    return this.#reads.listProviders();
  }

  listAvailableModels(
    provider?: string,
  ): ReturnType<RuntimeProviderManager['getAvailableModels']> {
    return this.#reads.listAvailableModels(provider);
  }

  getActiveProviderMetrics(): ReturnType<
    RuntimeProviderManager['getProviderMetrics']
  > {
    return this.#reads.getActiveProviderMetrics();
  }

  getSessionTokenUsage(): ReturnType<
    RuntimeProviderManager['getSessionTokenUsage']
  > {
    return this.#reads.getSessionTokenUsage();
  }

  getUnallowedParametersForActiveModel(): string[] {
    return this.#reads.getUnallowedParametersForActiveModel();
  }

  providerStatus(): SessionProviderStatus {
    return this.#reads.providerStatus();
  }
}
