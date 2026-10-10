/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createSessionSettingsFixture } from './helpers/session-settings-fixture.js';

import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { describe, expect, it } from 'bun:test';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import {
  awaitShellGroupAbsence,
  deadline,
  shellOwnerGate,
  shellQuote,
} from './helpers/shell-owner-gate.js';
import { z } from 'zod';
import {
  ApprovalMode,
  fromConfig,
  toConfigParameters,
  type Agent,
  type AgentEvent,
} from '@vybestack/llxprt-code-agents';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';

export function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function responseChunk(
  child: boolean,
  launch: boolean,
  childShellCommand?: string,
  parentShellCommand?: string,
): string {
  const parentTool = parentShellCommand
    ? {
        id: 'launch-parent-shell',
        name: 'run_shell_command',
        args: { command: parentShellCommand, is_background: true },
      }
    : {
        id: 'launch-real-child',
        name: 'task',
        args: {
          subagent_name: 'background-child',
          goal_prompt: 'Return the word completed.',
          async: true,
        },
      };
  const tool = child
    ? {
        id: 'launch-child-shell',
        name: 'run_shell_command',
        args: { command: childShellCommand, is_background: true },
      }
    : parentTool;
  const delta = launch
    ? {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: tool.id,
            type: 'function',
            function: {
              name: tool.name,
              arguments: JSON.stringify(tool.args),
            },
          },
        ],
      }
    : { role: 'assistant', content: child ? 'child completed' : 'launched' };
  return (
    [
      {
        id: child ? 'child-response' : 'parent-response',
        object: 'chat.completion.chunk',
        model: child ? 'child-model' : 'parent-model',
        choices: [{ index: 0, delta, finish_reason: null }],
      },
      {
        id: child ? 'child-response' : 'parent-response',
        object: 'chat.completion.chunk',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: launch ? 'tool_calls' : 'stop',
          },
        ],
      },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join('') + 'data: [DONE]\n\n'
  );
}

export interface AsyncChildFixture {
  readonly agent: Agent;
  readonly trust: ReturnType<
    typeof createSessionSettingsFixture
  >['workspaceTrust'];
  readonly childStatus: Promise<{ status: string; error?: string }>;
  readonly requestedModels: readonly string[];
  readonly childEntered: ReturnType<typeof gate>;
  readonly childBody: ReturnType<typeof gate>;
  readonly childBodyFinished: ReturnType<typeof gate>;
  readonly manager: AsyncTaskManager;
}

export async function withAsyncChildFixture(
  scenario: (fixture: AsyncChildFixture) => Promise<void>,
  childShellCommand?: string,
  parentShellCommand?: string,
  exerciseTrust = false,
): Promise<void> {
  const directory = await mkdtemp(
    join(resolve('tmp'), 'async-child-background-'),
  );
  const http = createChildServer(
    childShellCommand,
    parentShellCommand,
    exerciseTrust,
  );
  let config: Config | undefined;
  let agent: Agent | undefined;
  const errors: unknown[] = [];
  try {
    const baseUrl = await http.listen();
    config = await createChildConfig(directory, baseUrl);
    const manager = new AsyncTaskManager(5);
    const settings = createSessionSettingsFixture(config);
    agent = await fromConfig({
      ...settings,
      trustPort: settings.workspaceTrust,
      runtimeFactoryBindings: createAgentRuntimeFactoryBindings(),
      config,
      asyncTaskManager: manager,
      activation: {
        provider: 'openai',
        model: 'parent-model',
        cliOverrides: { key: 'local-test-key', baseUrl },
      },
    });
    const childStatus = new Promise<{ status: string; error?: string }>(
      (resolve) => {
        const terminal = (task: { status: string; error?: string }): void => {
          resolve({ status: task.status, error: task.error });
        };
        manager.onTaskCompleted(terminal);
        manager.onTaskFailed(terminal);
        manager.onTaskCancelled(terminal);
      },
    );
    await scenario({
      agent,
      manager,
      trust: settings.workspaceTrust,
      childStatus,
      ...http,
    });
  } catch (error) {
    errors.push(error);
  } finally {
    http.childBody.release();
    http.parentBody.release();
    for (const cleanup of [
      async (): Promise<void> => agent?.dispose(),
      async (): Promise<void> => config?.dispose(),
      async (): Promise<void> => http.close(),
      async (): Promise<void> =>
        rm(directory, { recursive: true, force: true }),
    ]) {
      await cleanup().catch((error: unknown) => {
        errors.push(error);
      });
    }
  }
  if (errors.length > 0)
    throw new AggregateError(errors, 'Async child fixture failed');
}

