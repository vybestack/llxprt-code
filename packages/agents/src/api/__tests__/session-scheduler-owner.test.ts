/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  createAllowPolicyEngine,
  createTestConfig,
  createToolRegistryForTest,
  DEFAULT_AGENT_ID,
  createScriptedAgentClient,
  collectEvents,
  toolCallRequestEvent,
  finishedEvent,
  contentEvent,
} from '../../core/agenticLoop/__tests__/agenticLoop-test-helpers.js';
import { rebuildLoop, createLoopHolder } from '../loop/rebuildLoop.js';
import type {
  ToolSchedulerContract,
  ToolSchedulerFactoryOptions,
} from '@vybestack/llxprt-code-core/core/toolSchedulerContract.js';
import { CoreToolScheduler } from '../../core/coreToolScheduler.js';
import {
  createSessionSchedulerOwner,
  SessionTaskServices,
} from '../agentRuntimeAssembly.js';

import { createTaskRegistration } from '../runtimeFactories.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
function createFixture() {
  const tool = new MockTool({ name: 'owned_tool' });
  tool.executeFn.mockResolvedValue({
    llmContent: 'ok',
    returnDisplay: 'ok',
  });
  const toolRegistry = createToolRegistryForTest([tool]);
  const messageBus = new MessageBus(createAllowPolicyEngine(), false);
  const config = createTestConfig({
    messageBus,
    toolRegistry,
    policyEngine: createAllowPolicyEngine(),
    interactive: false,
    approvalMode: ApprovalMode.YOLO,
  });
  const owner = createSessionSchedulerOwner(
    config,
    (options) => new CoreToolScheduler(options),
  );
  return { owner, tool, toolRegistry, messageBus, config };
}

const request = (callId: string) => ({
  callId,
  name: 'owned_tool',
  args: {},
  agentId: DEFAULT_AGENT_ID,
  isClientInitiated: true,
  prompt_id: 'owner-test',
});

const callbacks = (completed: string[]) => ({
  getPreferredEditor: () => undefined,
  onEditorClose: () => {},
  onAllToolCallsComplete: async (
    calls: Array<{ request: { callId: string } }>,
  ) => {
    completed.push(...calls.map((call) => call.request.callId));
  },
});

