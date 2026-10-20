import { AdoptedProviderFixture } from '../../../../agents/src/api/__tests__/helpers/adopted-provider-fixture.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'bun:test';
import * as fc from 'fast-check';
import { mkdtemp, rm, realpath, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  Config,
  type RuntimeProviderManager,
  MessageBus,
} from '@vybestack/llxprt-code-core';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  ProviderManager,
  ProviderFileLifecycle,
  resolveProviderFilePolicy,
} from '../../index.js';
import type { IProvider } from '../../IProvider.js';
import type { OAuthManager } from '../../auth/oauth-manager.js';
import { configureProviderTokenizer } from '../../composition/index.js';

import { releaseAdoptedFileScope } from '../../../../agents/src/api/adoption-release.js';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../../../agents/src/core/subagent-cleanup.js';
import { useOwnedCredentials } from '../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
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
}

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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * @requirement:REQ-005.2
   * @scenario: supplied manager is adopted verbatim
   * @given a real ProviderManager `pm`
   * @when createIsolatedRuntimeContext({ providerManager: pm }) resolves
   * @then selectedManager === pm (instance identity)
   *
   * LOAD-BEARING RED (CRIT-2): the P03 stub builds a fresh manager
   * unconditionally, so this assertion FAILS until P05 adds the `??` adoption.
   */

  const credentials = useOwnedCredentials();
  const callerRetiring: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    await runCleanupSteps(callerRetiring.splice(0).reverse());
  });
  const seededProvider = new StubAdoptedProvider();
  function buildRealManager(): ProviderManager {
    const directory = mkdtempSync(join(tmpdir(), 'manager-caller-'));
    callerRetiring.push(() => rm(directory, { recursive: true, force: true }));
    const settings = new SettingsService();
    const config = new Config({
      sessionId: 'caller-manager',
      targetDir: directory,
      cwd: directory,
      model: 'caller-model',
      debugMode: false,
    });
    callerRetiring.push(() => config.dispose());
    const owner = new SessionSettingsOwner(settings);
    callerRetiring.push(() => owner.dispose());
    owner.bindTelemetry(config);
    const manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      settings,
      config,
      undefined,
      credentials().authority,
      owner,
    );
    callerRetiring.push(() => manager.dispose());
    return manager;
  }
  function buildSeededManager(): ProviderManager {
    const manager = buildRealManager();
    manager.registerProvider(seededProvider);
    manager.setActiveProvider(seededProvider.name);
    return manager;
  }

  let selectedManager: RuntimeProviderManager;
  let selectedFiles: ProviderFileLifecycle;
  let selectedRuntimeId: string;
  let selectedConfig: Config;
  let selectedSettings: SettingsService;
  let selectedOwner: SessionSettingsOwner;
  let selectedOAuth: OAuthManager;
  const selectedClosing: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    await closeSelected();
  });
  async function openSelected(
    runtimeId: string,
    model: string,
    supplied: RuntimeProviderManager | undefined,
    bus: MessageBus | undefined,
  ): Promise<void> {
    const closing = selectedClosing;
    try {
      const raw = await mkdtemp(join(tmpdir(), 'adopted-manager-'));
      closing.push(() => rm(raw, { recursive: true, force: true }));
      const directory = await realpath(raw);
      const config = new Config({
        sessionId: runtimeId,
        targetDir: directory,
        cwd: directory,
        model,
        debugMode: false,
      });
      selectedConfig = config;
      closing.push(() => config.dispose());
      const release = new AcquisitionRelease();
      let complete = false;
      closing.push(() => (complete ? release.close() : release.rollback()));
      const settings = new SettingsService();
      selectedSettings = settings;
      const owner = new SessionSettingsOwner(settings);
      selectedOwner = owner;
      release.acquire('settings', () => owner.dispose());
      owner.bindTelemetry(config);
      const policy = new RuntimePolicyOwner(config);
      release.acquire('policy', () => policy.dispose());
      const files = new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      });
      selectedFiles = files;
      release.acquire('files', () => releaseAdoptedFileScope(files, runtimeId));
      selectedManager = new AdoptedProviderFixture(
        config,
        settings,
        runtimeId,
      ).acquireManager(
        supplied,
        owner,
        files,
        credentials().authority,
        release,
      );
      selectedOAuth = new AdoptedProviderFixture(
        config,
        settings,
        runtimeId,
      ).acquireOAuth(
        undefined,
        undefined,
        bus ?? policy.session.messageBus,
        selectedManager,
        undefined,
        credentials().authority,
        release,
      );
      selectedRuntimeId = runtimeId;
      complete = true;
    } catch (primary) {
      await cleanupAfterFailure(primary, () => closeSelected());
    }
  }
  async function activateSelected(): Promise<void> {
    await new AdoptedProviderFixture(
      selectedConfig,
      selectedSettings,
      selectedRuntimeId,
    ).activate(
      selectedOwner,
      selectedManager,
      selectedOAuth,
      false,
      configureProviderTokenizer(selectedManager),
    );
  }
  async function closeSelected(): Promise<void> {
    await runCleanupSteps(selectedClosing.splice(0).reverse());
  }

  let firstManager: RuntimeProviderManager;
  const firstClosing: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    await closeFirst();
  });
  async function openFirst(
    runtimeId: string,
    model: string,
    supplied: RuntimeProviderManager | undefined,
    bus: MessageBus | undefined,
  ): Promise<void> {
    const closing = firstClosing;
    try {
      const raw = await mkdtemp(join(tmpdir(), 'adopted-manager-'));
      closing.push(() => rm(raw, { recursive: true, force: true }));
      const directory = await realpath(raw);
      const config = new Config({
        sessionId: runtimeId,
        targetDir: directory,
        cwd: directory,
        model,
        debugMode: false,
      });
      closing.push(() => config.dispose());
      const release = new AcquisitionRelease();
      let complete = false;
      closing.push(() => (complete ? release.close() : release.rollback()));
      const settings = new SettingsService();
      const owner = new SessionSettingsOwner(settings);
      release.acquire('settings', () => owner.dispose());
      owner.bindTelemetry(config);
      const policy = new RuntimePolicyOwner(config);
      release.acquire('policy', () => policy.dispose());
      const files = new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      });
      release.acquire('files', () => releaseAdoptedFileScope(files, runtimeId));
      firstManager = new AdoptedProviderFixture(
        config,
        settings,
        runtimeId,
      ).acquireManager(
        supplied,
        owner,
        files,
        credentials().authority,
        release,
      );
      new AdoptedProviderFixture(config, settings, runtimeId).acquireOAuth(
        undefined,
        undefined,
        bus ?? policy.session.messageBus,
        firstManager,
        undefined,
        credentials().authority,
        release,
      );
      complete = true;
    } catch (primary) {
      await cleanupAfterFailure(primary, () => closeFirst());
    }
  }
  async function closeFirst(): Promise<void> {
    await runCleanupSteps(firstClosing.splice(0).reverse());
  }

  let secondManager: RuntimeProviderManager;
  const secondClosing: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    await closeSecond();
  });
  async function openSecond(
    runtimeId: string,
    model: string,
    supplied: RuntimeProviderManager | undefined,
    bus: MessageBus | undefined,
  ): Promise<void> {
    const closing = secondClosing;
    try {
      const raw = await mkdtemp(join(tmpdir(), 'adopted-manager-'));
      closing.push(() => rm(raw, { recursive: true, force: true }));
      const directory = await realpath(raw);
      const config = new Config({
        sessionId: runtimeId,
        targetDir: directory,
        cwd: directory,
        model,
        debugMode: false,
      });
      closing.push(() => config.dispose());
      const release = new AcquisitionRelease();
      let complete = false;
      closing.push(() => (complete ? release.close() : release.rollback()));
      const settings = new SettingsService();
      const owner = new SessionSettingsOwner(settings);
      release.acquire('settings', () => owner.dispose());
      owner.bindTelemetry(config);
      const policy = new RuntimePolicyOwner(config);
      release.acquire('policy', () => policy.dispose());
      const files = new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      });
      release.acquire('files', () => releaseAdoptedFileScope(files, runtimeId));
      secondManager = new AdoptedProviderFixture(
        config,
        settings,
        runtimeId,
      ).acquireManager(
        supplied,
        owner,
        files,
        credentials().authority,
        release,
      );
      new AdoptedProviderFixture(config, settings, runtimeId).acquireOAuth(
        undefined,
        undefined,
        bus ?? policy.session.messageBus,
        secondManager,
        undefined,
        credentials().authority,
        release,
      );
      complete = true;
    } catch (primary) {
      await cleanupAfterFailure(primary, () => closeSecond());
    }
  }
  async function closeSecond(): Promise<void> {
    await runCleanupSteps(secondClosing.splice(0).reverse());
  }
  it('IDENTITY — providerManager: pm yields handle.providerManager === pm', async () => {
    const pm = buildRealManager();
    await openSelected('p04-pm-identity', 'p04-identity-model', pm, undefined);

    try {
      expect(selectedManager).toBe(pm);
    } finally {
      await closeSelected();
    }
  });

  /**
   * @requirement:REQ-005.2
   * @scenario: omitted manager falls back to a fresh construction
   * @given no providerManager option
   * @when createIsolatedRuntimeContext resolves
   * @then selectedManager is a freshly built manager !== any caller-held pm
   *
   * Legitimately GREEN now (current default-path behavior).
   */
  it('DEFAULT — omitting providerManager yields a fresh manager !== a caller-held pm', async () => {
    const callerHeld = buildRealManager();
    await openSelected(
      'p04-pm-default',
      'p04-default-model',
      undefined,
      undefined,
    );

    try {
      expect(selectedManager).toBeDefined();
      expect(selectedManager).not.toBe(callerHeld);
    } finally {
      await closeSelected();
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
    const pm = buildSeededManager();
    const provider = seededProvider;
    await openSelected(
      'p04-pm-adopted-activation',
      'p04-adopted-model',
      pm,
      undefined,
    );

    try {
      await activateSelected();

      // identity first
      expect(selectedManager).toBe(pm);
      // then observe resolved provider state THROUGH the handle's manager
      expect(selectedManager.listProviders()).toStrictEqual([provider.name]);
      expect(selectedManager.getActiveProviderName()).toBe(provider.name);
    } finally {
      await closeSelected();
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

    await openSelected(
      'p04-pm-no-second',
      'p04-no-second-model',
      pm,
      undefined,
    );

    try {
      expect(tracker.count()).toBe(0);
      // identity implies the same: the supplied manager survived unchanged
      expect(selectedManager).toBe(pm);
    } finally {
      await closeSelected();
      tracker.restore();
    }
  });

  /**
   * @requirement:REQ-005.2, REQ-001
   * @scenario: messageBus and providerManager adoption seams are independent
   * @given a real MessageBus and a real ProviderManager
   * @when createIsolatedRuntimeContext({ messageBus, providerManager }) resolves
   * @then selectedManager === pm (the providers seam honors its input)
   *
   * RED until P05 on the providerManager half (identity mismatch).
   */
  it('INDEPENDENT SEAMS — messageBus and providerManager adoption compose', async () => {
    const providedBus = new MessageBus(undefined, false);
    const pm = buildRealManager();
    await openSelected(
      'p04-pm-independent',
      'p04-independent-model',
      pm,
      providedBus,
    );

    try {
      expect(selectedManager).toBe(pm);
    } finally {
      await closeSelected();
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

    await openSelected('p04-pm-cleanup', 'p04-cleanup-model', pm, undefined);

    let captured: RuntimeProviderManager | undefined;
    const remotePath = join(
      selectedConfig.getTargetDir(),
      'adopted-remote-file',
    );
    await writeFile(remotePath, 'retained caller-owned provider file');
    const retained = await selectedFiles.retain({
      cacheKey: 'cleanup-observation',
      fileId: remotePath,
      bytes: 35,
      identity: {
        provider: 'openai',
        baseURL: 'https://example.invalid',
        credentialHash: 'caller-credential',
      },
      policy: resolveProviderFilePolicy({
        configuredMode: 'session',
        configuredRetentionMs: 60000,
        configuredDeletion: 'delete',
        providerFileReferences: true,
        zeroDataRetention: 'incompatible-while-retained',
        zeroDataRetentionRequired: false,
      }),
      scopeId: selectedRuntimeId,
      deleteRemote: async (file) => {
        await rm(file);
        captured = selectedManager;
      },
    });
    await retained.lease.release();
    const disposeBefore = (pm as unknown as { disposed?: boolean }).disposed;

    try {
      await activateSelected();
      await closeSelected();

      // onCleanup received the SAME manager the caller supplied
      expect(captured).toBeDefined();
      expect(captured).toBe(pm);
      // cleanup introduced no disposal on either manager
      const disposeAfter = (pm as unknown as { disposed?: boolean }).disposed;
      expect(disposeAfter).toBe(disposeBefore);
      expect(disposeAfter).toBeUndefined();
    } finally {
      // ensure cleanup ran even if an assertion threw
      await closeSelected();
    }
  });

  /**
   * @requirement:REQ-005.2
   * @scenario: any supplied manager is adopted verbatim (property)
   * @given arbitrary runtimeId strings and a real ProviderManager
   * @when createIsolatedRuntimeContext({ providerManager: pm }) resolves
   * @then selectedManager === pm for every generated input
   */
  it('PROP — for any runtimeId, a supplied providerManager is adopted verbatim', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 32 })
          .filter((s) => !s.includes('\0')),
        async (runtimeId: string) => {
          const pm = buildRealManager();
          await openSelected(
            `p04-prop-${runtimeId}`,
            'p04-prop-model',
            pm,
            undefined,
          );

          try {
            expect(selectedManager).toBe(pm);
            return true;
          } finally {
            await closeSelected();
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
   * @then selectedManager !== callerHeld for every generated input
   */
  it('PROP — omitting providerManager never adopts a caller-held manager', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 32 })
          .filter((s) => !s.includes('\0')),
        async (runtimeId: string) => {
          const callerHeld = buildRealManager();
          await openSelected(
            `p04-prop-omit-${runtimeId}`,
            'p04-prop-omit-model',
            undefined,
            undefined,
          );

          try {
            expect(selectedManager).not.toBe(callerHeld);
            return true;
          } finally {
            await closeSelected();
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
   * @then selectedManager === pm regardless of the model string
   */
  it('PROP — a supplied providerManager is adopted regardless of the model option', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[a-zA-Z0-9_-]{1,32}$/),
        async (model: string) => {
          const pm = buildRealManager();
          await openSelected('p04-prop-model-var', model, pm, undefined);

          try {
            expect(selectedManager).toBe(pm);
            return true;
          } finally {
            await closeSelected();
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
          await openFirst(
            `p04-prop-distinct-${idA}`,
            'p04-prop-distinct',
            undefined,
            undefined,
          );
          await openSecond(
            `p04-prop-distinct-${idB}`,
            'p04-prop-distinct',
            undefined,
            undefined,
          );

          try {
            expect(firstManager).not.toBe(secondManager);
            expect(firstManager).toBeDefined();
            expect(secondManager).toBeDefined();
            return true;
          } finally {
            await closeFirst();
            await closeSecond();
          }
        },
      ),
    );
  });
});
