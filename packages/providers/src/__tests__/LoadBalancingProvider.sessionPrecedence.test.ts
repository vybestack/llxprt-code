/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deterministic behavioral tests for session-scoped settings precedence at the
 * real load-balancer delegate options/invocation normalization boundary
 * (Issue #3151).
 *
 * These tests exercise the full propagation path:
 *   foreground SessionSettingsOverlay
 *   → child SettingsService.getAllGlobalSettings()   (real settings snapshot)
 *   → createRuntimeInvocationContext                  (real invocation builder)
 *   → buildRoundRobinResolvedOptions                  (real delegate normalization)
 *   → delegate invocation.ephemerals.dumpcontext      (frozen immutable snapshot)
 *   → shouldDump(mode, isError)                       (common behavioral assertion)
 *
 * No network calls, no full agent-client activation, no mock-call assertions.
 */

import { describe, it, expect } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  createRuntimeInvocationContext,
  type RuntimeInvocationContext,
} from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { buildRoundRobinResolvedOptions } from '../loadBalancing/resolvedOptionsBuilder.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { GenerateChatOptions } from '../IProvider.js';
import type { ResolvedSubProfile } from '../LoadBalancingProvider.js';
import { shouldDump, type DumpMode } from '../utils/dumpContext.js';

const noopLogger = {
  debug: () => {},
  error: () => {},
  warn: () => {},
  info: () => {},
} as unknown as import('@vybestack/llxprt-code-core/debug/DebugLogger.js').DebugLogger;

function makeRuntime(settings: SettingsService): ProviderRuntimeContext {
  return {
    settingsService: settings,
    config: undefined,
    runtimeId: 'test-lb-runtime',
    metadata: {},
  };
}

/**
 * Build a real RuntimeInvocationContext from the child SettingsService's
 * getAllGlobalSettings(). This is the same propagation boundary production
 * code uses: the session overlay value flows through getAllGlobalSettings()
 * into the immutable invocation snapshot.
 */
function makeUpstreamInvocation(
  settings: SettingsService,
): RuntimeInvocationContext {
  return createRuntimeInvocationContext({
    runtime: makeRuntime(settings),
    settings,
    providerName: 'load-balancer',
    ephemeralsSnapshot: settings.getAllGlobalSettings(),
    metadata: {},
    fallbackRuntimeId: 'test-upstream',
  });
}

function makeBaseOptions(
  settings: SettingsService,
  invocation: RuntimeInvocationContext,
): GenerateChatOptions {
  return {
    contents: [],
    settings,
    runtime: makeRuntime(settings),
    config: { getModel: () => 'test-model' } as unknown as Config,
    invocation,
    resolved: {
      model: 'test-model',
      authToken: 'test-token',
      baseURL: 'https://test.example.com',
    },
    metadata: {},
  } as unknown as GenerateChatOptions;
}

function makeCtx(): Parameters<typeof buildRoundRobinResolvedOptions>[2] {
  return {
    lbProfileEphemeralSettings: undefined,
    lbProfileModelParams: undefined,
    logger: noopLogger,
    providerName: 'load-balancer',
    getEffectiveContextLimit: () => undefined,
  };
}

function makeSubProfile(
  overrides: Partial<ResolvedSubProfile> = {},
): ResolvedSubProfile {
  return {
    name: 'member-1',
    providerName: 'openai',
    model: 'gpt-4',
    baseURL: 'https://member.example.com',
    authToken: 'member-token',
    ephemeralSettings: {},
    modelParams: {},
    ...overrides,
  };
}

function buildDelegateInvocation(
  foreground: SettingsService,
  subProfileOverrides: Partial<ResolvedSubProfile> = {},
  ctxOverrides: Partial<
    Parameters<typeof buildRoundRobinResolvedOptions>[2]
  > = {},
): RuntimeInvocationContext {
  const child = new SettingsService({ sessionSource: foreground });
  const upstream = makeUpstreamInvocation(child);
  const options = makeBaseOptions(child, upstream);
  const subProfile = makeSubProfile(subProfileOverrides);
  const ctx = { ...makeCtx(), ...ctxOverrides };
  const result = buildRoundRobinResolvedOptions(subProfile, options, ctx);
  return result.invocation as RuntimeInvocationContext;
}

function delegateDumpMode(
  invocation: RuntimeInvocationContext,
): DumpMode | undefined {
  return invocation.getEphemeral<DumpMode>('dumpcontext');
}

