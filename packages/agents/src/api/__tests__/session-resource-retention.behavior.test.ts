/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os, { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fromConfig,
  createToolScheduler,
  type Agent,
} from '@vybestack/llxprt-code-agents';
import { AsyncTaskManager } from '@vybestack/llxprt-code-core';
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import type { ToolSchedulerFactory } from '@vybestack/llxprt-code-core/core/toolSchedulerContract.js';
import { ShellJobManager } from '@vybestack/llxprt-code-core/services/shellJobManager.js';
import {
  captureHistoryServiceIdentity,
  respondToFirstConfirmation,
  ToolConfirmationOutcome,
} from './helpers/agentHarness.js';
import {
  buildCliStyleConfig,
  type BuiltCliConfig,
} from './helpers/buildCliStyleConfig.js';
import { wrapRegistryWithConfirmation } from '../confirmationForcing.js';

type Stage = 'created' | 'working' | 'disposed';
type Counts = Readonly<{
  schedulerHandles: number;
  busListeners: number;
  historyListeners: number;
  runningTasks: number;
  trackedExecutions: number;
  runningShellJobs: number;
  retainedShellJobs: number;
  shellPollTimers: number;
  recordingServices: number;
}>;
type Sample = Readonly<{ owner: string; stage: Stage; counts: Counts }>;

const AFTER_DISPOSAL: Counts = {
  schedulerHandles: 0,
  busListeners: 0,
  historyListeners: 0,
  runningTasks: 0,
  trackedExecutions: 0,
  runningShellJobs: 0,
  retainedShellJobs: 0,
  shellPollTimers: 0,
  recordingServices: 0,
};
// With a two-job budget the shell manager may retain four terminal records
// during a session. Disposal must still remove every record and poll timer.
const WORKING_CEILING: Counts = {
  schedulerHandles: 2,
  busListeners: 12,
  historyListeners: 2,
  runningTasks: 1,
  trackedExecutions: 1,
  runningShellJobs: 1,
  retainedShellJobs: 4,
  shellPollTimers: 1,
  recordingServices: 1,
};

