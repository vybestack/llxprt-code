/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260808-ISSUE2615
 *
 * Cross-surface identity proof for the ShellJobManager ownership extraction.
 *
 * A REAL short-lived background shell job is launched through the session
 * runtime's ShellJobManager (the one createAgent constructs, attaches, and
 * lends into Config.initialize via coreServices), and the SAME job id must be
 * observable through the Agent tasks API (agent.tasks.list()). This proves the
 * manager the agent OWNS is the SAME manager the tasks API reads — the central
 * behavioural acceptance criterion for the slice.
 *
 * No mocks: a real `sleep 0.2` is spawned in a detached process group through
 * the real ShellJobManager, and the real TasksControl the agent holds projects
 * it. The ShellJobManager instance the agent owns is reached via the SAME
 * guarded structural-narrowing pattern the harness already uses for
 * HistoryService identity (agentHarness.captureHistoryServiceIdentity): the
 * Agent surface intentionally does not expose the manager publicly.
 */

import { describe, it, expect } from 'bun:test';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ShellJobManager, ShellJob } from '@vybestack/llxprt-code-core';
import { buildAgent, isRecord } from './helpers/agentHarness.js';
import type { Agent } from '@vybestack/llxprt-code-agents';

/**
 * Reaches the session-owned ShellJobManager an Agent holds via guarded
 * structural narrowing of its (opaque) internals. Cast-free: the Agent is
 * treated as a record and probed for the documented `deps.sessionRuntime.
 * shellJobManager` path, exactly mirroring captureHistoryServiceIdentity's
 * reach pattern. Returns undefined when the path is absent.
 */
function resolveSessionShellJobManager(
  agent: Agent,
): ShellJobManager | undefined {
  const impl = agent as unknown as Record<string, unknown>;
  const deps = impl['deps'];
  if (!isRecord(deps)) {
    return undefined;
  }
  const sessionRuntime = deps['sessionRuntime'];
  if (!isRecord(sessionRuntime)) {
    return undefined;
  }
  const manager = sessionRuntime['shellJobManager'];
  return typeof manager === 'object' && manager !== null
    ? (manager as ShellJobManager)
    : undefined;
}

describe('cross-surface shell-job identity @plan:PLAN-20260808-ISSUE2615', () => {
  it('a background shell job launched through the session runtime ShellJobManager is visible with the SAME id through agent.tasks.list() @scenario:end-to-end-identity', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'llxprt-shell-identity-'));
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const manager = resolveSessionShellJobManager(agent);
      // The session runtime owns a real ShellJobManager (createAgent wired it).
      expect(manager).toBeDefined();
      const mgr: ShellJobManager = manager as ShellJobManager;

      // Launch a REAL short-lived background job through the owned manager.
      const job: ShellJob = mgr.launch({
        command: 'sleep 0.2',
        cwd: workDir,
      });

      // The SAME job id must be observable through the Agent tasks API.
      const listed = agent.tasks.list();
      const match = listed.find((t) => t.id === job.id);
      expect(match).toBeDefined();
      expect(match?.kind).toBe('shell');

      // It is also reported as running through the running-only view.
      const running = agent.tasks.listRunning();
      expect(running.find((t) => t.id === job.id)).toBeDefined();

      // get(id) resolves to the same identity through the public surface.
      const byId = agent.tasks.get(job.id);
      expect(byId?.id).toBe(job.id);
      expect(byId?.kind).toBe('shell');

      // Terminate the real process so the test leaves no orphan.
      await mgr.cancel(job.id);
    } finally {
      await cleanup();
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
