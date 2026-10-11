/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Agent } from '../agent.js';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { escapeShellArg } from '@vybestack/llxprt-code-core/utils/shell-utils.js';
import { withRecordingLifetimeFixture } from './helpers/recording-owner-lifetime-fixture.js';

async function waitForMarker(
  path: string,
  startup: () => unknown = () => undefined,
): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!existsSync(path)) {
    if (Date.now() > deadline)
      throw new Error(
        `Missing public hook marker: ${path}; startup=${JSON.stringify(startup())}`,
      );
    await sleep(10);
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH')
      return false;
    throw error;
  }
}

async function drainStream(
  agent: Agent,
  signal?: AbortSignal,
): Promise<string> {
  const text: string[] = [];
  for await (const event of agent.stream('ordinary model traffic', {
    signal,
  })) {
    if (event.type === 'error') throw new Error(event.error.message);
    if (event.type === 'text') text.push(event.text);
  }
  return text.join('');
}

function rejectedReasons(
  results: ReadonlyArray<PromiseSettledResult<unknown>>,
): unknown[] {
  return results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
}

async function withUnrelatedProcess(
  directory: string,
  exercise: () => Promise<void>,
): Promise<void> {
  const marker = join(directory, 'unrelated.pid');
  const child = spawn(
    process.execPath,
    [
      '-e',
      `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, String(process.pid));
setInterval(() => {}, 1000);`,
    ],
    { detached: true, stdio: 'ignore' },
  );
  const completed = Promise.allSettled([
    new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', () => resolve());
    }),
  ]);
  const failures: unknown[] = [];
  try {
    await waitForMarker(marker);
    const pid = Number(await readFile(marker, 'utf8'));
    await exercise();
    expect(isPidAlive(pid)).toBe(true);
  } catch (error) {
    failures.push(error);
  } finally {
    child.kill('SIGTERM');
    failures.push(...rejectedReasons(await completed));
  }
  if (failures.length > 0)
    throw new AggregateError(failures, 'Unrelated process fixture failed');
}

async function createPhysicalHooks(directory: string): Promise<string> {
  const script = join(directory, 'hook.ts');
  const child = join(directory, 'descendant.ts');
  await writeFile(
    child,
    `import { writeFileSync } from 'node:fs';
process.on('SIGTERM', () => {});
writeFileSync(${JSON.stringify(join(directory, 'child.pid'))}, String(process.pid));
await Bun.sleep(1500);
writeFileSync(${JSON.stringify(join(directory, 'late'))}, 'privileged');
`,
  );
  await writeFile(
    script,
    `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const input = JSON.parse(await Bun.stdin.text());
if (input.hook_event_name === 'BeforeAgent') {
  spawn(process.execPath, [${JSON.stringify(child)}], { stdio: 'inherit' });
  await Bun.sleep(3000);
} else {
  writeFileSync(${JSON.stringify(join(directory, 'peer'))}, input.session_id);
  console.log(JSON.stringify({systemMessage: 'peer ready'}));
}
`,
  );
  return `exec ${escapeShellArg(process.execPath, 'bash')} ${escapeShellArg(script, 'bash')}`;
}

