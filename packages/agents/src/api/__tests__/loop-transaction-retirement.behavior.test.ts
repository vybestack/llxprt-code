/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Config } from '@vybestack/llxprt-code-core';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { Agent } from '../agent.js';
import { createAgent } from '../createAgent.js';
import { AgenticLoop } from '../../core/agenticLoop/AgenticLoop.js';
import { CoreToolScheduler } from '../../core/coreToolScheduler.js';
import { bindSchedulerOwner } from '../../session/assembleSchedulerOwner.js';
import { createLoopHolder, prepareLoop } from '../loop/rebuildLoop.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

describe('real loop replacement transaction retirement', () => {
  const credentials = useOwnedCredentials();
  const cleanup: Array<() => void | Promise<void>> = [];
  let agent: Agent;
  let config: Config;
  let policy: RuntimePolicyOwner;
  let settings: SessionSettingsOwner;
  beforeEach(async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'loop-retirement-'));
    cleanup.push(() => rm(temporary, { recursive: true, force: true }));
    const directory = await realpath(temporary);
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
    cleanup.push(() => {
      if (previousReplay === undefined)
        delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
      if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
      else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    });
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/plain-text.jsonl', import.meta.url),
    );
    process.env.LLXPRT_PROMPTS_DIR = join(directory, 'prompts');
    await mkdir(join(directory, 'prompts', 'core'), { recursive: true });
    await writeFile(
      join(directory, 'prompts', 'core', 'default.md'),
      'Real loop replacement test.',
    );
    config = new Config({
      sessionId: 'loop-retirement',
      cwd: directory,
      targetDir: directory,
      model: 'fake-model',
      provider: 'fake',
      debugMode: false,
      telemetry: { enabled: false },
    });
    cleanup.push(() => config.dispose());
    policy = new RuntimePolicyOwner(config);
    cleanup.push(() => policy.dispose());
    settings = new SessionSettingsOwner(new SettingsService());
    cleanup.push(() => settings.dispose());
    settings.bindTelemetry(config);
    agent = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: directory,
      credentialAuthority: credentials().authority,
      harness: { includeProcessCwd: false },
    });
    cleanup.push(() => agent.dispose());
  });
  afterEach(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.splice(0).reverse()) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Loop transaction fixture cleanup failed',
      );
  });

  function construct(client: Agent['agentClient']): AgenticLoop {
    const interactiveMode = config.isInteractive();
    return new AgenticLoop({
      agentClient: client,
      config,
      messageBus: policy.session.messageBus,
      interactiveMode,
      createSchedulerOwner: bindSchedulerOwner(
        config,
        policy.session.messageBus,
        interactiveMode,
        client.tools,
        (options) => new CoreToolScheduler(options),
        () => settings.readToolExecutionPolicy(),
        () => settings.readToolGovernance([]),
        () => config.getApprovalMode(),
        settings.telemetry,
      ),
    });
  }

  it('publishes a real replacement before abort failure and still retires every subscription once with primary-first failures', () => {
    const holder = createLoopHolder();
    const first = prepareLoop(holder, () => agent.agentClient, construct);
    first.publish();
    const primary = new Error('abort delivery failed');
    const secondary = new Error('subscription release failed');
    class FailingAbortController extends AbortController {
      override abort(): void {
        super.abort();
        throw primary;
      }
    }
    const controller = new FailingAbortController();
    holder.activeRunController = controller;
    const order: string[] = [];
    holder.subscriptions = [
      () => {
        order.push('first');
        throw secondary;
      },
      () => {
        order.push('last');
      },
    ];
    const previous = holder.current;
    const replacement = prepareLoop(holder, () => agent.agentClient, construct);
    const published = replacement.publish();
    expect(published).not.toBe(previous);
    expect(holder.current).toBe(published);
    expect(holder.activeRunController.signal.aborted).toBe(false);
    const failure = (() => {
      try {
        replacement.retire();
      } catch (error) {
        return error;
      }
      throw new Error('Expected retirement failure');
    })();
    if (!(failure instanceof AggregateError)) throw failure;
    expect(failure.errors).toStrictEqual([primary, secondary]);
    expect(controller.signal.aborted).toBe(true);
    expect(order).toStrictEqual(['first', 'last']);
    expect(holder.current).toBe(published);
    expect(holder.boundClient).toBe(agent.agentClient);
    expect(() => replacement.retire()).not.toThrow();
    expect(order).toStrictEqual(['first', 'last']);
  });

  it('leaves the original real loop, controller and subscriptions runnable when replacement construction fails', async () => {
    const holder = createLoopHolder();
    const first = prepareLoop(holder, () => agent.agentClient, construct);
    const previous = first.publish();
    const controller = new AbortController();
    holder.activeRunController = controller;
    const released: string[] = [];
    const subscriptions = [() => released.push('released')];
    holder.subscriptions = subscriptions;
    const primary = new Error('replacement acquisition failed');
    expect(() =>
      prepareLoop(
        holder,
        () => agent.agentClient,
        () => {
          throw primary;
        },
      ),
    ).toThrow(primary);
    expect(holder.current).toBe(previous);
    expect(holder.activeRunController).toBe(controller);
    expect(controller.signal.aborted).toBe(false);
    expect(holder.subscriptions).toBe(subscriptions);
    expect(released).toStrictEqual([]);
    const events = [];
    for await (const event of previous.run(
      'Continue the original real loop',
      controller.signal,
    ))
      events.push(event);
    expect(events.some((event) => event.kind === 'stream')).toBe(true);
  });
  it('retains undefined and repeated retirement failures and does not reset work on repeated publication', () => {
    const holder = createLoopHolder();
    prepareLoop(holder, () => agent.agentClient, construct).publish();
    const repeated = new Error('independent subscription failures');
    const reasons: unknown[] = [undefined, repeated, repeated];
    const closed: number[] = [];
    holder.subscriptions = reasons.map((reason, index) => () => {
      closed.push(index);
      throw reason;
    });
    const replacement = prepareLoop(holder, () => agent.agentClient, construct);
    replacement.publish();
    let failure: unknown;
    try {
      replacement.retire();
    } catch (error) {
      failure = error;
    }
    if (!(failure instanceof AggregateError))
      throw new Error('Missing aggregate retirement failure');
    expect(failure.errors).toStrictEqual(reasons);
    replacement.retire();
    expect(closed).toStrictEqual([0, 1, 2]);
    holder.subscriptions = [() => closed.push(3)];
    replacement.publish();
    const next = prepareLoop(holder, () => agent.agentClient, construct);
    next.publish();
    next.retire();
    expect(closed).toStrictEqual([0, 1, 2, 3]);
  });
});
