/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260621-COREAPIREMED.P04
 * @requirement:REQ-005.2
 *
 * RED contract for the providers `providerManager?: RuntimeProviderManager`
 * adoption seam that P05 will fulfill. The P03 stub DECLARED the optional
 * field on IsolatedRuntimeContextOptions but kept the construction site in
 * `createIsolatedRuntimeContext` UNCONDITIONAL (`new ProviderManager({...})`
 * at runtimeContextFactory.ts), so passing a caller-provided manager is
 * silently ignored — the handle carries a FRESH manager, not the supplied one.
 *
 * These are BEHAVIORAL identity / count / resolved-value tests. The fixture
 * `pm` is a REAL `ProviderManager` (which structurally satisfies the
 * `RuntimeProviderManager` option type), so it is passed DIRECTLY in the
 * options literal — NO intersection type, NO cast, NO mock theater.
 *
 * Load-bearing RED: T1 (`handle.providerManager === pm`) FAILS against the P03
 * stub because the factory builds its own manager. T3 (active-runtime resolves
 * the adopted manager), T4 (no second construction), and the "onCleanup
 * receives the adopted manager" half of T6 are ALSO RED until P05 lands the
 * `??` adoption. T2 and the default-freshness property legitimately stay GREEN
 * (current behavior); the suite as a whole is RED because the adoption tests
 * fail for behavioral (identity-mismatch) reasons.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import { MessageBus } from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ProviderManager } from '../../ProviderManager.js';
import type { IProvider } from '../../IProvider.js';
import type { IsolatedRuntimeContextHandle } from '../runtimeSettings.js';
import {
  createIsolatedRuntimeContext,
  activateIsolatedRuntimeContext,
  resetCliProviderInfrastructure,
} from '../runtimeSettings.js';

/**
 * A real, minimal IProvider registered onto the fixture manager so that T3 can
 * observe the adopted manager's state (listProviders / getActiveProviderName)
 * through the handle WITHOUT standing up a live network provider.
 */
class StubAdoptedProvider implements IProvider {
  readonly name = 'p04-adopted-stub';
  async getModels(): Promise<never[]> {
    return [];
  }
  getDefaultModel(): string {
    return 'p04-adopted-default';
  }
  async *generateChatCompletion(): AsyncIterableIterator<never> {
    // intentionally empty — never driven in these tests
  }
  getServerTools(): string[] {
    return [];
  }
  async invokeServerTool(): Promise<unknown> {
    return undefined;
  }
}

/** Builds a real ProviderManager the way the providers test suite bootstraps one. */
function buildRealManager(): ProviderManager {
  const settingsService = new SettingsService();
  const config = createRuntimeConfigStub(settingsService);
  return new ProviderManager({ settingsService, config });
}

/** Builds a manager that already has a registered+active provider (for T3). */
function buildSeededManager(): {
  manager: ProviderManager;
  settingsService: SettingsService;
  config: Config;
  provider: StubAdoptedProvider;
} {
  const settingsService = new SettingsService();
  const config = createRuntimeConfigStub(settingsService);
  const manager = new ProviderManager({ settingsService, config });
  const provider = new StubAdoptedProvider();
  manager.registerProvider(provider);
  settingsService.set('activeProvider', provider.name);
  manager.setActiveProvider(provider.name);
  return { manager, settingsService, config, provider };
}

/**
 * Counts real ProviderManager constructions WITHOUT replacing the constructor.
 * The spy wraps the original so the real object is still built; we only tally
 * invocations as a numeric count (asserted with `toBe`, never via the banned
 * call-count matcher).
 */
function trackProviderManagerConstructions(): {
  count: () => number;
  restore: () => void;
} {
  let n = 0;
  // Capture the real prototype method BEFORE installing the spy so the wrapper
  // can delegate to it (a fresh vi.spyOn exposes no mockImplementation yet).
  const proto = ProviderManager.prototype as unknown as Record<string, unknown>;
  const method = 'resolveInit';
  const original = proto[method] as (...a: unknown[]) => unknown;
  const spy = vi.spyOn(
    ProviderManager.prototype,
    method as keyof ProviderManager,
  );
  spy.mockImplementation(function (this: unknown, ...args: unknown[]) {
    n += 1;
    return original.apply(this, args);
  });
  return {
    count: () => n,
    restore: () => spy.mockRestore(),
  };
}