describe('session scheduler owner', () => {
  it('supplies the current session factory to a task tool after registration and clears it on teardown', async () => {
    const settingsService = new SettingsService();
    const config = new Config({
      cwd: process.cwd(),
      targetDir: process.cwd(),
      sessionId: 'factory-owner-test',
      debugMode: false,
      model: 'test-model',
      settingsService,
    });
    const owner = createSessionSchedulerOwner(
      config,
      (options) => new CoreToolScheduler(options),
    );
    const registration = createTaskRegistration(owner);
    const args = registration.buildArgs(config, {
      profileManager: undefined,
      subagentManager: undefined,
      schedulerFactoryProvider: () => undefined,
      getTaskManager: () => undefined,
      messageBus: new MessageBus(),
    });
    const dependencies: unknown = args[1];
    if (
      dependencies === null ||
      typeof dependencies !== 'object' ||
      !('schedulerFactoryProvider' in dependencies) ||
      typeof dependencies.schedulerFactoryProvider !== 'function'
    ) {
      throw new Error('Task tool scheduler provider is missing');
    }
    const provider = dependencies.schedulerFactoryProvider;
    const events: string[] = [];
    const first = () => ({
      schedule: () => {
        events.push('first');
      },
    });
    const second = () => ({
      schedule: () => {
        events.push('second');
      },
    });
    const runActive = async (): Promise<void> => {
      const factory: unknown = provider();
      if (typeof factory !== 'function') {
        throw new Error('Active subagent scheduler factory is missing');
      }
      const handle = await factory({
        schedulerConfig: config,
        onAllToolCallsComplete: async () => {},
        outputUpdateHandler: () => {},
      });
      await handle.schedule([], new AbortController().signal);
    };

    owner.setInteractiveSubagentSchedulerFactory(first);
    await runActive();
    owner.setInteractiveSubagentSchedulerFactory(second);
    await runActive();
    owner.setInteractiveSubagentSchedulerFactory(undefined);

    expect(events).toStrictEqual(['first', 'second']);
    expect(provider()).toBeUndefined();
    await owner.dispose();
  });

  it('runs real tools on independent buses and registries despite identical display labels', async () => {
    const a = createFixture();
    const b = createFixture();
    const sameLabelA = { label: 'same-session' };
    const sameLabelB = { label: 'same-session' };
    const completedA: string[] = [];
    const completedB: string[] = [];
    const schedulerA = await a.owner.acquire(
      sameLabelA,
      'session',
      callbacks(completedA),
      { interactiveMode: false },
      { messageBus: a.messageBus, toolRegistry: a.toolRegistry },
    );
    const schedulerB = await b.owner.acquire(
      sameLabelB,
      'session',
      callbacks(completedB),
      { interactiveMode: false },
      { messageBus: b.messageBus, toolRegistry: b.toolRegistry },
    );
    expect(schedulerA).not.toBe(schedulerB);
    await schedulerA.schedule(request('a-call'), new AbortController().signal);
    await waitFor(() => expect(completedA).toStrictEqual(['a-call']));
    expect(completedB).toStrictEqual([]);
    expect(a.tool.executeFn).toHaveBeenCalledTimes(1);
    expect(b.tool.executeFn).toHaveBeenCalledTimes(0);

    await a.owner.dispose();
    await schedulerB.schedule(request('b-call'), new AbortController().signal);
    await waitFor(() => expect(completedB).toStrictEqual(['b-call']));
    expect(completedA).toStrictEqual(['a-call']);
    expect(b.tool.executeFn).toHaveBeenCalledTimes(1);
    b.owner.release(sameLabelB, 'session', schedulerB);
    await b.owner.dispose();
  });

  it('deduplicates concurrent acquisitions, refreshes callbacks and releases at zero', async () => {
    const fixture = createFixture();
    const owner = { label: 'session' };
    const firstCompletions: string[] = [];
    const secondCompletions: string[] = [];
    const deps = {
      messageBus: fixture.messageBus,
      toolRegistry: fixture.toolRegistry,
    };
    const [first, second] = await Promise.all([
      fixture.owner.acquire(
        owner,
        'session',
        callbacks(firstCompletions),
        undefined,
        deps,
      ),
      fixture.owner.acquire(
        owner,
        'session',
        callbacks(secondCompletions),
        undefined,
        deps,
      ),
    ]);
    expect(first).toBe(second);
    fixture.owner.release(owner, 'session', first);
    await second.schedule(request('shared-call'), new AbortController().signal);
    await waitFor(() =>
      expect(secondCompletions).toStrictEqual(['shared-call']),
    );
    expect(firstCompletions).toStrictEqual([]);
    fixture.owner.release(owner, 'session', second);
    expect(
      await fixture.owner.acquire(
        owner,
        'session',
        callbacks([]),
        undefined,
        deps,
      ),
    ).not.toBe(first);
    await fixture.owner.dispose();
  });

  it('binds each acquisition to its own bus and registry and forwards interactive mode', async () => {
    const fixture = createFixture();
    const second = createFixture();
    const options: ToolSchedulerFactoryOptions[] = [];
    const config = createTestConfig({
      messageBus: fixture.messageBus,
      toolRegistry: fixture.toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });
    const session = createSessionSchedulerOwner(config, (created) => {
      options.push(created);
      return new CoreToolScheduler(created);
    });
    const firstOwner = { label: 'same' };
    const secondOwner = { label: 'same' };
    const first = await session.acquire(
      firstOwner,
      'session',
      callbacks([]),
      { interactiveMode: false },
      { messageBus: fixture.messageBus, toolRegistry: fixture.toolRegistry },
    );
    const other = await session.acquire(
      secondOwner,
      'session',
      callbacks([]),
      { interactiveMode: true },
      { messageBus: second.messageBus, toolRegistry: second.toolRegistry },
    );

    expect(first).not.toBe(other);
    expect(options).toHaveLength(2);
    expect(options[0].messageBus).toBe(fixture.messageBus);
    expect(options[0].toolRegistry).toBe(fixture.toolRegistry);
    expect(options[0].toolContextInteractiveMode).toBe(false);
    expect(options[1].messageBus).toBe(second.messageBus);
    expect(options[1].toolRegistry).toBe(second.toolRegistry);
    expect(options[1].toolContextInteractiveMode).toBe(true);
    session.release(firstOwner, 'session', first);
    session.release(secondOwner, 'session', other);
    await session.dispose();
    await fixture.owner.dispose();
    await second.owner.dispose();
  });

  it('reuses the scheduler while references remain and replaces it after final release', async () => {
    const fixture = createFixture();
    const owner = { label: 'shared' };
    const deps = {
      messageBus: fixture.messageBus,
      toolRegistry: fixture.toolRegistry,
    };
    const first = await fixture.owner.acquire(
      owner,
      'session',
      callbacks([]),
      undefined,
      deps,
    );
    const second = await fixture.owner.acquire(
      owner,
      'session',
      callbacks([]),
      undefined,
      deps,
    );
    fixture.owner.release(owner, 'session', first);
    const third = await fixture.owner.acquire(
      owner,
      'session',
      callbacks([]),
      undefined,
      deps,
    );
    expect(third).toBe(second);
    fixture.owner.release(owner, 'session', second);
    fixture.owner.release(owner, 'session', third);
    const replacement = await fixture.owner.acquire(
      owner,
      'session',
      callbacks([]),
      undefined,
      deps,
    );
    expect(replacement).not.toBe(first);
    fixture.owner.release(owner, 'session', replacement);
    await fixture.owner.dispose();
  });

  it('binds the rebuilt agent loop to its session owner rather than Config scheduler acquisition', async () => {
    const fixture = createFixture();
    fixture.owner.setToolRegistry(fixture.toolRegistry, fixture.toolRegistry);
    const config = createTestConfig({
      messageBus: fixture.messageBus,
      toolRegistry: fixture.toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });
    const { client } = createScriptedAgentClient([
      [toolCallRequestEvent('owned_tool', 'loop-call'), finishedEvent()],
      [contentEvent('done'), finishedEvent()],
    ]);
    const loop = rebuildLoop({
      loopHolder: createLoopHolder(),
      resolveClient: () => client,
      config,
      messageBus: fixture.messageBus,
      schedulerOwner: fixture.owner,
    });
    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );
    expect(events.some((event) => event.kind === 'tools_complete')).toBe(true);
    expect(fixture.tool.executeFn).toHaveBeenCalledTimes(1);
    await fixture.owner.dispose();
    const second = createScriptedAgentClient([
      [toolCallRequestEvent('owned_tool', 'after-disposal'), finishedEvent()],
    ]);
    const rebuilt = rebuildLoop({
      loopHolder: createLoopHolder(),
      resolveClient: () => second.client,
      config,
      messageBus: fixture.messageBus,
      schedulerOwner: fixture.owner,
    });
    await expect(
      collectEvents(rebuilt, 'go', new AbortController().signal),
    ).rejects.toThrow('Session scheduler owner is disposed');
    expect(fixture.tool.executeFn).toHaveBeenCalledTimes(1);
  });

  it('cancels pending scheduler work before releasing listeners and preserves disposal failures', async () => {
    const fixture = createFixture();
    const calls: string[] = [];
    const disposalFailure = new Error('scheduler listener release failed');
    const scheduler: ToolSchedulerContract = {
      schedule: async () => undefined,
      cancelAll: () => {
        calls.push('cancel');
      },
      dispose: () => {
        calls.push('dispose');
        throw disposalFailure;
      },
      setCallbacks: () => undefined,
      handleConfirmationResponse: async () => undefined,
    };
    const owner = createSessionSchedulerOwner(fixture.config, () => scheduler);
    const acquisitionOwner = { label: 'fault-injected' };
    await owner.acquire(acquisitionOwner, 'session', callbacks([]), undefined, {
      messageBus: fixture.messageBus,
      toolRegistry: fixture.toolRegistry,
    });

    await owner.cancelAll();
    expect(calls).toStrictEqual(['cancel']);

    const result = await owner.dispose().catch((error: unknown) => error);
    expect(result).toBeInstanceOf(AggregateError);
    if (!(result instanceof AggregateError)) {
      throw new Error(
        'Expected scheduler disposal to reject with AggregateError',
      );
    }
    expect(result.errors).toStrictEqual([disposalFailure]);
    expect(calls).toStrictEqual(['cancel', 'dispose']);
    await fixture.owner.dispose();
  });

  it('shares one scheduler-owner cleanup attempt across concurrent and repeated disposal', async () => {
    const fixture = createFixture();
    let disposeCount = 0;
    const scheduler: ToolSchedulerContract = {
      schedule: async () => undefined,
      cancelAll: () => undefined,
      dispose: () => {
        disposeCount += 1;
      },
      setCallbacks: () => undefined,
      handleConfirmationResponse: async () => undefined,
    };
    const owner = createSessionSchedulerOwner(fixture.config, () => scheduler);
    await owner.acquire(
      { label: 'shared-cleanup' },
      'session',
      callbacks([]),
      undefined,
      {
        messageBus: fixture.messageBus,
        toolRegistry: fixture.toolRegistry,
      },
    );

    const first = owner.dispose();
    const concurrent = owner.dispose();
    expect(new Set([first, concurrent]).size).toBe(1);
    await first;
    expect(new Set([first, concurrent, owner.dispose()]).size).toBe(1);
    expect(disposeCount).toBe(1);
    await fixture.owner.dispose();
  });

  it('joins pending scheduler creation, disposes its handle once, and denies new acquisitions', async () => {
    const fixture = createFixture();
    let resolveCreation = (_handle: ToolSchedulerContract): void => {
      throw new Error('Scheduler creation resolver is not initialized');
    };
    const pending = new Promise<ToolSchedulerContract>((resolve) => {
      resolveCreation = resolve;
    });
    let disposeCount = 0;
    const scheduler: ToolSchedulerContract = {
      schedule: async () => undefined,
      cancelAll: () => undefined,
      dispose: () => {
        disposeCount += 1;
      },
      setCallbacks: () => undefined,
      handleConfirmationResponse: async () => undefined,
    };
    const pendingScheduler = Object.assign(pending, scheduler);
    const owner = createSessionSchedulerOwner(
      fixture.config,
      () => pendingScheduler,
    );
    const acquisitionOwner = { label: 'pending-creation' };
    const deps = {
      messageBus: fixture.messageBus,
      toolRegistry: fixture.toolRegistry,
    };
    const acquisition = owner.acquire(
      acquisitionOwner,
      'session',
      callbacks([]),
      undefined,
      deps,
    );

    let disposalSettled = false;
    const disposal = owner.dispose().then(() => {
      disposalSettled = true;
    });
    await Promise.resolve();
    expect(disposalSettled).toBe(false);
    await expect(
      owner.acquire(
        { label: 'denied-during-disposal' },
        'session',
        callbacks([]),
        undefined,
        deps,
      ),
    ).rejects.toThrow('Session scheduler owner is disposed');

    resolveCreation(scheduler);
    await expect(acquisition).rejects.toThrow(
      'Session scheduler owner is disposed',
    );
    await disposal;
    expect(disposeCount).toBe(1);
    await expect(
      owner.acquire(
        { label: 'denied-after-disposal' },
        'session',
        callbacks([]),
        undefined,
        deps,
      ),
    ).rejects.toThrow('Session scheduler owner is disposed');
    await fixture.owner.dispose();
  });
});