describe('LoadBalancingProvider session-scoped delegate precedence (#3151)', () => {
  describe('session on overrides member/LB profile off', () => {
    it('session dumpcontext=on wins over member profile dumpcontext=off', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'on');

      const invocation = buildDelegateInvocation(foreground, {
        ephemeralSettings: { dumpcontext: 'off' },
      });

      expect(delegateDumpMode(invocation)).toBe('on');
    });

    it('session dumpcontext=on wins over LB-profile dumpcontext=off', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'on');

      const invocation = buildDelegateInvocation(
        foreground,
        {},
        { lbProfileEphemeralSettings: { dumpcontext: 'off' } },
      );

      expect(delegateDumpMode(invocation)).toBe('on');
    });
  });

  describe('session off overrides profile on', () => {
    it('session dumpcontext=off wins over member profile dumpcontext=on', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'off');

      const invocation = buildDelegateInvocation(foreground, {
        ephemeralSettings: { dumpcontext: 'on' },
      });

      expect(delegateDumpMode(invocation)).toBe('off');
    });
  });

  describe('absent session uses profile fallback', () => {
    it('member profile dumpcontext=on when no session override exists', () => {
      const foreground = new SettingsService();

      const invocation = buildDelegateInvocation(foreground, {
        ephemeralSettings: { dumpcontext: 'on' },
      });

      expect(delegateDumpMode(invocation)).toBe('on');
    });
  });

  describe('unrelated-setting isolation', () => {
    it('member profile temperature wins over upstream snapshot', () => {
      const foreground = new SettingsService();
      foreground.set('temperature', 0.9);

      const invocation = buildDelegateInvocation(foreground, {
        ephemeralSettings: { temperature: 0.3 },
      });

      // temperature is NOT session-scoped, so member profile wins.
      expect(invocation.getEphemeral('temperature')).toBe(0.3);
    });
  });

  describe('immutable upstream invocation', () => {
    it('delegate composition does not mutate the upstream invocation ephemerals', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'on');

      const child = new SettingsService({ sessionSource: foreground });
      const upstream = makeUpstreamInvocation(child);
      const upstreamEphemerals = { ...upstream.ephemerals };
      const options = makeBaseOptions(child, upstream);

      const subProfile = makeSubProfile({
        ephemeralSettings: { dumpcontext: 'off', temperature: 0.9 },
      });

      buildRoundRobinResolvedOptions(subProfile, options, makeCtx());

      // The upstream invocation is frozen and must not be mutated.
      expect({ ...upstream.ephemerals }).toStrictEqual(upstreamEphemerals);
    });

    it('an in-flight delegate invocation is unaffected by a later session change', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'on');

      const invocation = buildDelegateInvocation(foreground, {
        ephemeralSettings: { dumpcontext: 'off' },
      });

      // Simulate a live session mode change after the invocation snapshot.
      foreground.setSessionScoped('dumpcontext', 'off');

      // The already-built delegate invocation retains its immutable snapshot.
      expect(delegateDumpMode(invocation)).toBe('on');
    });
  });

  describe('normalized options type safety', () => {
    it('result is a valid NormalizedGenerateChatOptions with a frozen invocation', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'on');

      const child = new SettingsService({ sessionSource: foreground });
      const upstream = makeUpstreamInvocation(child);
      const options = makeBaseOptions(child, upstream);
      const subProfile = makeSubProfile();

      const result = buildRoundRobinResolvedOptions(
        subProfile,
        options,
        makeCtx(),
      ) as NormalizedGenerateChatOptions;

      expect(Object.isFrozen(result.invocation)).toBe(true);
      expect(result.metadata.loadBalancerDelegate).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // BEHAVIORAL PROPAGATION — assert via the common shouldDump behavior
  // ------------------------------------------------------------------
  describe('shouldDump behavioral propagation', () => {
    it('session on: dumps success', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'on');

      const invocation = buildDelegateInvocation(foreground, {
        ephemeralSettings: { dumpcontext: 'off' },
      });

      const mode = delegateDumpMode(invocation);
      expect(shouldDump(mode, false)).toBe(true);
    });

    it('session off: does not dump', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'off');

      const invocation = buildDelegateInvocation(foreground, {
        ephemeralSettings: { dumpcontext: 'on' },
      });

      const mode = delegateDumpMode(invocation);
      expect(shouldDump(mode, false)).toBe(false);
      expect(shouldDump(mode, true)).toBe(false);
    });

    it('session error: skips success dump, dumps failure', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'error');

      const invocation = buildDelegateInvocation(foreground, {
        ephemeralSettings: { dumpcontext: 'on' },
      });

      const mode = delegateDumpMode(invocation);
      expect(shouldDump(mode, false)).toBe(false);
      expect(shouldDump(mode, true)).toBe(true);
    });

    it('a previously created invocation remains frozen after a foreground mode change', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'on');

      // Build the first invocation while mode is 'on'.
      const invocation1 = buildDelegateInvocation(foreground);
      expect(shouldDump(delegateDumpMode(invocation1), false)).toBe(true);

      // Change foreground to 'off'.
      foreground.setSessionScoped('dumpcontext', 'off');

      // The first invocation is frozen — still 'on'.
      expect(delegateDumpMode(invocation1)).toBe('on');
      expect(shouldDump(delegateDumpMode(invocation1), false)).toBe(true);

      // A new invocation reflects 'off'.
      const invocation2 = buildDelegateInvocation(foreground);
      expect(delegateDumpMode(invocation2)).toBe('off');
      expect(shouldDump(delegateDumpMode(invocation2), false)).toBe(false);
    });

    it('session precedence over member profile dumpcontext', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'error');

      const invocation = buildDelegateInvocation(foreground, {
        ephemeralSettings: { dumpcontext: 'on' },
      });

      const mode = delegateDumpMode(invocation);
      // Session 'error' wins over member profile 'on'.
      expect(mode).toBe('error');
      expect(shouldDump(mode, false)).toBe(false);
      expect(shouldDump(mode, true)).toBe(true);
    });

    it('session precedence over LB profile dumpcontext', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'off');

      const invocation = buildDelegateInvocation(
        foreground,
        {},
        { lbProfileEphemeralSettings: { dumpcontext: 'on' } },
      );

      const mode = delegateDumpMode(invocation);
      // Session 'off' wins over LB profile 'on'.
      expect(mode).toBe('off');
      expect(shouldDump(mode, false)).toBe(false);
    });

    it('absent session uses profile fallback — profile on dumps success', () => {
      const foreground = new SettingsService();

      const invocation = buildDelegateInvocation(foreground, {
        ephemeralSettings: { dumpcontext: 'on' },
      });

      const mode = delegateDumpMode(invocation);
      expect(mode).toBe('on');
      expect(shouldDump(mode, false)).toBe(true);
    });
  });
});