function createChildServer(
  childShellCommand?: string,
  parentShellCommand?: string,
  exerciseTrust = false,
): Omit<AsyncChildFixture, 'agent' | 'manager' | 'trust' | 'childStatus'> & {
  listen: () => Promise<string>;
  close: () => Promise<void>;
  parentBody: ReturnType<typeof gate>;
} {
  const parentBody = gate();
  const requestedModels: string[] = [];
  const childEntered = gate();
  const childBody = gate();
  const childBodyFinished = gate();
  const handlers: Array<Promise<void>> = [];
  const errors: unknown[] = [];
  let parentRequests = 0;
  let childRequests = 0;
  const server = createServer((request, response) => {
    const work = (async (): Promise<void> => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = z
        .object({ model: z.string() })
        .parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      requestedModels.push(body.model);
      const child = body.model === 'child-model';
      if (child) {
        childRequests += 1;
        childEntered.release();
        parentBody.release();
        if (!childShellCommand || exerciseTrust) await childBody.promise;
        if (exerciseTrust && childRequests === 1) {
          response.writeHead(503, { 'Content-Type': 'application/json' });
          response.end(
            JSON.stringify({
              error: { message: 'retry this request', type: 'server_error' },
            }),
          );
          return;
        }
      } else {
        parentRequests += 1;
        if (parentRequests > 1 && !parentShellCommand) await parentBody.promise;
      }
      const toolChildAttempt = exerciseTrust ? 2 : 1;
      const includeTool = child
        ? childShellCommand !== undefined && childRequests === toolChildAttempt
        : parentRequests === 1;
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(
        responseChunk(
          child,
          includeTool,
          childShellCommand,
          parentShellCommand,
        ),
      );
      if (child && (!childShellCommand || childRequests > 1))
        childBodyFinished.release();
    })().catch((error: unknown) => {
      errors.push(error);
      response.destroy(error instanceof Error ? error : undefined);
    });
    handlers.push(work);
  });
  return {
    childEntered,
    childBody,
    childBodyFinished,
    parentBody,
    requestedModels,
    async listen(): Promise<string> {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (address === null || typeof address === 'string')
        throw new Error('No HTTP port');
      return `http://127.0.0.1:${address.port}/v1`;
    },
    async close(): Promise<void> {
      await Promise.all(handlers);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (errors.length > 0)
        throw new AggregateError(errors, 'HTTP fixture errors');
    },
  };
}

async function createChildConfig(
  directory: string,
  baseUrl: string,
): Promise<Config> {
  const profiles = new ProfileManager(join(directory, 'profiles'));
  await profiles.saveProfile('background-child', {
    version: 1,
    provider: 'openai',
    model: 'child-model',
    modelParams: {},
    ephemeralSettings: {
      'auth-key': 'local-test-key',
      'base-url': baseUrl,
    },
  });
  const subagents = new SubagentManager(join(directory, 'subagents'), profiles);
  await subagents.saveSubagent(
    'background-child',
    'background-child',
    'Complete the requested task.',
  );
  const config = new Config({
    ...toConfigParameters({
      provider: 'openai',
      model: 'parent-model',
      workingDir: directory,
      approvalMode: ApprovalMode.YOLO,
      folderTrust: true,
      interactive: false,
      coreTools: ['task', 'check_async_tasks', 'run_shell_command'],
      telemetry: { enabled: false },
      recording: { enabled: false },
    }),
    profileDirectory: join(directory, 'profiles'),
    subagentDirectory: join(directory, 'subagents'),
    sessionId: 'async-child-background-session',
  });
  return config;
}

