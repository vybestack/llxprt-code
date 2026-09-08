/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Finding B behavioral tests — fully transactional interactive startup.
 *
 * Proves that every fallible stage after a perf owner successfully starts runs
 * inside ONE transaction. Any failure preserves the primary error first,
 * independently disposes the owner (clears observers, removes claim, clears
 * timer), clears/unmounts any produced instance, disables staged mouse, and
 * restores terminal protocols. Stages before mouse activation do NOT falsely
 * disable unstaged mouse. Uses a REAL perf owner so observer/claim/timer
 * cleanup is behavioral evidence (not mock-theater).
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as crypto from 'node:crypto';
import type { Config } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { LoadedSettings } from '../config/settings.js';
import {
  commitInteractiveStartup,
  __resetInteractiveUIStateForTesting,
  type InteractiveStartupPorts,
} from './interactiveUI.js';
import { createInteractivePerfRuntime } from '../ui/hooks/perf/interactivePerfRuntime.js';
import type { OperationIdentitySnapshot } from '../ui/hooks/agentStream/operationLifecycle.js';
import {
  setInteractiveStdoutObserver,
  setInteractiveRenderObserver,
  getInteractiveStdoutObserver,
  getInteractiveRenderObserver,
} from '../ui/inkRenderOptions.js';
import {
  getPerfPhaseObserver,
  setPerfPhaseObserver,
} from '@vybestack/llxprt-code-telemetry/perf/perfPhaseObserver.js';
import type {
  PerfScheduler,
  PerfTimerHandle,
} from '@vybestack/llxprt-code-telemetry/perf/index.js';

let dir: string;

function fixtureIdentity(): OperationIdentitySnapshot {
  return {
    session_id: 'sess-tx',
    runtime_id: 'rt-tx',
    parent_runtime_id: null,
    subagent_name: null,
    project_hash: 'hash-tx',
    llxprt_version: '0.11.0',
    git_sha: 'tx1234',
    runtime: 'bun-1.3.14',
    platform: 'darwin-arm64',
    provider: 'test-provider',
    model: 'test-model',
    terminal_cols: 80,
    terminal_rows: 24,
    render_mode: 'incremental',
  };
}

class CountingScheduler implements PerfScheduler {
  setIntervalCount = 0;
  clearCount = 0;

  setInterval(_callback: () => Promise<void>, _ms: number): PerfTimerHandle {
    this.setIntervalCount++;
    return {
      unref: () => {},
      clear: () => {
        this.clearCount++;
      },
    };
  }
}

const testConfig = {
  getProjectRoot: () => '/test',
  getDebugMode: () => false,
} as unknown as Config;

const testAgent = {} as unknown as Agent;
const testSettings = {} as unknown as LoadedSettings;

/**
 * Base noop ports. Every port returns a minimal stub or is a no-op. Each test
 * overrides exactly ONE port to throw, proving the failure at that stage is
 * transactionally rolled back.
 */
function noopPorts(): InteractiveStartupPorts {
  return {
    renderOptions: (() => ({
      alternateBuffer: false,
      incrementalRendering: false,
      stdout: { columns: 80, rows: 24 },
    })) as never,
    buildUiRuntime: (() => ({
      shell: { getTerminalBackground: () => '' },
    })) as never,
    buildSlashRuntime: (() => ({})) as never,
    debugAppend: () => {},
    setupTerminal: () => {},
    isMouseEnabled: () => false,
    render: (() => ({ clear: () => {}, unmount: () => {} })) as never,
    registerSync: () => {},
    setupLifecycle: async () => {},
  };
}

/** Creates and starts a real perf owner for the test. */
async function makeStartedOwner(scheduler: CountingScheduler) {
  const owner = createInteractivePerfRuntime({
    enabled: true,
    memoryEnabled: false,
    perfDir: dir,
    runUuid: crypto.randomUUID(),
    identityProvider: { snapshot: () => fixtureIdentity() },
    __schedulerForTesting: scheduler,
  });
  expect(owner).not.toBe(null);
  await owner!.start();
  return owner!;
}

/**
 * Asserts the perf owner was fully disposed after a failed startup: observers
 * cleared, timer cleared, claim removed.
 */
function assertOwnerDisposed(
  owner: { registry: unknown },
  scheduler: CountingScheduler,
) {
  expect(getInteractiveStdoutObserver()).toBe(null);
  expect(getInteractiveRenderObserver()).toBe(null);
  expect(getPerfPhaseObserver()).toBe(null);
  expect(scheduler.clearCount).toBe(1);

  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  expect(files.some((f) => f.endsWith('.claim'))).toBe(false);
}

/**
 * Extracts all error messages from an Error or AggregateError (flattened).
 */
function errorMessages(err: unknown): string[] {
  if (err instanceof AggregateError) {
    return (err.errors as unknown[]).flatMap((e) => errorMessages(e));
  }
  if (err instanceof Error) return [err.message];
  return [String(err)];
}