describe('public Agent hook shutdown', () => {
  it('delivers the public final event to an actual pipe consumer', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'public-hook-input-'));
    const input = join(directory, 'input');
    try {
      await withRecordingLifetimeFixture(
        async ({ agent }) => {
          await agent.hooks.triggerSessionEnd();
          const data: unknown = JSON.parse(await readFile(input, 'utf8'));
          expect(data).toMatchObject({
            hook_event_name: 'SessionEnd',
            session_id: agent.getRuntimeId(),
          });
        },
        undefined,
        {
          hooks: {
            SessionEnd: [
              {
                hooks: [
                  {
                    type: HookType.Command,
                    command: `cat > ${escapeShellArg(input, 'bash')}`,
                  },
                ],
              },
            ],
          },
        },
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')(
    'joins one delayed final hook across concurrent and reentrant disposal while retaining its peer',
    async () => {
      const evidence = await mkdtemp(join(tmpdir(), 'public-hook-final-'));
      const script = join(evidence, 'final.ts');
      const released = join(evidence, 'released');
      const failures: unknown[] = [];
      try {
        await writeFile(
          script,
          `import { appendFileSync, writeFileSync, existsSync } from 'node:fs';
const input = JSON.parse(await Bun.stdin.text());
appendFileSync(${JSON.stringify(join(evidence, 'events'))}, input.session_id + '\\n');
writeFileSync(${JSON.stringify(join(evidence, 'entered'))}, input.session_id);
while (!existsSync(${JSON.stringify(released)})) await Bun.sleep(10);
console.log(JSON.stringify({systemMessage: 'final process joined'}));
`,
        );
        await withRecordingLifetimeFixture(
          async ({ agent, borrow, settingsService }) => {
            const peer = await borrow();
            const observed: string[] = [];
            const startup: unknown[] = [];
            let reentrant: Promise<void> | undefined;
            const unsubscribe = agent.hooks.onHookExecution(
              (request, response) => {
                if (request.event === HookEventName.SessionEnd) {
                  startup.push(response);
                  observed.push(
                    response.output.systemMessage ?? 'missing final output',
                  );
                  reentrant = agent.dispose();
                }
              },
            );
            const first = agent.dispose();
            const completed = Promise.allSettled([first]);
            const second = agent.dispose();
            try {
              await waitForMarker(join(evidence, 'entered'), () => startup);
              expect(second).toBe(first);
              expect(observed).toStrictEqual([]);
              await expect(agent.hooks.triggerSessionEnd()).rejects.toThrow(
                'disposed',
              );
              expect(await readFile(join(evidence, 'entered'), 'utf8')).toBe(
                agent.getRuntimeId(),
              );
              await writeFile(released, 'release final hook');
              const results = await completed;
              expect(results).toStrictEqual([
                { status: 'fulfilled', value: undefined },
              ]);
              expect(reentrant).toBe(first);
              expect(observed).toStrictEqual(['final process joined']);
              await agent.dispose();
              expect(
                (await readFile(join(evidence, 'events'), 'utf8'))
                  .trim()
                  .split('\n'),
              ).toStrictEqual([agent.getRuntimeId()]);
              expect(settingsService.getAllGlobalSettings()).toBeDefined();
              await peer.hooks.triggerSessionEnd();
              expect(
                (await readFile(join(evidence, 'events'), 'utf8'))
                  .trim()
                  .split('\n'),
              ).toStrictEqual([agent.getRuntimeId(), peer.getRuntimeId()]);
            } finally {
              await writeFile(released, 'fixture release');
              unsubscribe();
              await completed;
            }
          },
          undefined,
          {
            hooks: {
              [HookEventName.SessionEnd]: [
                {
                  hooks: [
                    {
                      type: HookType.Command,
                      command: `exec ${escapeShellArg(process.execPath, 'bash')} ${escapeShellArg(script, 'bash')}`,
                    },
                  ],
                },
              ],
            },
          },
        );
      } catch (error) {
        failures.push(error);
      } finally {
        failures.push(
          ...rejectedReasons(
            await Promise.allSettled([
              rm(evidence, { recursive: true, force: true }),
            ]),
          ),
        );
      }
      if (failures.length > 0)
        throw new AggregateError(failures, 'Delayed final hook fixture failed');
    },
  );
  it.skipIf(process.platform === 'win32').each([
    { order: 'first', action: 'dispose' },
    { order: 'second', action: 'dispose' },
    { order: 'first', action: 'cancel' },
    { order: 'second', action: 'cancel' },
    { order: 'first', action: 'trust' },
    { order: 'second', action: 'trust' },
  ])(
    'joins a held hook descendant for %j and keeps its peer usable',
    async ({ order, action }) => {
      const evidence = await mkdtemp(join(tmpdir(), 'public-hook-shutdown-'));
      const failures: unknown[] = [];
      try {
        const hook = {
          type: HookType.Command,
          command: await createPhysicalHooks(evidence),
        };
        await withUnrelatedProcess(evidence, () =>
          withRecordingLifetimeFixture(
            async ({ agent, borrow, settingsService }) => {
              const second = await borrow();
              const retiring = order === 'first' ? agent : second;
              const peer = order === 'first' ? second : agent;
              const controller = new AbortController();
              const cancellationReason = new Error(
                'public hook turn cancellation',
              );
              const startup: unknown[] = [];
              const unsubscribeStartup = retiring.hooks.onHookExecution(
                (request, response) => {
                  startup.push({ request, response });
                },
              );
              const completed = Promise.allSettled([
                drainStream(retiring, controller.signal),
              ]);
              const bodyFailures: unknown[] = [];
              let disposalBoundaryAlive: boolean | undefined;
              try {
                const pidFile = join(evidence, 'child.pid');
                await waitForMarker(pidFile, () => startup);
                const pid = Number(await readFile(pidFile, 'utf8'));
                if (action === 'dispose') {
                  await retiring.dispose();
                  disposalBoundaryAlive = isPidAlive(pid);
                } else if (action === 'cancel')
                  controller.abort(cancellationReason);
                else await retiring.ide.setTrustedFolderLive(false);
                const [result] = await completed;
                const expected: {
                  status: PromiseSettledResult<string>['status'];
                  reason: unknown;
                } =
                  action === 'trust'
                    ? { status: 'fulfilled', reason: undefined }
                    : {
                        status: 'rejected',
                        reason:
                          action === 'cancel'
                            ? cancellationReason
                            : expect.any(Error),
                      };
                expect({
                  status: result.status,
                  reason:
                    result.status === 'rejected' ? result.reason : undefined,
                }).toStrictEqual(expected);
                expect(disposalBoundaryAlive).toBe(
                  action === 'dispose' ? false : undefined,
                );
                expect(pid).toBeGreaterThan(1);
                expect(isPidAlive(pid)).toBe(false);
                await sleep(1600);
                expect(existsSync(join(evidence, 'late'))).toBe(false);
                const ordinaryText =
                  action === 'trust' ? await drainStream(peer) : 'not revoked';
                expect(ordinaryText.length).toBeGreaterThan(0);
                if (action === 'trust')
                  await retiring.ide.setTrustedFolderLive(true);
                await peer.hooks.triggerSessionEnd();
                expect(await readFile(join(evidence, 'peer'), 'utf8')).toBe(
                  peer.getRuntimeId(),
                );
                expect(peer.getMessageBus()).toBe(retiring.getMessageBus());
                expect(settingsService.getAllGlobalSettings()).toBeDefined();
              } catch (error) {
                bodyFailures.push(error);
              } finally {
                unsubscribeStartup();
                controller.abort(new Error('public hook fixture cleanup'));
                bodyFailures.push(
                  ...rejectedReasons(
                    await Promise.allSettled([retiring.dispose()]),
                  ),
                );
                await completed;
              }
              if (bodyFailures.length > 0)
                throw new AggregateError(
                  bodyFailures,
                  'Public hook lifetime fixture failed',
                );
            },
            undefined,
            {
              hooks: {
                [HookEventName.BeforeAgent]: [{ hooks: [hook] }],
                [HookEventName.SessionEnd]: [{ hooks: [hook] }],
              },
            },
          ),
        );
      } catch (error) {
        failures.push(error);
      } finally {
        failures.push(
          ...rejectedReasons(
            await Promise.allSettled([
              rm(evidence, { recursive: true, force: true }),
            ]),
          ),
        );
      }
      if (failures.length > 0)
        throw new AggregateError(
          failures,
          'Public hook shutdown fixture failed',
        );
    },
  );
});
