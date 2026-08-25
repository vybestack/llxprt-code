/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the host-injected exit-cleanup path and the ACP runtime
 * registration (issue #3306).
 *
 * `runZedIntegration` builds its own transport from `process.stdin`, so it
 * cannot be driven whole from a test without a transport-injection seam. These
 * tests instead exercise the two functions it composes, using the same
 * exported-helper seam the module already uses for
 * `buildSignalDisposalHandler` / `installDisposalSignalHandlers`.
 *
 * Nothing here is mocked: the cleanup orchestration runs for real, and the
 * runtime registration is asserted by reading the real providers runtime
 * registry back out.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import {
  getDefaultCliRuntimeId,
  resetDefaultCliRuntimeIdForTesting,
  setDefaultCliRuntimeId,
} from '@vybestack/llxprt-code-providers/runtime.js';
import {
  cleanupAgents,
  registerZedAcpRuntime,
  ZED_ACP_RUNTIME_ID,
} from './runZedIntegration.js';
import type { ZedAgent } from './zedIntegration.js';

/** A disposable shaped like the one slice of ZedAgent that cleanup uses. */
function makeAgent(disposeAll: () => Promise<void>): ZedAgent {
  return { disposeAll } as unknown as ZedAgent;
}

const logger = new DebugLogger('llxprt:test:zed-cleanup');

function makeConfig(sessionId: string): Config {
  return new Config({
    sessionId,
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: 'test-model',
  });
}

describe('cleanupAgents host-injected exit cleanup', () => {
  it('completes without a callback', async () => {
    await cleanupAgents([makeAgent(async () => {})], logger);
    await cleanupAgents([], logger);
  });

  it('invokes the callback exactly once, after agent disposal', async () => {
    const sequence: string[] = [];
    const agents = [
      makeAgent(async () => {
        sequence.push('dispose');
      }),
    ];

    await cleanupAgents(agents, logger, async () => {
      sequence.push('cleanup');
    });

    expect(sequence).toEqual(['dispose', 'cleanup']);
  });

  it('still runs the callback exactly once when an agent fails to dispose', async () => {
    let invocations = 0;
    const agents = [
      makeAgent(async () => {
        throw new Error('dispose blew up');
      }),
      makeAgent(async () => {}),
    ];

    await cleanupAgents(agents, logger, async () => {
      invocations += 1;
    });

    expect(invocations).toBe(1);
  });

  it('swallows a rejecting callback', async () => {
    let settled = false;

    await cleanupAgents([makeAgent(async () => {})], logger, async () => {
      throw new Error('cleanup blew up');
    });
    settled = true;

    expect(settled).toBe(true);
  });
});

describe('registerZedAcpRuntime', () => {
  beforeEach(() => {
    resetDefaultCliRuntimeIdForTesting();
  });

  it('claims the default runtime pointer under the package-owned id', () => {
    registerZedAcpRuntime(makeConfig('zed-acp-runtime-claim'));

    const registered = getDefaultCliRuntimeId();
    expect(registered).toBe(ZED_ACP_RUNTIME_ID);
    expect(registered).not.toContain('cli.runtime');
  });

  it('hands the pointer off from an already-registered CLI runtime', () => {
    setDefaultCliRuntimeId('cli.bootstrap');

    registerZedAcpRuntime(makeConfig('zed-acp-runtime-handoff'));

    expect(getDefaultCliRuntimeId()).toBe(ZED_ACP_RUNTIME_ID);
  });
});
