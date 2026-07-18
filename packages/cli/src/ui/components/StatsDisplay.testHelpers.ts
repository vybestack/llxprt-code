/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';
import type { SessionMetrics } from '../contexts/SessionContext.js';
import type { RuntimeApi } from '../contexts/RuntimeContext.js';

export const defaultTokenTracking = {
  tokensPerMinute: 0,
  throttleWaitTimeMs: 0,
  timeToFirstToken: null as number | null,
  tokensPerSecond: 0,
  sessionTokenUsage: {
    input: 0,
    output: 0,
    cache: 0,
    tool: 0,
    thought: 0,
    total: 0,
  },
};

export const defaultTiming = {
  completeTokensPerMinute: 0,
  outputGenerationTps: 0,
  effectiveInputTps: 0,
  uncachedInputTps: null as number | null,
  lastRequestTpm: 0,
  accumulatedApiTimeMs: 0,
  accumulatedToolTimeMs: 0,
  agentActiveTimeMs: 0,
  accumulatedWorkMs: 0,
  lastTtftMs: null,
  weightedAvgTtftMs: null,
  lastOutputGenerationTps: 0,
  lastEffectiveInputTps: 0,
};

export const defaultCache = {
  hasReliableCacheData: false,
  hasReliableCacheReads: false,
  hasReliableCacheWrites: false,
  requestsWithCacheReads: 0,
  requestsWithCacheWrites: 0,
  totalCacheReads: 0,
  totalCacheWrites: null as number | null,
};

type TestMetricsInput = {
  models?: SessionMetrics['models'];
  files?: SessionMetrics['files'];
  tokenTracking?: Partial<SessionMetrics['tokenTracking']>;
  timing?: Partial<SessionMetrics['timing']>;
  cache?: Partial<SessionMetrics['cache']>;
  tools?: Partial<Omit<SessionMetrics['tools'], 'totalDecisions'>> & {
    totalDecisions?: SessionMetrics['tools']['totalDecisions'];
  };
};

export type { TestMetricsInput };

// Clone the nested default objects (one level deep) so that tests that
// mutate spread copies cannot corrupt the shared module-level singletons.
// Each invocation of withTokenTracking / defaultZeroMetrics must see
// pristine nested state. Only nested defaults are cloned — deeply nested
// values within them are not recursively cloned.
const cloneTokenTracking = () => ({
  ...defaultTokenTracking,
  sessionTokenUsage: { ...defaultTokenTracking.sessionTokenUsage },
});

const cloneTiming = () => ({ ...defaultTiming });

const cloneCache = () => ({ ...defaultCache });

export const withTokenTracking = (
  partial: TestMetricsInput,
): SessionMetrics => ({
  models: partial.models ?? {},
  tools: {
    totalCalls: partial.tools?.totalCalls ?? 0,
    totalSuccess: partial.tools?.totalSuccess ?? 0,
    totalFail: partial.tools?.totalFail ?? 0,
    totalCancelled: partial.tools?.totalCancelled ?? 0,
    totalDurationMs: partial.tools?.totalDurationMs ?? 0,
    totalDecisions: partial.tools?.totalDecisions ?? {
      accept: 0,
      reject: 0,
      modify: 0,
      auto_accept: 0,
    },
    byName: partial.tools?.byName ?? {},
  },
  files: partial.files ?? { totalLinesAdded: 0, totalLinesRemoved: 0 },
  tokenTracking: { ...cloneTokenTracking(), ...partial.tokenTracking },
  timing: { ...cloneTiming(), ...partial.timing },
  cache: { ...cloneCache(), ...partial.cache },
});

export const defaultZeroMetrics = (): SessionMetrics => ({
  models: {},
  tools: {
    totalCalls: 0,
    totalSuccess: 0,
    totalFail: 0,
    totalCancelled: 0,
    totalDurationMs: 0,
    totalDecisions: { accept: 0, reject: 0, modify: 0, auto_accept: 0 },
    byName: {},
  },
  files: {
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
  },
  tokenTracking: cloneTokenTracking(),
  timing: cloneTiming(),
  cache: cloneCache(),
});

/**
 * Builds a fully-typed RuntimeApi mock with every method stubbed as a vi.fn().
 * Overrides allow per-test customization without repeating incomplete runtime
 * objects throughout the test suite.
 *
 * Usage:
 *   const api = createMockRuntimeApi({
 *     getActiveProviderMetrics: () => ({ tokensPerMinute: 1234, ... }),
 *   });
 */
export function createMockRuntimeApi(
  overrides: Partial<
    Record<keyof RuntimeApi, (...args: unknown[]) => unknown>
  > = {},
): RuntimeApi {
  const stubs = {
    listProviders: vi.fn(() => []),
    getActiveProviderName: vi.fn(() => 'mock-provider'),
    setActiveModel: vi.fn(async () => {}),
    listAvailableModels: vi.fn(() => []),
    getActiveModelName: vi.fn(() => 'mock-model'),
    getActiveProfileName: vi.fn(() => null),
    getActiveProviderStatus: vi.fn(() => ({ status: 'ready' })),
    getActiveModelParams: vi.fn(() => ({})),
    getEphemeralSettings: vi.fn(() => ({})),
    setEphemeralSetting: vi.fn(() => {}),
    getEphemeralSetting: vi.fn(() => undefined),
    setActiveModelParam: vi.fn(() => {}),
    clearActiveModelParam: vi.fn(() => {}),
    saveProfileSnapshot: vi.fn(async () => {}),
    saveLoadBalancerProfile: vi.fn(async () => {}),
    loadProfileByName: vi.fn(async () => {}),
    deleteProfileByName: vi.fn(async () => {}),
    listSavedProfiles: vi.fn(() => []),
    getProfileByName: vi.fn(() => null),
    setDefaultProfileName: vi.fn(() => {}),
    updateActiveProviderBaseUrl: vi.fn(async () => {}),
    updateActiveProviderApiKey: vi.fn(async () => {}),
    getActiveProviderMetrics: vi.fn(() => ({
      tokensPerMinute: 0,
      throttleWaitTimeMs: 0,
      totalTokens: 0,
      totalRequests: 0,
    })),
    getCliProviderManager: vi.fn(() => null),
    getCliOAuthManager: vi.fn(() => {
      throw new Error('OAuthManager missing from runtime registration');
    }),
    maybeGetCliOAuthManager: vi.fn(() => null),
    registerCliProviderInfrastructure: vi.fn(() => {}),
    getRuntimeDiagnosticsSnapshot: vi.fn(() => ({})),
    getActiveToolFormatState: vi.fn(() => ({
      format: 'default',
      isOverridden: false,
    })),
    setActiveToolFormatOverride: vi.fn(() => {}),
    getSessionTokenUsage: vi.fn(() => ({
      input: 0,
      output: 0,
      cache: 0,
      tool: 0,
      thought: 0,
      total: 0,
    })),
    getCliRuntimeServices: vi.fn(() => null),
    getLoadBalancerStats: vi.fn(() => null),
    getLoadBalancerLastSelected: vi.fn(() => null),
    getAllLoadBalancerStats: vi.fn(() => []),
    enterRuntimeScope: vi.fn(() => {}),
    runWithRuntimeScope: vi.fn(<T>(cb: () => T): T => cb()),
    setProvider: vi.fn(async () => ({
      success: true,
      provider: 'mock-provider',
      model: 'mock-model',
    })),
    ...overrides,
  };
  return stubs as RuntimeApi;
}