async function isolatedConfig(fixture: string): Promise<BuiltCliConfig> {
  const workingDir = mkdtempSync(join(tmpdir(), 'llxprt-s12-'));
  const hash = createHash('sha256').update(workingDir).digest('hex');
  const storageDir = join(homedir(), '.llxprt', 'tmp', hash);
  try {
    const built = await buildCliStyleConfig(fixture, { workingDir });
    return {
      ...built,
      cleanup: async () => {
        try {
          await built.cleanup();
        } finally {
          rmSync(workingDir, { recursive: true, force: true });
          rmSync(storageDir, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    rmSync(workingDir, { recursive: true, force: true });
    rmSync(storageDir, { recursive: true, force: true });
    throw error;
  }
}

function requiredObject(value: unknown, label: string): object {
  if (value === null || typeof value !== 'object') {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

function requiredMap(value: unknown, label: string): Map<unknown, unknown> {
  if (!(value instanceof Map)) throw new Error(`Missing ${label}`);
  return value;
}

function taskServices(agent: Agent): {
  manager: AsyncTaskManager;
  shellJobs: ShellJobManager;
} {
  const deps = requiredObject(Reflect.get(agent, 'deps'), 'AgentImpl deps');
  const services = requiredObject(
    Reflect.get(deps, 'taskServices'),
    'task services',
  );
  const manager: unknown = Reflect.get(services, 'manager');
  const shellJobs: unknown = Reflect.get(services, 'shellJobs');
  if (!(manager instanceof AsyncTaskManager)) {
    throw new Error('Missing session task owner');
  }
  if (!(shellJobs instanceof ShellJobManager)) {
    throw new Error('Missing session shell owner');
  }
  return { manager, shellJobs };
}

function historyListenerCount(agent: Agent): number {
  const history = captureHistoryServiceIdentity(agent);
  if (!(history instanceof EventEmitter)) {
    throw new Error('Missing HistoryService');
  }
  return history.listenerCount('contentAdded');
}

function sample(
  owner: string,
  stage: Stage,
  agent: Agent,
  liveSchedulers: ReadonlySet<object>,
): Sample {
  const { manager, shellJobs } = taskServices(agent);
  const busListeners = Object.values(MessageBusType).reduce(
    (sum, type) => sum + agent.getMessageBus().listenerCount(type),
    0,
  );
  return {
    owner,
    stage,
    counts: {
      schedulerHandles: liveSchedulers.size,
      busListeners,
      historyListeners: historyListenerCount(agent),
      runningTasks: manager.getRunningTasks().length,
      trackedExecutions: requiredMap(
        Reflect.get(manager, 'executions'),
        'task executions',
      ).size,
      runningShellJobs: shellJobs.getRunningJobs().length,
      retainedShellJobs: shellJobs.list().length,
      shellPollTimers: Reflect.get(shellJobs, 'capPollTimer') === null ? 0 : 1,
      recordingServices:
        agent.session.getActiveRecording() === undefined ? 0 : 1,
    },
  };
}

const COUNT_KEYS: ReadonlyArray<keyof Counts> = [
  'schedulerHandles',
  'busListeners',
  'historyListeners',
  'runningTasks',
  'trackedExecutions',
  'runningShellJobs',
  'retainedShellJobs',
  'shellPollTimers',
  'recordingServices',
];

function assertCeiling(observation: Sample, ceiling: Counts): void {
  for (const key of COUNT_KEYS) {
    expect(observation.counts[key]).toBeLessThanOrEqual(ceiling[key]);
  }
}

function countedSchedulers(live: Set<object>): ToolSchedulerFactory {
  return (options) => {
    const scheduler = createToolScheduler({
      ...options,
      toolRegistry: wrapRegistryWithConfirmation(options.toolRegistry),
    });
    const dispose = scheduler.dispose.bind(scheduler);
    live.add(scheduler);
    Object.defineProperty(scheduler, 'dispose', {
      value: () => {
        dispose();
        live.delete(scheduler);
      },
    });
    return scheduler;
  };
}

async function shellJob(agent: Agent): Promise<string> {
  const tool = agent.getToolRegistry().getTool('run_shell_command');
  if (tool === undefined) throw new Error('Missing shell tool');
  const command =
    os.platform() === 'win32' ? 'Start-Sleep -Seconds 30' : 'sleep 30';
  const response = await tool
    .build({ command, is_background: true })
    .execute(new AbortController().signal);
  const id = /Job ID: (shell_\w+)/.exec(String(response.llmContent))?.[1];
  if (id === undefined)
    throw new Error(
      `Shell did not start a job: ${String(response.llmContent)}`,
    );
  return id;
}

async function workload(
  agent: Agent,
  live: Set<object>,
  owner: string,
  samples: Sample[],
): Promise<void> {
  const { manager } = taskServices(agent);
  samples.push(sample(owner, 'created', agent, live));
  await agent.session.setRecording({ enabled: true });
  const schedulerOwner = { label: 'same-label' };
  const scheduler = await agent.scheduler.acquire(
    schedulerOwner,
    'session',
    { getPreferredEditor: () => undefined, onEditorClose: () => undefined },
    undefined,
    {
      messageBus: agent.getMessageBus(),
      toolRegistry: agent.getToolRegistry(),
    },
  );
  const jobId = await shellJob(agent);
  const abortController = new AbortController();
  const joined = new Promise<void>((resolve) =>
    abortController.signal.addEventListener('abort', () => resolve(), {
      once: true,
    }),
  );
  manager.registerTask({
    id: `${owner}-task`,
    subagentName: 'worker',
    goalPrompt: 'join on disposal',
    abortController,
  });
  manager.trackExecution(`${owner}-task`, joined);
  const responseListener = agent
    .getMessageBus()
    .subscribe(MessageBusType.TOOL_CONFIRMATION_RESPONSE, () => {});
  samples.push(sample(owner, 'working', agent, live));
  expect(agent.tasks.get(jobId)?.status).toBe('running');
  expect(agent.tasks.listRunning().map((task) => task.id)).toContain(
    `${owner}-task`,
  );
  responseListener();
  agent.scheduler.release(schedulerOwner, 'session', scheduler);
}

async function survivorTurnDuringCycles(
  agent: Agent,
  cycle: number,
): Promise<void> {
  if (cycle !== 0) return;
  const result = await agent.chat('survivor during cycles');
  expect(result.error).toBeUndefined();
  expect(result.text).toContain('turn one reply');
}

async function recordedModelTurn(
  agent: Agent,
  iteration: number,
): Promise<void> {
  if (iteration >= 2) return;
  const result = await agent.chat(`long session turn ${iteration}`);
  expect(result.error).toBeUndefined();
  expect(result.text).toContain(
    `turn ${iteration === 0 ? 'one' : 'two'} reply`,
  );
  if (iteration === 0) await agent.setProvider('fake', 'fake-model');
}

describe('S12 session resource retention', () => {
  it('bounds each same-label create/run/dispose cycle while a second Agent stays usable', async () => {
    const survivor = await isolatedConfig('multi-turn-text.jsonl');
    const survivorHandles = new Set<object>();
    const samples: Sample[] = [];
    let second: Agent | undefined;
    try {
      second = await fromConfig({
        config: survivor.config,
        messageBus: survivor.messageBus,
        sessionId: 'same-label',
        toolSchedulerFactory: countedSchedulers(survivorHandles),
      });
      for (let cycle = 0; cycle < 3; cycle++) {
        const built = await isolatedConfig('tool-call-then-answer.jsonl');
        const live = new Set<object>();
        let first: Agent | undefined;
        let responder:
          | ReturnType<typeof respondToFirstConfirmation>
          | undefined;
        try {
          first = await fromConfig({
            config: built.config,
            messageBus: built.messageBus,
            sessionId: 'same-label',
            toolSchedulerFactory: countedSchedulers(live),
          });
          const owner = `first-${cycle}`;
          responder = respondToFirstConfirmation(
            first,
            ToolConfirmationOutcome.ProceedOnce,
          );
          const turn = await first.chat(`cycle ${cycle}`);
          expect(turn.error).toBeUndefined();
          expect(turn.text).toContain('after the tool ran');
          expect(turn.toolCalls.some((call) => call.name === 'read_file')).toBe(
            true,
          );
          await responder.captured;
          responder.unsubscribe();
          await first.setProvider('fake', 'fake-model');
          expect(first.getModel()).toBe('fake-model');
          await workload(first, live, owner, samples);
          assertCeiling(samples[samples.length - 1], WORKING_CEILING);
          await first.dispose();
          const disposed = sample(owner, 'disposed', first, live);
          samples.push(disposed);
          assertCeiling(disposed, AFTER_DISPOSAL);
          expect(
            built.messageBus.listenerCount(
              MessageBusType.TOOL_CONFIRMATION_RESPONSE,
            ),
          ).toBe(0);
          expect(survivor.messageBus).toBe(second.getMessageBus());
          const surviving = sample(
            'second',
            'working',
            second,
            survivorHandles,
          );
          samples.push(surviving);
          assertCeiling(surviving, WORKING_CEILING);
          await survivorTurnDuringCycles(second, cycle);
        } finally {
          responder?.unsubscribe();
          await first?.dispose();
          await built.cleanup();
        }
      }
      const survivorTurn = await second.chat('survivor after cycles');
      expect(survivorTurn.error).toBeUndefined();
      expect(survivorTurn.text).toContain('turn two reply');
      await workload(second, survivorHandles, 'second', samples);
      await second.dispose();
      const disposed = sample('second', 'disposed', second, survivorHandles);
      samples.push(disposed);
      assertCeiling(disposed, AFTER_DISPOSAL);
      expect(
        samples.filter((entry) => entry.stage === 'disposed'),
      ).toHaveLength(4);
    } finally {
      await second?.dispose();
      await survivor.cleanup();
    }
  }, 90000);

  it('bounds a longer workload across turns, task joins, shell jobs, schedulers, approval listeners, and recording', async () => {
    const built = await isolatedConfig('multi-turn-text.jsonl');
    const live = new Set<object>();
    const samples: Sample[] = [];
    let agent: Agent | undefined;
    try {
      built.config.setEphemeralSetting('shell-max-background-jobs', 2);
      agent = await fromConfig({
        config: built.config,
        messageBus: built.messageBus,
        sessionId: 'same-label',
        toolSchedulerFactory: countedSchedulers(live),
      });
      for (let iteration = 0; iteration < 4; iteration++) {
        const owner = `long-${iteration}`;
        await workload(agent, live, owner, samples);
        assertCeiling(samples[samples.length - 1], WORKING_CEILING);
        await recordedModelTurn(agent, iteration);
        const job = agent.tasks
          .listRunning()
          .find((entry) => entry.kind === 'shell');
        if (job === undefined)
          throw new Error('Shell job missing during workload');
        expect(await agent.tasks.cancel(job.id)).toBe(true);
        const { manager } = taskServices(agent);
        expect(manager.cancelTask(`${owner}-task`)).toBe(true);
        await agent.session.setRecording({ enabled: false });
        samples.push(sample(owner, 'working', agent, live));
        assertCeiling(samples[samples.length - 1], WORKING_CEILING);
      }
      await agent.dispose();
      const disposed = sample('long-session', 'disposed', agent, live);
      samples.push(disposed);
      assertCeiling(disposed, AFTER_DISPOSAL);
      expect(samples.filter((entry) => entry.stage === 'created')).toHaveLength(
        4,
      );
    } finally {
      await agent?.dispose();
      await built.cleanup();
    }
  }, 90000);
});
