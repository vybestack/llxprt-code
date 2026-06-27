/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type {
  RuntimeProviderManager,
  RuntimeProviderMetrics,
  RuntimeSessionTokenUsage,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderManager.js';
import type { RuntimeModel } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeModel.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

/**
 * @plan PLAN-20260610-ISSUE1592.P03
 * @requirement REQ-DEP-001
 *
 * Test-only structural RuntimeProviderManager used by agents tests so the
 * agents package does not depend on concrete provider implementations.
 */
export class TestRuntimeProviderManager implements RuntimeProviderManager {
  private readonly providers = new Map<string, RuntimeProvider>();
  private activeProviderName: string | undefined;
  private serverToolsProvider: RuntimeProvider | null | undefined;
  private runtimeContext: ProviderRuntimeContext | undefined;

  constructor(runtimeContext?: ProviderRuntimeContext) {
    this.runtimeContext = runtimeContext;
  }

  getActiveProvider(): RuntimeProvider | undefined {
    return this.activeProviderName
      ? this.providers.get(this.activeProviderName)
      : undefined;
  }

  getActiveProviderName(): string | undefined {
    return this.activeProviderName;
  }

  setActiveProvider(name: string): void {
    this.activeProviderName = name;
  }

  async getAvailableModels(providerName?: string): Promise<RuntimeModel[]> {
    const provider = providerName
      ? this.providers.get(providerName)
      : this.getActiveProvider();
    return provider?.getModels() ?? [];
  }

  getProviderNames(): string[] {
    return this.listProviders();
  }

  listProviders(): string[] {
    return [...this.providers.keys()];
  }

  getProviderByName(name: string): RuntimeProvider | undefined {
    return this.providers.get(name);
  }

  registerProvider(provider: RuntimeProvider): void {
    this.providers.set(provider.name, provider);
    this.activeProviderName ??= provider.name;
  }

  prepareStatelessProviderInvocation(): ProviderRuntimeContext | undefined {
    return this.runtimeContext;
  }

  getProviderMetrics(): RuntimeProviderMetrics {
    return {};
  }

  getSessionTokenUsage(): RuntimeSessionTokenUsage {
    return {
      input: 0,
      output: 0,
      cache: 0,
      tool: 0,
      thought: 0,
      total: 0,
    };
  }

  getServerToolsProvider(): RuntimeProvider | null | undefined {
    return this.serverToolsProvider;
  }

  setServerToolsProvider(provider: RuntimeProvider | null): void {
    this.serverToolsProvider = provider;
  }

  setConfig(_config: Config): void {}

  setRuntimeContext(runtimeContext: ProviderRuntimeContext): void {
    this.runtimeContext = runtimeContext;
  }

  hasActiveProvider(): boolean {
    return this.getActiveProvider() != null;
  }

  accumulateSessionTokens(_providerName: string, _usage: unknown): void {}
}
