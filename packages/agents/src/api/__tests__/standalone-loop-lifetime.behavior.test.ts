import { afterEach, describe, expect, it } from 'bun:test';
import { AsyncTaskManager } from '@vybestack/llxprt-code-core';
import { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import {
  createAgenticLoop,
  TaskLaunchOwner,
  AgenticLoopRunner,
} from '../runtimeFactories.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { gate } from './helpers/recording-finalizer-join-fixture.js';
import {
  createScriptedAgentClient,
  contentEvent,
  finishedEvent,
} from '../../core/agenticLoop/__tests__/agenticLoop-test-helpers.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('standalone loop execution lifetime', () => {
  const roots: Array<() => Promise<void>> = [];
  afterEach(async () => {
    const accepted = roots.splice(0).reverse();
    await runCleanupSteps(accepted);
  });
  async function setup(
    client: AgentClientContract,
  ): Promise<AgenticLoopRunner> {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'standalone-runner-')),
    );
    const config = new Config({
      sessionId: randomUUID(),
      targetDir: directory,
      cwd: directory,
      model: 'fake-model',
      debugMode: false,
    });
    const policy = new RuntimePolicyOwner(config);
    const settings = new SessionSettingsOwner(new SettingsService());
    settings.bindTelemetry(config);
    const runner = createAgenticLoop({
      config,
      messageBus: policy.session.messageBus,
      agentClient: client,
      telemetry: RootTelemetry.prepare({
        enabled: false,
        sessionId: 'runner',
        maxBytes: 1024,
        maxFiles: 1,
      }),
      taskLaunchOwner: new TaskLaunchOwner(new AsyncTaskManager(5)),
      readShellJobSettings: () => ({ maxBackgroundJobs: 5, logMaxBytes: 1024 }),
      readExecutionPolicy: () => settings.readToolExecutionPolicy(),
      getToolGovernance: () => settings.readToolGovernance([]),
    });
    roots.push(() =>
      runCleanupSteps([
        () => settings.dispose(),
        () => policy.dispose(),
        () => config.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ]),
    );
    return runner;
  }

  it('cancels and joins a held model failure before disposal settles', async () => {
    const entered = gate();
    const release = gate();
    const failure = new Error('model transport failed');
    let cancelled = false;
    const scripted = createScriptedAgentClient([]);
    const client: AgentClientContract = {
      ...scripted.client,
      async *sendMessageStream(_request, signal) {
        entered.release();
        await release.promise;
        cancelled = signal.aborted;
        if (cancelled) throw failure;
        yield finishedEvent();
      },
    };
    const built = await setup(client);
    const sibling = await setup(
      createScriptedAgentClient([[contentEvent('sibling'), finishedEvent()]])
        .client,
    );
    const iterator = built.run('held', new AbortController().signal);
    const next = iterator.next().then(
      () => undefined,
      (error: unknown) => error,
    );
    await entered.promise;
    const closing = built.dispose();
    const outcome = closing.then(
      () => undefined,
      (error: unknown) => error,
    );
    let finished = false;
    void outcome.then(() => {
      finished = true;
    });
    try {
      expect(() => built.run('late', new AbortController().signal)).toThrow(
        /closed/,
      );
      await Promise.resolve();
      expect(finished).toBe(false);
      const events = [];
      for await (const event of sibling.run('go', new AbortController().signal))
        events.push(event);
      expect(events.length).toBeGreaterThan(0);
      release.release();
      expect(await next).toBe(failure);
      const error = await outcome;
      expect(error).toBeInstanceOf(AggregateError);
      if (!(error instanceof AggregateError))
        throw new Error('Missing cleanup failures');
      expect(error.errors).toContain(failure);
      expect(cancelled).toBe(true);
      expect(built.dispose()).toBe(closing);
    } finally {
      release.release();
      await next;
      await outcome;
      await sibling.dispose();
      await sibling.dispose();
    }
  });

  it('does not execute an unconsumed run and rejects its first iteration after closure', async () => {
    const scripted = createScriptedAgentClient([
      [contentEvent('unused'), finishedEvent()],
    ]);
    const built = await setup(scripted.client);
    try {
      const iterator = built.run('unused', new AbortController().signal);
      expect(scripted.turnMessages.length).toBe(0);
      await built.dispose();
      await expect(iterator.next()).rejects.toThrow(/closed/);
      expect(scripted.turnMessages.length).toBe(0);
    } finally {
      await built.dispose();
    }
  });

  it('retires an early-returned iterator without closing a subsequent run', async () => {
    const scripted = createScriptedAgentClient([
      [contentEvent('first'), finishedEvent()],
      [contentEvent('second'), finishedEvent()],
    ]);
    const built = await setup(scripted.client);
    try {
      const first = built.run('first', new AbortController().signal);
      await first.next();
      await first.return(undefined);
      const second = built.run('second', new AbortController().signal);
      expect((await second.next()).done).toBe(false);
      await built.dispose();
      expect((await second.next()).done).toBe(true);
    } finally {
      await built.dispose();
      await built.dispose();
    }
  });
});