describe('session task services', () => {
  it('constructs independent shell managers from each session settings snapshot', async () => {
    const firstSettings = new SettingsService();
    firstSettings.set('shell-max-background-jobs', 7);
    const first = new SessionTaskServices(firstSettings);
    const second = new SessionTaskServices(new SettingsService());
    expect(first.shellJobs).not.toBe(second.shellJobs);
    expect(first.shellJobs.getMaxBackgroundJobs()).toBe(7);
    expect(second.shellJobs.getMaxBackgroundJobs()).toBe(10);
    await Promise.all([first.dispose(), second.dispose()]);
  });

  it('joins tracked work and reports task cancellation and execution failures together', async () => {
    const fixture = createFixture();
    const services = new SessionTaskServices(new SettingsService());
    let finishExecution: (() => void) | undefined;
    const executionFailure = new Error('execution failed');
    const execution = new Promise<void>((resolve) => {
      finishExecution = resolve;
    }).then(() => {
      throw executionFailure;
    });
    const cancellationFailure = new Error('cancellation failed');
    services.manager.registerTask({
      id: 'owned',
      subagentName: 'worker',
      goalPrompt: 'wait',
      abortController: new AbortController(),
    });
    services.manager.onTaskCancelled(() => {
      throw cancellationFailure;
    });
    services.manager.trackExecution('owned', execution);

    const first = services.dispose();
    expect(new Set([first, services.dispose()]).size).toBe(1);
    let settled = false;
    void first.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    finishExecution?.();
    const failure = await first.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError)) {
      throw new Error('Expected task services to reject with AggregateError');
    }
    expect(failure.errors).toStrictEqual([
      cancellationFailure,
      executionFailure,
    ]);
    await fixture.owner.dispose();
  });

  it('closes task and shell admissions without cancelling owned work before the join phase', async () => {
    const services = new SessionTaskServices(new SettingsService());
    const controller = new AbortController();
    services.manager.registerTask({
      id: 'owned-before-close',
      subagentName: 'worker',
      goalPrompt: 'remain active until disposal joins work',
      abortController: controller,
    });

    services.stopAdmissions();

    expect(services.manager.canLaunchAsync().allowed).toBe(false);
    expect(() =>
      services.shellJobs.launch({
        command: 'echo too-late',
        cwd: process.cwd(),
      }),
    ).toThrow('ShellJobManager is disposing or disposed');
    expect(() =>
      services.setupAutoTrigger(
        () => false,
        async () => {},
      ),
    ).toThrow('Session task services are disposed');
    expect(controller.signal.aborted).toBe(false);

    await services.dispose();
    expect(controller.signal.aborted).toBe(true);
  });

  it('publishes the services disposal promise before task cancellation reenters dispose', async () => {
    const services = new SessionTaskServices(new SettingsService());
    let reentrant: Promise<void> | undefined;
    services.manager.registerTask({
      id: 'owned',
      subagentName: 'worker',
      goalPrompt: 'wait',
      abortController: new AbortController(),
    });
    services.manager.onTaskCancelled(() => {
      reentrant = services.dispose();
    });

    const first = services.dispose();

    expect(reentrant).toBe(first);
    await first;
  });

  it('publishes the services disposal promise before admission cleanup reenters dispose', async () => {
    const services = new SessionTaskServices(new SettingsService());
    const subscriptions = Reflect.get(services, 'subscriptions');
    if (!(subscriptions instanceof Set)) {
      throw new Error('Expected SessionTaskServices subscriptions to be a Set');
    }
    let reentrant: Promise<void> | undefined;
    let reentered = false;
    subscriptions.add(() => {
      if (reentered) return;
      reentered = true;
      reentrant = services.dispose();
    });

    const first = services.dispose();

    expect(reentrant).toBe(first);
    await first;
  });

  it('attempts a failing admission cleanup exactly once and retains its failure', async () => {
    const services = new SessionTaskServices(new SettingsService());
    const subscriptions = Reflect.get(services, 'subscriptions');
    if (!(subscriptions instanceof Set)) {
      throw new Error('Expected SessionTaskServices subscriptions to be a Set');
    }
    const cleanupFailure = new Error('unsubscribe failed');
    let attempts = 0;
    subscriptions.add(() => {
      attempts += 1;
      throw cleanupFailure;
    });

    const result = await services.dispose().catch((error: unknown) => error);

    expect(result).toBeInstanceOf(AggregateError);
    if (!(result instanceof AggregateError)) {
      throw new Error('Expected task services to reject with AggregateError');
    }
    expect(attempts).toBe(1);
    expect(result.errors).toStrictEqual([cleanupFailure]);
  });
});
