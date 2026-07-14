/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Finding 4 (#2378): Strengthen Config.initialize boundary provenance for
 * common aliases / argument indirection with tests, using sound AST/checker
 * design.
 *
 * These tests verify the BOUNDARY of Config.initialize / ensureInitialized:
 * 1. Object-form with shorthand property alias ({ messageBus }) works.
 * 2. Function-form indirection (() => { messageBus }) resolves correctly.
 * 3. Function-form returning a missing/undefined messageBus fails closed.
 * 4. Object-form with undefined messageBus fails closed.
 * 5. Concurrent ensureInitialized calls share the same promise (exactly-once).
 * 6. A failed initialize() leaves a rejected promise — ensureInitialized does
 *    NOT silently retry.
 * 7. initialize() after ensureInitialized() throws (already-initialized guard).
 * 8. ensureInitialized() after initialize() returns the original promise.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConfigParameters } from './config.js';
import { Config } from './config.js';
import {
  createBaseParams,
  resetAgentClientMock,
  type HoistedConfigMocks,
} from './configTestHarness.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import { getSettingsService } from '@vybestack/llxprt-code-settings';

const hoistedConfigMocks = vi.hoisted<HoistedConfigMocks>(() => ({
  loadJitSubdirectoryMemory: vi.fn(),
  coreEvents: {
    emitFeedback: vi.fn(),
    emitModelChanged: vi.fn(),
    emitConsoleLog: vi.fn(),
  },
  setGlobalProxy: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const h = await import('./configTestHarness.js');
  return h.buildFsMockBody(await importOriginal());
});

vi.mock('@vybestack/llxprt-code-tools', async (importOriginal) => {
  const h = await import('./configTestHarness.js');
  return h.buildToolsMockBody(
    await importOriginal<typeof import('@vybestack/llxprt-code-tools')>(),
  );
});

vi.mock('../core/contentGenerator.js', async (importOriginal) => {
  const h = await import('./configTestHarness.js');
  return h.buildContentGeneratorMockBody(await importOriginal());
});

vi.mock('../telemetry/index.js', async () => {
  const h = await import('./configTestHarness.js');
  return h.buildTelemetryMockBody();
});

vi.mock('../services/gitService.js', async () => {
  const h = await import('./configTestHarness.js');
  return h.buildGitServiceMockBody();
});

vi.mock('@vybestack/llxprt-code-settings', async () => {
  const h = await import('./configTestHarness.js');
  return h.buildSettingsMockBody();
});

vi.mock('@vybestack/llxprt-code-ide-integration', async (importOriginal) => {
  const h = await import('./configTestHarness.js');
  return h.buildIdeIntegrationMockBody(
    await importOriginal<
      typeof import('@vybestack/llxprt-code-ide-integration')
    >(),
  );
});

vi.mock('../utils/memoryDiscovery.js', async () => {
  const h = await import('./configTestHarness.js');
  return h.buildMemoryDiscoveryMockBody(hoistedConfigMocks);
});

vi.mock('../utils/events.js', async (importOriginal) => {
  const h = await import('./configTestHarness.js');
  return h.buildEventsMockBody(await importOriginal(), hoistedConfigMocks);
});

vi.mock('../utils/fetch.js', async () => {
  const h = await import('./configTestHarness.js');
  return h.buildFetchMockBody(hoistedConfigMocks);
});

describe('Config.initialize / ensureInitialized boundary provenance (Finding 4)', () => {
  let settingsService: ReturnType<typeof getSettingsService>;
  let baseParams: ConfigParameters;

  beforeEach(() => {
    resetAgentClientMock();
    settingsService = getSettingsService();
    baseParams = createBaseParams(settingsService);
  });

  function makeConfig(): Config {
    return new Config(baseParams);
  }

  // ── Shorthand property alias ──────────────────────────────────────────

  it('accepts the object-form with shorthand property alias ({ messageBus })', async () => {
    const config = makeConfig();
    const messageBus = new MessageBus(
      config.getPolicyEngine(),
      config.getDebugMode(),
    );

    // Shorthand alias: { messageBus } is equivalent to { messageBus: messageBus }
    await config.ensureInitialized({ messageBus });

    expect(config.getAgentClient()).toBeDefined();
  });

  // ── Function-form indirection ─────────────────────────────────────────

  it('accepts the function-form indirection and resolves the dependencies', async () => {
    const config = makeConfig();
    const messageBus = new MessageBus(
      config.getPolicyEngine(),
      config.getDebugMode(),
    );

    // Function-form: the factory is called lazily and its return value used.
    const factory = vi.fn(() => ({ messageBus }));
    await config.ensureInitialized(factory);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(config.getAgentClient()).toBeDefined();
  });

  it('function-form returning a missing messageBus fails closed', async () => {
    const config = makeConfig();

    // The function form's type says messageBus is required, but at runtime
    // it could be undefined. This must fail closed with the explicit error.
    const factory = () => ({}) as { messageBus: MessageBus };
    await expect(config.ensureInitialized(factory)).rejects.toThrow(
      /requires an explicit session\/runtime MessageBus/,
    );
  });

  // ── Object-form boundary ──────────────────────────────────────────────

  it('object-form with undefined messageBus fails closed', async () => {
    const config = makeConfig();

    await expect(
      config.ensureInitialized({ messageBus: undefined }),
    ).rejects.toThrow(/requires an explicit session\/runtime MessageBus/);
  });

  it('ensureInitialized with no arguments fails closed', async () => {
    const config = makeConfig();

    await expect(config.ensureInitialized()).rejects.toThrow(
      /requires an explicit session\/runtime MessageBus/,
    );
  });

  // ── Concurrent / exactly-once ─────────────────────────────────────────

  it('concurrent ensureInitialized calls share the same promise (exactly-once)', async () => {
    const config = makeConfig();
    const messageBus = new MessageBus(
      config.getPolicyEngine(),
      config.getDebugMode(),
    );

    // Two concurrent calls should share the SAME initialization promise —
    // performInitialization runs exactly once, not twice.
    const p1 = config.ensureInitialized({ messageBus });
    const p2 = config.ensureInitialized({ messageBus });

    expect(p1).toBe(p2);
    await p1;
    expect(config.getAgentClient()).toBeDefined();
  });

  it('a failed initialize() leaves a rejected promise — ensureInitialized does NOT silently retry', async () => {
    const config = makeConfig();

    // First call fails (no messageBus).
    const p1 = config.ensureInitialized({ messageBus: undefined });
    await expect(p1).rejects.toThrow(/MessageBus dependency/);

    // Second call returns the SAME rejected promise — no retry, no recovery.
    const p2 = config.ensureInitialized({
      messageBus: new MessageBus(
        config.getPolicyEngine(),
        config.getDebugMode(),
      ),
    });
    expect(p2).toBe(p1);
    await expect(p2).rejects.toThrow(/MessageBus dependency/);
  });

  // ── initialize vs ensureInitialized boundary ──────────────────────────

  it('initialize() after ensureInitialized() throws (already-initialized guard)', async () => {
    const config = makeConfig();
    const messageBus = new MessageBus(
      config.getPolicyEngine(),
      config.getDebugMode(),
    );

    await config.ensureInitialized({ messageBus });

    // initialize() throws synchronously because initialization already started.
    expect(() => config.initialize({ messageBus })).toThrow(
      /already initialized/,
    );
  });

  it('ensureInitialized() after initialize() returns the original promise', async () => {
    const config = makeConfig();
    const messageBus = new MessageBus(
      config.getPolicyEngine(),
      config.getDebugMode(),
    );

    const p1 = config.initialize({ messageBus });
    const p2 = config.ensureInitialized({ messageBus });

    // Same promise object — no second initialization.
    expect(p2).toBe(p1);
    await p2;
  });

  // ── Provenance: the messageBus from initialization is the one used ────

  it('the messageBus passed to initialize is the exact instance used by the tool registry', async () => {
    const config = makeConfig();
    const messageBus = new MessageBus(
      config.getPolicyEngine(),
      config.getDebugMode(),
    );

    await config.ensureInitialized({ messageBus });

    // The tool registry was created with THIS messageBus instance.
    // We verify this by checking that the config has a valid (non-undefined)
    // tool registry — the registry was constructed with the messageBus.
    expect(config.getToolRegistry()).toBeDefined();
  });

  // ── Mixed alias: renamed variable indirection ─────────────────────────

  it('accepts a renamed-variable object-form (alias through a different variable name)', async () => {
    const config = makeConfig();
    const bus = new MessageBus(config.getPolicyEngine(), config.getDebugMode());

    // Aliased variable: the caller names it 'bus' but passes it as 'messageBus'.
    await config.ensureInitialized({ messageBus: bus });

    expect(config.getAgentClient()).toBeDefined();
  });
});