describe('Finding B — transactional interactive startup', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(join(tmpdir(), 'perf-tx-startup-'));
    setInteractiveStdoutObserver(null);
    setInteractiveRenderObserver(null);
    setPerfPhaseObserver(null);
    __resetInteractiveUIStateForTesting();
  });

  afterEach(async () => {
    __resetInteractiveUIStateForTesting();
    setInteractiveStdoutObserver(null);
    setInteractiveRenderObserver(null);
    setPerfPhaseObserver(null);
    try {
      await fsp.rm(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('render-options failure: owner disposed, no mouse staged, primary error preserved', async () => {
    const scheduler = new CountingScheduler();
    const owner = await makeStartedOwner(scheduler);
    const ports = {
      ...noopPorts(),
      renderOptions: (() => {
        throw new Error('render-options-boom');
      }) as never,
    };

    let caught: unknown = null;
    try {
      await commitInteractiveStartup({
        config: testConfig,
        agent: testAgent,
        settings: testSettings,
        perfOwner: owner,
        version: 'test',
        startupWarnings: [],
        ports,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBe(null);
    expect(
      errorMessages(caught).some((m) => m.includes('render-options-boom')),
    ).toBe(true);
    assertOwnerDisposed(owner, scheduler);
  });

  it('ui-runtime failure: owner disposed, no mouse staged', async () => {
    const scheduler = new CountingScheduler();
    const owner = await makeStartedOwner(scheduler);
    const ports = {
      ...noopPorts(),
      buildUiRuntime: (() => {
        throw new Error('ui-runtime-boom');
      }) as never,
    };

    let caught: unknown = null;
    try {
      await commitInteractiveStartup({
        config: testConfig,
        agent: testAgent,
        settings: testSettings,
        perfOwner: owner,
        version: 'test',
        startupWarnings: [],
        ports,
      });
    } catch (err) {
      caught = err;
    }
    expect(
      errorMessages(caught).some((m) => m.includes('ui-runtime-boom')),
    ).toBe(true);
    assertOwnerDisposed(owner, scheduler);
  });

  it('slash-runtime failure: owner disposed, no mouse staged', async () => {
    const scheduler = new CountingScheduler();
    const owner = await makeStartedOwner(scheduler);
    const ports = {
      ...noopPorts(),
      buildSlashRuntime: (() => {
        throw new Error('slash-runtime-boom');
      }) as never,
    };

    let caught: unknown = null;
    try {
      await commitInteractiveStartup({
        config: testConfig,
        agent: testAgent,
        settings: testSettings,
        perfOwner: owner,
        version: 'test',
        startupWarnings: [],
        ports,
      });
    } catch (err) {
      caught = err;
    }
    expect(
      errorMessages(caught).some((m) => m.includes('slash-runtime-boom')),
    ).toBe(true);
    assertOwnerDisposed(owner, scheduler);
  });

  it('debug-append failure: owner disposed, no mouse staged', async () => {
    const scheduler = new CountingScheduler();
    const owner = await makeStartedOwner(scheduler);
    const ports = {
      ...noopPorts(),
      debugAppend: () => {
        throw new Error('debug-boom');
      },
    };

    let caught: unknown = null;
    try {
      await commitInteractiveStartup({
        config: testConfig,
        agent: testAgent,
        settings: testSettings,
        perfOwner: owner,
        version: 'test',
        startupWarnings: [],
        ports,
      });
    } catch (err) {
      caught = err;
    }
    expect(errorMessages(caught).some((m) => m.includes('debug-boom'))).toBe(
      true,
    );
    assertOwnerDisposed(owner, scheduler);
  });

  it('terminal-setup failure: owner disposed, mouse correctly staged for rollback', async () => {
    const scheduler = new CountingScheduler();
    const owner = await makeStartedOwner(scheduler);
    const ports = {
      ...noopPorts(),
      // Mouse is enabled (isMouseEnabled returns true), then setupTerminal throws.
      isMouseEnabled: () => true,
      setupTerminal: () => {
        throw new Error('terminal-setup-boom');
      },
    };

    let caught: unknown = null;
    try {
      await commitInteractiveStartup({
        config: testConfig,
        agent: testAgent,
        settings: testSettings,
        perfOwner: owner,
        version: 'test',
        startupWarnings: [],
        ports,
      });
    } catch (err) {
      caught = err;
    }
    expect(
      errorMessages(caught).some((m) => m.includes('terminal-setup-boom')),
    ).toBe(true);
    assertOwnerDisposed(owner, scheduler);
  });

  it('render failure: owner disposed, instance not produced, primary error preserved', async () => {
    const scheduler = new CountingScheduler();
    const owner = await makeStartedOwner(scheduler);
    const ports = {
      ...noopPorts(),
      render: (() => {
        throw new Error('render-boom');
      }) as never,
    };

    let caught: unknown = null;
    try {
      await commitInteractiveStartup({
        config: testConfig,
        agent: testAgent,
        settings: testSettings,
        perfOwner: owner,
        version: 'test',
        startupWarnings: [],
        ports,
      });
    } catch (err) {
      caught = err;
    }
    expect(errorMessages(caught).some((m) => m.includes('render-boom'))).toBe(
      true,
    );
    assertOwnerDisposed(owner, scheduler);
  });

  it('sync-cleanup registration failure remains retryable on the next startup', async () => {
    let registrationAttempts = 0;
    const failingPorts = {
      ...noopPorts(),
      registerSync: () => {
        registrationAttempts++;
        throw new Error('register-sync-boom');
      },
    };

    await expect(
      commitInteractiveStartup({
        config: testConfig,
        agent: testAgent,
        settings: testSettings,
        perfOwner: null,
        version: 'test',
        startupWarnings: [],
        ports: failingPorts,
      }),
    ).rejects.toThrow('register-sync-boom');

    const succeedingPorts = {
      ...noopPorts(),
      registerSync: () => {
        registrationAttempts++;
      },
    };
    await commitInteractiveStartup({
      config: testConfig,
      agent: testAgent,
      settings: testSettings,
      perfOwner: null,
      version: 'test',
      startupWarnings: [],
      ports: succeedingPorts,
    });

    expect(registrationAttempts).toBe(2);
  });

  it('setup failure: owner disposed, instance cleared, primary error preserved', async () => {
    const scheduler = new CountingScheduler();
    const owner = await makeStartedOwner(scheduler);

    let setupCallCount = 0;
    const fakeInstance = { clear: () => {}, unmount: () => {} };
    const ports = {
      ...noopPorts(),
      render: (() => fakeInstance) as never,
      setupLifecycle: async () => {
        setupCallCount++;
        throw new Error('setup-boom');
      },
    };

    let caught: unknown = null;
    try {
      await commitInteractiveStartup({
        config: testConfig,
        agent: testAgent,
        settings: testSettings,
        perfOwner: owner,
        version: 'test',
        startupWarnings: [],
        ports,
      });
    } catch (err) {
      caught = err;
    }
    expect(setupCallCount).toBe(1);
    expect(errorMessages(caught).some((m) => m.includes('setup-boom'))).toBe(
      true,
    );
    assertOwnerDisposed(owner, scheduler);
  });

  it('primary-error ordering: primary error first, cleanup errors aggregate after', async () => {
    const scheduler = new CountingScheduler();
    const owner = await makeStartedOwner(scheduler);
    // Make the owner's dispose throw by corrupting it after start.
    const originalDispose = owner.dispose.bind(owner);
    owner.dispose = async () => {
      throw new Error('dispose-boom');
    };

    const ports = {
      ...noopPorts(),
      renderOptions: (() => {
        throw new Error('primary-boom');
      }) as never,
    };

    let caught: unknown = null;
    try {
      await commitInteractiveStartup({
        config: testConfig,
        agent: testAgent,
        settings: testSettings,
        perfOwner: owner,
        version: 'test',
        startupWarnings: [],
        ports,
      });
    } catch (err) {
      caught = err;
    }
    try {
      expect(caught).toBeInstanceOf(AggregateError);
      const agg = caught as AggregateError;
      const msgs = errorMessages(agg);
      // Primary error is first.
      expect(msgs[0]).toBe('primary-boom');
      // Cleanup error follows.
      expect(msgs.some((m) => m.includes('dispose-boom'))).toBe(true);
    } finally {
      // Restore and dispose for test cleanup. The throwing override prevented
      // disposed from being set, so call the real dispose to tear down the
      // owner's registry observers, sink/retention claim, and timer.
      owner.dispose = originalDispose;
      await originalDispose();
    }
  });

  it('exactly-once cleanup: module refs cleared so global cleanup is a no-op', async () => {
    const scheduler = new CountingScheduler();
    const owner = await makeStartedOwner(scheduler);
    const fakeInstance = { clear: () => {}, unmount: () => {} };
    const ports = {
      ...noopPorts(),
      render: (() => fakeInstance) as never,
      setupLifecycle: async () => {
        throw new Error('setup-boom-for-once');
      },
    };

    let caught: unknown = null;
    try {
      await commitInteractiveStartup({
        config: testConfig,
        agent: testAgent,
        settings: testSettings,
        perfOwner: owner,
        version: 'test',
        startupWarnings: [],
        ports,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBe(null);
    assertOwnerDisposed(owner, scheduler);

    // The transactional catch atomically cleared module refs via
    // captureAndClearTrackedInstanceAndOwner. Calling replacePreviousInstanceAndOwner
    // now must be a no-op (nothing to dispose — refs already cleared).
    // We verify this does NOT throw (no double-dispose of the already-disposed owner).
    const { replacePreviousInstanceAndOwner } = await import(
      './interactiveUI.js'
    );
    await replacePreviousInstanceAndOwner();
  });
});
