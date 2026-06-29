/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ExtendedLoadBalancerStats } from '@vybestack/llxprt-code-providers';
import { diagnosticsCommand } from './diagnosticsCommand.js';
import type { MessageActionReturn } from './types.js';
import {
  setupDiagnosticsTest,
  teardownDiagnosticsTest,
  type DiagnosticsTestSetup,
} from './diagnosticsCommand-test-helpers.js';

const runtimeMocks = vi.hoisted(() => ({
  getRuntimeApiMock: vi.fn(),
}));

vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: runtimeMocks.getRuntimeApiMock,
}));

function makeLbStats(
  overrides: Partial<ExtendedLoadBalancerStats>,
): ExtendedLoadBalancerStats {
  return {
    profileName: 'my-lb',
    lastSelected: null,
    lastSelectedModel: null,
    members: [],
    totalRequests: 0,
    profileCounts: {},
    backendMetrics: {},
    circuitBreakerStates: {},
    currentTPM: {},
    ...overrides,
  };
}

function setupLoadBalancerRuntime(options: {
  runtimeProfileName: string | null;
  lbStats: ExtendedLoadBalancerStats;
}) {
  const lbProvider = {
    getStats: vi.fn(() => options.lbStats),
  };

  runtimeMocks.getRuntimeApiMock.mockReturnValue({
    getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
      providerName: 'load-balancer',
      modelName: options.lbStats.profileName,
      profileName: options.runtimeProfileName,
      modelParams: {},
      ephemeralSettings: {},
    })),
    getActiveProviderStatus: vi.fn(() => ({
      providerName: 'load-balancer',
      modelName: options.lbStats.profileName,
    })),
    getCliProviderManager: vi.fn(() => ({
      getProviderByName: vi.fn((name: string) =>
        name === 'load-balancer' ? lbProvider : null,
      ),
    })),
    getCliOAuthManager: vi.fn(() => null),
  });
}

describe('diagnosticsCommand load-balancer identity (issue #2193)', () => {
  let setup: DiagnosticsTestSetup;
  let mockContext: ReturnType<typeof setupDiagnosticsTest>['mockContext'];

  beforeEach(() => {
    setup = setupDiagnosticsTest();
    mockContext = setup.mockContext;
  });

  afterEach(() => {
    teardownDiagnosticsTest(setup);
  });

  it('reports the runtime profile, load-balancer profile, members, active sub-profile, and active model', async () => {
    setupLoadBalancerRuntime({
      runtimeProfileName: 'my-lb',
      lbStats: makeLbStats({
        profileName: 'my-lb',
        lastSelected: 'fast-sub',
        lastSelectedModel: 'gpt-4o-mini',
        members: ['fast-sub', 'smart-sub'],
        totalRequests: 3,
        profileCounts: { 'fast-sub': 2, 'smart-sub': 1 },
      }),
    });

    const result = await diagnosticsCommand.action?.(mockContext, '');
    const content = (result as MessageActionReturn).content;

    // Runtime profile loaded by the CLI.
    expect(content).toContain('- Current Profile: my-lb');
    // Load-balancer specific section with disambiguated fields.
    expect(content).toContain('## Load Balancer Stats');
    expect(content).toContain('- Load Balancer Profile: my-lb');
    expect(content).toContain('- Member Sub-Profiles: fast-sub, smart-sub');
    expect(content).toContain('- Active Sub-Profile: fast-sub');
    expect(content).toContain('- Active Model: gpt-4o-mini');
    expect(content).toContain('- Total Requests: 3');
  });

  it('shows pending placeholders before any sub-profile has been selected', async () => {
    setupLoadBalancerRuntime({
      runtimeProfileName: 'my-lb',
      lbStats: makeLbStats({
        profileName: 'my-lb',
        lastSelected: null,
        lastSelectedModel: null,
        members: ['fast-sub', 'smart-sub'],
        totalRequests: 0,
        profileCounts: {},
      }),
    });

    const result = await diagnosticsCommand.action?.(mockContext, '');
    const content = (result as MessageActionReturn).content;

    expect(content).toContain('- Active Sub-Profile: none');
    expect(content).toContain('- Active Model: none');
    expect(content).toContain('- Member Sub-Profiles: fast-sub, smart-sub');
  });

  it('explains the runtime-profile vs provider-stats/config distinction when both share a value', async () => {
    setupLoadBalancerRuntime({
      runtimeProfileName: 'my-lb',
      lbStats: makeLbStats({
        profileName: 'my-lb',
        lastSelected: 'fast-sub',
        lastSelectedModel: 'gpt-4o-mini',
        members: ['fast-sub', 'smart-sub'],
        totalRequests: 1,
        profileCounts: { 'fast-sub': 1 },
      }),
    });

    const result = await diagnosticsCommand.action?.(mockContext, '');
    const content = (result as MessageActionReturn).content;

    // Both "Current Profile" and "Load Balancer Profile" legitimately print
    // the same value (my-lb). The issue #2193 acceptance criterion requires
    // the output to EXPLAIN that one is runtime profile state and the other
    // is provider stats/config state, rather than silently duplicating it.
    expect(content).toContain('- Current Profile: my-lb');
    expect(content).toContain('- Load Balancer Profile: my-lb');
    expect(content).toMatch(/runtime profile/i);
    expect(content).toMatch(/stats\/config/i);
  });

  it('does not duplicate the same value under ambiguous labels', async () => {
    setupLoadBalancerRuntime({
      runtimeProfileName: 'my-lb',
      lbStats: makeLbStats({
        profileName: 'my-lb',
        lastSelected: 'fast-sub',
        lastSelectedModel: 'gpt-4o-mini',
        members: ['fast-sub', 'smart-sub'],
        totalRequests: 1,
        profileCounts: { 'fast-sub': 1 },
      }),
    });

    const result = await diagnosticsCommand.action?.(mockContext, '');
    const content = (result as MessageActionReturn).content;

    // "Active Sub-Profile" must denote the sub-profile name, not the model.
    expect(content).not.toContain('- Active Sub-Profile: gpt-4o-mini');
    // "Active Model" must denote the model, not the sub-profile name.
    expect(content).not.toContain('- Active Model: fast-sub');
    // "Load Balancer Profile" must denote the LB profile, not a sub-profile.
    expect(content).not.toContain('- Load Balancer Profile: fast-sub');
  });
});
