/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import { cleanupAgents } from './runZedIntegration.js';
import type { ZedAgent } from './zedIntegration.js';

/** A disposable shaped like the one slice of ZedAgent that cleanup uses. */
function makeAgent(disposeAll: () => Promise<void>): ZedAgent {
  return { disposeAll } as unknown as ZedAgent;
}

const logger = new DebugLogger('llxprt:test:zed-cleanup');

describe('cleanupAgents host-injected exit cleanup', () => {
  it('still disposes every agent when no callback is supplied', async () => {
    const disposed: string[] = [];

    await cleanupAgents(
      [
        makeAgent(async () => {
          disposed.push('first');
        }),
        makeAgent(async () => {
          disposed.push('second');
        }),
      ],
      logger,
    );

    expect(disposed.sort()).toStrictEqual(['first', 'second']);
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

    expect(sequence).toStrictEqual(['dispose', 'cleanup']);
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