describe('public Agent async child background isolation', () => {
  it.each([false, true])(
    'uses live parent trust for a child 503 retry and privileged write denial (abort=%s)',
    async (abortChild) => {
      const root = await mkdtemp(join(resolve('tmp'), 'child-live-trust-'));
      const marker = join(root, 'privileged.txt');
      try {
        await withAsyncChildFixture(
          async (fixture) => {
            const foreground = consumeForeground(fixture, false);
            await deadline(
              fixture.childEntered.promise,
              'child model admission',
            );
            await fixture.trust.setTrustedFolderLive(false);
            let cancelled: boolean | undefined;
            if (abortChild) {
              const child = fixture.manager.getAllTasks()[0];
              if (child.abortController === undefined)
                throw new Error('Missing child cancellation owner');
              cancelled = await fixture.agent.tasks.cancel(child.id);
            }
            fixture.childBody.release();
            await deadline(fixture.childStatus, 'child denied completion');
            await foreground;
            expect(existsSync(marker)).toBe(false);
            const task = fixture.manager.getAllTasks()[0];
            expect(cancelled).toBe(abortChild ? true : undefined);
            expect(task).toMatchObject(
              abortChild
                ? { status: 'cancelled' }
                : {
                    status: 'completed',
                    output: { terminate_reason: SubagentTerminateMode.ERROR },
                  },
            );
            expect(
              fixture.requestedModels.filter((model) => model === 'child-model')
                .length,
            ).toBeGreaterThanOrEqual(abortChild ? 1 : 2);
          },
          `printf privileged > ${shellQuote(marker)}`,
          undefined,
          true,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it.skipIf(process.platform === 'win32')(
    'joins a model-stream generated parent shell job through the public Agent task owner',
    async () => {
      const root = await mkdtemp(join(resolve('tmp'), 'parent-model-shell-'));
      const shellGate = await shellOwnerGate();
      const marker = join(root, 'parent.marker');
      const command = [
        'exec',
        shellQuote(process.execPath),
        shellQuote(
          resolve(
            resolveRepositoryFixture(
              import.meta.url,
              'packages/agents/src/api/__tests__/helpers/shell-owner-workload.ts',
            ),
          ),
        ),
        shellQuote(`${shellGate.url}/parent`),
        shellQuote(marker),
      ].join(' ');
      try {
        await withAsyncChildFixture(
          async ({ agent, requestedModels }) => {
            const events: AgentEvent[] = [];
            for await (const event of agent.stream(
              'Launch a parent shell job.',
              { mcpDiscovery: 'skip' },
            )) {
              events.push(event);
            }
            await deadline(
              shellGate.entered('parent'),
              'parent model shell launch',
            );
            expect(
              events.some(
                (event) =>
                  event.type === 'tool-call' &&
                  event.call.name === 'run_shell_command',
              ),
            ).toBe(true);
            expect(
              events.some(
                (event) =>
                  event.type === 'tool-result' &&
                  event.result.name === 'run_shell_command' &&
                  event.result.isError === false,
              ),
            ).toBe(true);
            expect(requestedModels).toStrictEqual([
              'parent-model',
              'parent-model',
            ]);
            const job = agent.tasks
              .list()
              .find(
                (task) => task.kind === 'shell' && task.command === command,
              );
            if (!job)
              throw new Error(
                'Model-generated shell job absent from Agent tasks',
              );
            expect(job.status).toBe('running');
            const query = agent.tools.get('check_async_tasks');
            if (!query) throw new Error('Missing Agent task query');
            const listing = await query.buildAndExecute(
              {},
              new AbortController().signal,
            );
            expect(JSON.stringify(listing.llmContent)).toContain(job.id);
            const pid = Number(await readFile(`${marker}.pid`, 'utf8'));
            const group = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], {
              encoding: 'utf8',
            });
            const pgid = Number(group.stdout.trim());
            if (group.status !== 0 || !Number.isSafeInteger(pgid) || pgid <= 1)
              throw new Error(
                `Cannot identify parent model shell group: ${group.stderr}`,
              );
            await deadline(agent.dispose(), 'parent model shell disposal');
            await awaitShellGroupAbsence(pgid);
            expect(agent.tasks.get(job.id)).toBeUndefined();
            expect(existsSync(marker)).toBe(false);
          },
          undefined,
          command,
        );
      } finally {
        await shellGate.stop();
        await rm(root, { recursive: true, force: true });
      }
    },
    30_000,
  );
  it.skipIf(process.platform === 'win32')(
    'lets the actual child scheduler launch a parent-owned background process beyond child completion',
    async () => {
      const root = await mkdtemp(join(resolve('tmp'), 'child-shell-owner-'));
      const shellGate = await shellOwnerGate();
      const marker = join(root, 'child.marker');
      const command = [
        'exec',
        shellQuote(process.execPath),
        shellQuote(
          resolve(
            resolveRepositoryFixture(
              import.meta.url,
              'packages/agents/src/api/__tests__/helpers/shell-owner-workload.ts',
            ),
          ),
        ),
        shellQuote(`${shellGate.url}/child`),
        shellQuote(marker),
      ].join(' ');
      try {
        await withAsyncChildFixture(async (fixture) => {
          await deadline(
            consumeForeground(fixture, false),
            'parent task launch',
          );
          await deadline(
            shellGate.entered('child'),
            'child scheduler shell launch',
          );
          expect(
            await deadline(fixture.childStatus, 'child completion'),
          ).toMatchObject({
            status: 'completed',
          });
          const shell = fixture.agent.tasks
            .list()
            .find((task) => task.kind === 'shell' && task.command === command);
          if (!shell)
            throw new Error('Child shell job absent from parent Agent');
          expect(shell.status).toBe('running');
          expect(shellGate.connected('child')).toBe(true);
          const query = fixture.agent.tools.get('check_async_tasks');
          if (!query) throw new Error('Missing public Agent task query');
          const listing = await query.buildAndExecute(
            {},
            new AbortController().signal,
          );
          expect(JSON.stringify(listing.llmContent)).toContain(shell.id);
          await deadline(
            fixture.agent.dispose(),
            'parent child-shell disposal',
          );
          expect(existsSync(marker)).toBe(false);
          expect(fixture.agent.tasks.get(shell.id)).toBeUndefined();
        }, command);
      } finally {
        await shellGate.stop();
        await rm(root, { recursive: true, force: true });
      }
    },
    30_000,
  );
  it('completes an authorized async child while foreground consumption is paused', async () => {
    expect.hasAssertions();
    await runScenario(true);
  });

  it('preserves an authorized async child across normal foreground completion', async () => {
    expect.hasAssertions();
    await runScenario(false);
  });

  it('public task cancellation aborts the controller driving the accepted child', async () => {
    await withAsyncChildFixture(async (fixture) => {
      await consumeForeground(fixture, false);
      const [task] = fixture.agent.tasks.list();
      expect(task.status).toBe('running');
      expect(await fixture.agent.tasks.cancel(task.id)).toBe(true);
      expect(
        fixture.manager.getTask(task.id)?.abortController?.signal.aborted,
      ).toBe(true);
      expect(await fixture.childStatus).toMatchObject({ status: 'cancelled' });
    });
  });

  it('cancelling one owner leaves the same-label owner child running', async () => {
    await withAsyncChildFixture(async (first) => {
      await withAsyncChildFixture(async (second) => {
        await consumeForeground(first, false);
        await consumeForeground(second, false);
        const [firstTask] = first.agent.tasks.list();
        const [secondTask] = second.agent.tasks.list();
        expect(first.manager.getTask(firstTask.id)?.subagentName).toBe(
          second.manager.getTask(secondTask.id)?.subagentName,
        );
        expect(await first.agent.tasks.cancel(firstTask.id)).toBe(true);
        expect(
          first.manager.getTask(firstTask.id)?.abortController?.signal.aborted,
        ).toBe(true);
        expect(
          second.manager.getTask(secondTask.id)?.abortController?.signal
            .aborted,
        ).toBe(false);
        expect(second.agent.tasks.get(secondTask.id)?.status).toBe('running');
        second.childBody.release();
        expect(await second.childStatus).toMatchObject({ status: 'completed' });
      });
    });
  });
});

async function runScenario(finishChildFirst: boolean): Promise<void> {
  await withAsyncChildFixture(async (fixture) => {
    const events = await consumeForeground(fixture, finishChildFirst);
    if (!finishChildFirst) {
      expect(fixture.agent.tasks.list()[0].status).toBe('running');
    }
    fixture.childBody.release();
    await fixture.childBodyFinished.promise;
    const terminal = await fixture.childStatus;
    expect(events.filter((event) => event.type === 'error')).toStrictEqual([]);
    const results = events.filter((event) => event.type === 'tool-result');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      result: { name: 'task', isError: false },
    });
    expect(JSON.stringify(results)).toContain(fixture.agent.tasks.list()[0].id);
    expect(events[events.length - 1]).toMatchObject({
      type: 'done',
      reason: 'stop',
    });
    expect(fixture.requestedModels).toStrictEqual([
      'parent-model',
      'child-model',
      'parent-model',
    ]);
    expect(terminal).toMatchObject({ status: 'completed' });
  });
}

async function consumeForeground(
  fixture: AsyncChildFixture,
  finishChildFirst: boolean,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  let childObserved = false;
  for await (const event of fixture.agent.stream(
    'Launch the child asynchronously.',
    { mcpDiscovery: 'skip' },
  )) {
    events.push(event);
    if (
      !childObserved &&
      event.type === 'tool-status' &&
      event.update.status === 'executing'
    ) {
      childObserved = true;
      const first = await Promise.race([
        fixture.childEntered.promise.then(() => ({ outcome: 'http' })),
        fixture.childStatus.then((terminal) => ({
          outcome: 'terminal',
          terminal,
        })),
      ]);
      expect(first).toStrictEqual({ outcome: 'http' });
      expect(fixture.agent.tasks.list()).toHaveLength(1);
      expect(fixture.agent.tasks.list()[0].status).toBe('running');
      if (finishChildFirst) {
        fixture.childBody.release();
        expect(await fixture.childStatus).toMatchObject({
          status: 'completed',
        });
      }
    }
  }
  expect(childObserved).toBe(true);
  return events;
}