describe('runtime context providerManager adoption seam (P04 RED) @plan:PLAN-20260621-COREAPIREMED.P04 @requirement:REQ-005.2', () => {
  beforeEach(() => {
    resetCliProviderInfrastructure();
  });

  afterEach(async () => {
    resetCliProviderInfrastructure();
    vi.restoreAllMocks();
  });

  /**
   * @requirement:REQ-005.2
   * @scenario: supplied manager is adopted verbatim
   * @given a real ProviderManager `pm`
   * @when createIsolatedRuntimeContext({ providerManager: pm }) resolves
   * @then handle.providerManager === pm (instance identity)
   *
   * LOAD-BEARING RED (CRIT-2): the P03 stub builds a fresh manager
   * unconditionally, so this assertion FAILS until P05 adds the `??` adoption.
   */
  it('IDENTITY — providerManager: pm yields handle.providerManager === pm', async () => {
    const pm = buildRealManager();
    const handle: IsolatedRuntimeContextHandle = createIsolatedRuntimeContext({
      runtimeId: 'p04-pm-identity',
      workspaceDir: process.cwd(),
      model: 'p04-identity-model',
      providerManager: pm,
      prepare: async () => {},
    });

    try {
      expect(handle.providerManager).toBe(pm);
    } finally {
      await handle.cleanup();
    }
  });

  /**
   * @requirement:REQ-005.2
   * @scenario: omitted manager falls back to a fresh construction
   * @given no providerManager option
   * @when createIsolatedRuntimeContext resolves
   * @then handle.providerManager is a freshly built manager !== any caller-held pm
   *
   * Legitimately GREEN now (current default-path behavior).
   */
  it('DEFAULT — omitting providerManager yields a fresh manager !== a caller-held pm', async () => {
    const callerHeld = buildRealManager();
    const handle: IsolatedRuntimeContextHandle = createIsolatedRuntimeContext({
      runtimeId: 'p04-pm-default',
      workspaceDir: process.cwd(),
      model: 'p04-default-model',
      prepare: async () => {},
    });

    try {
      expect(handle.providerManager).toBeDefined();
      expect(handle.providerManager).not.toBe(callerHeld);
    } finally {
      await handle.cleanup();
    }
  });

  /**
   * @requirement:REQ-005.2
   * @scenario: activation resolves through the adopted manager
   * @given a seeded manager `pm` with one registered+active provider
   * @when createIsolatedRuntimeContext({ providerManager: pm }) then activate
   * @then the handle's manager IS pm AND exposes pm's seeded provider state
   *
   * RED until P05: identity mismatch first, and even if identity held the
   * seeded provider would not be visible through a divergent fresh manager.
   */
  it('ADOPTED ACTIVATION — after activate, the handle resolves the adopted manager and its provider state', async () => {
    const { manager: pm, provider } = buildSeededManager();
    const handle: IsolatedRuntimeContextHandle = createIsolatedRuntimeContext({
      runtimeId: 'p04-pm-adopted-activation',
      workspaceDir: process.cwd(),
      model: 'p04-adopted-model',
      providerManager: pm,
      prepare: async () => {},
    });

    try {
      await activateIsolatedRuntimeContext(handle, {
        runtimeId: handle.runtimeId,
        metadata: { source: 'p04-adopted-activation' },
      });

      // identity first
      expect(handle.providerManager).toBe(pm);
      // then observe resolved provider state THROUGH the handle's manager
      expect(handle.providerManager.listProviders()).toStrictEqual([
        provider.name,
      ]);
      expect(handle.providerManager.getActiveProviderName()).toBe(
        provider.name,
      );
    } finally {
      await handle.cleanup();
    }
  });

  /**
   * @requirement:REQ-005.2
   * @scenario: supplying a manager constructs no additional ProviderManager
   * @given a real ProviderManager `pm` and a construction counter
   * @when createIsolatedRuntimeContext({ providerManager: pm }) resolves
   * @then exactly zero additional ProviderManagers were constructed
   *
   * RED until P05: the factory unconditionally constructs one. Numeric
   * count assertion only (never the banned call-count matcher).
   */
  it('NO SECOND CONSTRUCTION — supplying providerManager constructs zero new managers', async () => {
    const pm = buildRealManager();
    const tracker = trackProviderManagerConstructions();

    const handle: IsolatedRuntimeContextHandle = createIsolatedRuntimeContext({
      runtimeId: 'p04-pm-no-second',
      workspaceDir: process.cwd(),
      model: 'p04-no-second-model',
      providerManager: pm,
      prepare: async () => {},
    });

    try {
      expect(tracker.count()).toBe(0);
      // identity implies the same: the supplied manager survived unchanged
      expect(handle.providerManager).toBe(pm);
    } finally {
      await handle.cleanup();
      tracker.restore();
    }
  });

  /**
   * @requirement:REQ-005.2, REQ-001
   * @scenario: messageBus and providerManager adoption seams are independent
   * @given a real MessageBus and a real ProviderManager
   * @when createIsolatedRuntimeContext({ messageBus, providerManager }) resolves
   * @then handle.providerManager === pm (the providers seam honors its input)
   *
   * RED until P05 on the providerManager half (identity mismatch).
   */
  it('INDEPENDENT SEAMS — messageBus and providerManager adoption compose', async () => {
    const providedBus = new MessageBus(undefined, false);
    const pm = buildRealManager();
    const handle: IsolatedRuntimeContextHandle = createIsolatedRuntimeContext({
      runtimeId: 'p04-pm-independent',
      workspaceDir: process.cwd(),
      model: 'p04-independent-model',
      messageBus: providedBus,
      providerManager: pm,
      prepare: async () => {},
    });

    try {
      expect(handle.providerManager).toBe(pm);
    } finally {
      await handle.cleanup();
    }
  });

  /**
   * @requirement:REQ-005.2
   * @scenario: cleanup neither disposes the manager nor breaks the onCleanup contract
   * @given a real ProviderManager `pm` and an onCleanup capturing the manager
   * @when createIsolatedRuntimeContext({ providerManager: pm, onCleanup }) then cleanup
   * @then onCleanup received the SAME manager activation used, and cleanup did
   *       NOT force-dispose it (no disposal is wired in the shipped closure at
   *       runtimeContextFactory.ts:400-447 — verified)
   *
   * RED half: "onCleanup receives the ADOPTED manager" fails until P05 (the
   * closure passes the freshly-built manager, not `pm`). The no-disposal half
   * is true today and is asserted as a behavioral contract.
   */
  it('CLEANUP CONTRACT — onCleanup receives the adopted manager and cleanup disposes neither manager', async () => {
    const pm = buildRealManager();
    let captured: { providerManager: unknown } | undefined;
    const handle: IsolatedRuntimeContextHandle = createIsolatedRuntimeContext({
      runtimeId: 'p04-pm-cleanup',
      workspaceDir: process.cwd(),
      model: 'p04-cleanup-model',
      providerManager: pm,
      prepare: async () => {},
      onCleanup: (ctx) => {
        captured = { providerManager: ctx.providerManager };
      },
    });

    const disposeBefore = (pm as unknown as { disposed?: boolean }).disposed;

    try {
      await activateIsolatedRuntimeContext(handle, {
        runtimeId: handle.runtimeId,
        metadata: { source: 'p04-cleanup' },
      });
      await handle.cleanup();

      // onCleanup received the SAME manager the caller supplied
      expect(captured).toBeDefined();
      expect(captured?.providerManager).toBe(pm);
      // cleanup introduced no disposal on either manager
      const disposeAfter = (pm as unknown as { disposed?: boolean }).disposed;
      expect(disposeAfter).toBe(disposeBefore);
      expect(disposeAfter).toBeUndefined();
    } finally {
      // ensure cleanup ran even if an assertion threw
      if (captured === undefined) {
        await handle.cleanup().catch(() => undefined);
      }
    }
  });

  /**
   * @requirement:REQ-005.2
   * @scenario: any supplied manager is adopted verbatim (property)
   * @given arbitrary runtimeId strings and a real ProviderManager
   * @when createIsolatedRuntimeContext({ providerManager: pm }) resolves
   * @then handle.providerManager === pm for every generated input
   */
  it('PROP — for any runtimeId, a supplied providerManager is adopted verbatim', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 32 })
          .filter((s) => !s.includes('\0')),
        async (runtimeId: string) => {
          const pm = buildRealManager();
          const handle: IsolatedRuntimeContextHandle =
            createIsolatedRuntimeContext({
              runtimeId: `p04-prop-${runtimeId}`,
              workspaceDir: process.cwd(),
              model: 'p04-prop-model',
              providerManager: pm,
              prepare: async () => {},
            });

          try {
            expect(handle.providerManager).toBe(pm);
            return true;
          } finally {
            await handle.cleanup();
          }
        },
      ),
    );
  });

  /**
   * @requirement:REQ-005.2
   * @scenario: adoption never leaks across calls when omitted (property)
   * @given arbitrary runtimeId strings and a caller-held manager
   * @when createIsolatedRuntimeContext (NO providerManager option) resolves
   * @then handle.providerManager !== callerHeld for every generated input
   */
  it('PROP — omitting providerManager never adopts a caller-held manager', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 32 })
          .filter((s) => !s.includes('\0')),
        async (runtimeId: string) => {
          const callerHeld = buildRealManager();
          const handle: IsolatedRuntimeContextHandle =
            createIsolatedRuntimeContext({
              runtimeId: `p04-prop-omit-${runtimeId}`,
              workspaceDir: process.cwd(),
              model: 'p04-prop-omit-model',
              prepare: async () => {},
            });

          try {
            expect(handle.providerManager).not.toBe(callerHeld);
            return true;
          } finally {
            await handle.cleanup();
          }
        },
      ),
    );
  });

  /**
   * @requirement:REQ-005.2
   * @scenario: supplied manager stays identity-stable across arbitrary models (property)
   * @given arbitrary model identifiers and a real ProviderManager
   * @when createIsolatedRuntimeContext({ providerManager: pm, model }) resolves
   * @then handle.providerManager === pm regardless of the model string
   */
  it('PROP — a supplied providerManager is adopted regardless of the model option', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[a-zA-Z0-9_-]{1,32}$/),
        async (model: string) => {
          const pm = buildRealManager();
          const handle: IsolatedRuntimeContextHandle =
            createIsolatedRuntimeContext({
              runtimeId: 'p04-prop-model-var',
              workspaceDir: process.cwd(),
              model,
              providerManager: pm,
              prepare: async () => {},
            });

          try {
            expect(handle.providerManager).toBe(pm);
            return true;
          } finally {
            await handle.cleanup();
          }
        },
      ),
    );
  });

  /**
   * @requirement:REQ-005.2
   * @scenario: default path always yields a distinct fresh manager (property)
   * @given two independent calls omitting providerManager
   * @when both handles resolve
   * @then their managers are distinct objects (no cross-call leak)
   */
  it('PROP — two default-path calls yield distinct fresh managers', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[a-zA-Z0-9_-]{1,16}$/),
        fc.stringMatching(/^[a-zA-Z0-9_-]{1,16}$/),
        async (idA: string, idB: string) => {
          const handleA: IsolatedRuntimeContextHandle =
            createIsolatedRuntimeContext({
              runtimeId: `p04-prop-distinct-${idA}`,
              workspaceDir: process.cwd(),
              model: 'p04-prop-distinct',
              prepare: async () => {},
            });
          const handleB: IsolatedRuntimeContextHandle =
            createIsolatedRuntimeContext({
              runtimeId: `p04-prop-distinct-${idB}`,
              workspaceDir: process.cwd(),
              model: 'p04-prop-distinct',
              prepare: async () => {},
            });

          try {
            expect(handleA.providerManager).not.toBe(handleB.providerManager);
            expect(handleA.providerManager).toBeDefined();
            expect(handleB.providerManager).toBeDefined();
            return true;
          } finally {
            await handleA.cleanup();
            await handleB.cleanup();
          }
        },
      ),
    );
  });
});
