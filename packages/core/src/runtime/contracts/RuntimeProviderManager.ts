/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Core-owned structural contract for what core needs from a provider manager.
 *
 * This contract describes only the methods that core runtime and config consume.
 * Provider package's ProviderManager satisfies this structurally without importing it.
 *
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 * @pseudocode component-boundaries.md C-CB-05, lines 50-54
 */

import type { RuntimeProvider } from './RuntimeProvider.js';
import type { RuntimeModel } from './RuntimeModel.js';
import type { Config } from '../../config/config.js';
import type { ProviderRuntimeContext } from '../providerRuntimeContext.js';

export interface RuntimeProviderMetrics {
  [key: string]: unknown;
}

export interface RuntimeSessionTokenUsage {
  input: number;
  output: number;
  cache: number;
  tool: number;
  thought: number;
  total: number;
}

/**
 * Core-owned structural provider manager contract.
 *
 * Covers only methods that core config and runtime consume:
 * - getActiveProvider / getActiveProviderName / setActiveProvider
 * - getAvailableModels
 * - listProviders
 *
 * CLI constructs the concrete ProviderManager from the providers package
 * and passes it into core through this contract.
 *
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 * @pseudocode component-boundaries.md C-CB-05, lines 50-54
 */
export interface RuntimeProviderManager {
  getActiveProvider(): RuntimeProvider | undefined;
  getActiveProviderName(): string | undefined;
  setActiveProvider(name: string): void | Promise<void>;
  getAvailableModels(providerName?: string): Promise<RuntimeModel[]>;
  getProviderNames?(): string[];
  listProviders(): string[];
  getProviderByName(name: string): RuntimeProvider | undefined;
  registerProvider(provider: RuntimeProvider): void;
  prepareStatelessProviderInvocation?(runtimeContext?: unknown): unknown;
  getProviderMetrics(): RuntimeProviderMetrics;
  getSessionTokenUsage(): RuntimeSessionTokenUsage;
  getServerToolsProvider(): RuntimeProvider | null | undefined;
  setServerToolsProvider(provider: RuntimeProvider | null): void;
  setConfig(config: Config): void;
  setRuntimeContext(runtimeContext: ProviderRuntimeContext): void;
  hasActiveProvider(): boolean;
  accumulateSessionTokens(providerName: string, usage: unknown): void;
}
