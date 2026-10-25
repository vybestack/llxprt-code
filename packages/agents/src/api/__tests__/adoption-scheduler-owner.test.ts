/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { rm } from 'node:fs/promises';
import { createAgent } from '../createAgent.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { drain, countType } from './helpers/agentHarness.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteAAgent, type RouteAAgent } from './helpers/route-a-agent.js';
import { makeScratchDir } from './helpers/scratch-dir.js';

describe('adopted Agent scheduler ownership', () => {
  useFakeResponsesReplay('tool-call-then-answer.jsonl');
  const releases: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    await runCleanupSteps(releases.splice(0).reverse());
  });

  it('executes a real tool with Agent-owned scheduler defaults for a factoryless Config', async () => {
    const built: RouteAAgent = await openRouteAAgent();
    releases.push(() => built.close());
    const { agent } = built;
    const events = await drain(agent.stream('read package metadata'));
    expect(countType(events, 'tool-result')).toBeGreaterThan(0);
    expect(countType(events, 'done')).toBe(1);
    expect(agent.tools.list().some((tool) => tool.name === 'read_file')).toBe(
      true,
    );
  });

  it('retains and disposes only the injected scheduler handles created for this adopted Agent', async () => {
    const directory = await makeScratchDir('scheduler-owner-');
    releases.push(() => rm(directory, { recursive: true, force: true }));
    let activeHandles = 0;
    let createdHandles = 0;
    const agent = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: directory,
      harness: { includeProcessCwd: false },
      toolSchedulerFactory: () => {
        activeHandles += 1;
        createdHandles += 1;
        return {
          dispose: () => {
            activeHandles -= 1;
          },
        };
      },
    });
    releases.push(() => agent.dispose());
    const events = await drain(agent.stream('read package metadata'));
    expect(countType(events, 'tool-result')).toBeGreaterThan(0);
    expect(createdHandles).toBeGreaterThan(0);
    expect(activeHandles).toBe(createdHandles);
    await agent.dispose();
    expect(activeHandles).toBe(0);
  });
});
