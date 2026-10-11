/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { AsyncTaskManager } from '@vybestack/llxprt-code-core';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { createAgenticLoop, TaskLaunchOwner } from '../runtimeFactories.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { gate } from './helpers/recording-finalizer-join-fixture.js';
import {
  createScriptedAgentClient,
  contentEvent,
  finishedEvent,
} from '../../core/agenticLoop/__tests__/agenticLoop-test-helpers.js';

async function setup(client: AgentClientContract) {
  const built = await buildCliStyleConfig('plain-text.jsonl');
  const runner = createAgenticLoop({
    config: built.config,
    messageBus: built.messageBus,
    agentClient: client,
    telemetry: RootTelemetry.prepare({
      enabled: false,
      sessionId: 'runner',
      maxBytes: 1024,
      maxFiles: 1,
    }),
    taskLaunchOwner: new TaskLaunchOwner(new AsyncTaskManager(5)),
    readShellJobSettings: () => ({ maxBackgroundJobs: 5, logMaxBytes: 1024 }),
    readExecutionPolicy: () => built.settingsOwner.readToolExecutionPolicy(),
    getToolGovernance: () => built.settingsOwner.readToolGovernance([]),
  });
  return { runner, cleanup: built.cleanup };
}

describe('standalone loop execution lifetime', () => {
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
    const iterator = built.runner.run('held', new AbortController().signal);
    const next = iterator.next().then(
      () => undefined,
      (error: unknown) => error,
    );
    await entered.promise;
    const closing = built.runner.dispose();
    const outcome = closing.then(
      () => undefined,
      (error: unknown) => error,
    );
    let finished = false;
    void outcome.then(() => {
      finished = true;
    });
    try {
      expect(() =>
        built.runner.run('late', new AbortController().signal),
      ).toThrow(/closed/);
      await Promise.resolve();
      expect(finished).toBe(false);
      const events = [];
      for await (const event of sibling.runner.run(
        'go',
        new AbortController().signal,
      ))
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
      expect(built.runner.dispose()).toBe(closing);
    } finally {
      release.release();
      await next;
      await outcome;
      await sibling.runner.dispose();
      await sibling.cleanup();
      await built.cleanup();
    }
  });

  it('does not execute an unconsumed run and rejects its first iteration after closure', async () => {
    const scripted = createScriptedAgentClient([
      [contentEvent('unused'), finishedEvent()],
    ]);
    const built = await setup(scripted.client);
    try {
      const iterator = built.runner.run('unused', new AbortController().signal);
      expect(scripted.turnMessages.length).toBe(0);
      await built.runner.dispose();
      await expect(iterator.next()).rejects.toThrow(/closed/);
      expect(scripted.turnMessages.length).toBe(0);
    } finally {
      await built.cleanup();
    }
  });

  it('retires an early-returned iterator without closing a subsequent run', async () => {
    const scripted = createScriptedAgentClient([
      [contentEvent('first'), finishedEvent()],
      [contentEvent('second'), finishedEvent()],
    ]);
    const built = await setup(scripted.client);
    try {
      const first = built.runner.run('first', new AbortController().signal);
      await first.next();
      await first.return(undefined);
      const second = built.runner.run('second', new AbortController().signal);
      expect((await second.next()).done).toBe(false);
      await built.runner.dispose();
      expect((await second.next()).done).toBe(true);
    } finally {
      await built.runner.dispose();
      await built.cleanup();
    }
  });
});
