/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { z } from 'zod';
import {
  gate,
  withDisposalJoinFixture,
} from './helpers/async-child-disposal-join-fixture.js';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import { makeScratchDir } from './helpers/scratch-dir.js';
import {
  awaitShellGroupAbsence,
  deadline,
  shellOwnerGate,
  shellQuote,
} from './helpers/shell-owner-gate.js';

function modelResponse(name?: string, args?: object): Response {
  const delta = name
    ? {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: `child-${name}`,
            type: 'function',
            function: { name, arguments: JSON.stringify(args ?? {}) },
          },
        ],
      }
    : { role: 'assistant', content: 'Child work finished.' };
  return new Response(
    [
      { choices: [{ index: 0, delta, finish_reason: null }] },
      {
        choices: [
          { index: 0, delta: {}, finish_reason: name ? 'tool_calls' : 'stop' },
        ],
      },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join('') + 'data: [DONE]\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}

describe('admitted child tool acquisition lifetime', () => {
  it.skipIf(process.platform === 'win32')(
    'queries and launches through its own owners and joins held work without retiring peers of a second agent',
    async () => {
      const directory = await makeScratchDir('child-acquisition-lifetime-');
      const shells = await shellOwnerGate();
      const held = gate();
      const released = gate();
      const aborted = gate();
      const command = (label: string): string =>
        [
          'exec',
          shellQuote(process.execPath),
          shellQuote(
            resolveRepositoryFixture(
              import.meta.url,
              'packages/agents/src/api/__tests__/helpers/shell-owner-workload.ts',
            ),
          ),
          shellQuote(`${shells.url}/${label}`),
          shellQuote(join(directory, label)),
        ].join(' ');
      try {
        await withDisposalJoinFixture(
          async (fixture) => {
            const sibling = await fixture.openSibling();
            const peerShellTool = sibling.tools.get('run_shell_command');
            const peerTaskTool = sibling.tools.get('task');
            const taskTool = fixture.agent.tools.get('task');
            if (!peerShellTool || !peerTaskTool || !taskTool)
              throw new Error('Missing admitted task or shell tool');
            expect(
              (
                await peerShellTool.buildAndExecute(
                  { command: command('peer'), is_background: true },
                  new AbortController().signal,
                )
              ).error,
            ).toBeUndefined();
            await deadline(shells.entered('peer'), 'peer shell admission');
            expect(
              (
                await peerTaskTool.buildAndExecute(
                  {
                    subagent_name: 'sibling-child',
                    goal_prompt: 'Wait for release.',
                    async: true,
                  },
                  new AbortController().signal,
                )
              ).error,
            ).toBeUndefined();
            await fixture.siblingWork.entered.promise;
            const peerIds = sibling.tasks.list().map((task) => task.id);
            expect(peerIds).toHaveLength(2);
            const queryResults: string[] = [];
            let requests = 0;
            let childSignal: AbortSignal | undefined;
            const clearScript = fixture.scriptChildRequests(async (request) => {
              const body = z
                .object({
                  messages: z.array(
                    z.object({
                      role: z.string(),
                      content: z.unknown().optional(),
                    }),
                  ),
                })
                .parse(JSON.parse(request.body));
              requests += 1;
              if (requests === 3) {
                const results = body.messages.filter(
                  (message) => message.role === 'tool',
                );
                const queryResult = results[results.length - 1];
                queryResults.push(JSON.stringify(queryResult.content));
              }
              if (requests === 1)
                return modelResponse('run_shell_command', {
                  command: command('owned'),
                  is_background: true,
                });
              if (requests === 2) return modelResponse('check_async_tasks', {});
              childSignal = request.signal;
              childSignal.addEventListener('abort', aborted.release, {
                once: true,
              });
              held.release();
              await released.promise;
              return modelResponse();
            });
            try {
              expect(
                (
                  await taskTool.buildAndExecute(
                    {
                      subagent_name: 'disposal-child',
                      goal_prompt: 'Launch a background job and query tasks.',
                      async: true,
                    },
                    new AbortController().signal,
                  )
                ).error,
              ).toBeUndefined();
              await deadline(held.promise, 'child query followed by held work');
              await deadline(shells.entered('owned'), 'owned child shell');
              const owned = fixture.agent.tasks.list();
              expect(owned).toHaveLength(2);
              const ownedShellIds = owned
                .filter((task) => task.kind === 'shell')
                .map((task) => task.id);
              expect(ownedShellIds).toHaveLength(1);
              expect(queryResults).toHaveLength(1);
              for (const task of owned)
                expect(queryResults[0]).toContain(task.id);
              for (const id of peerIds)
                expect(queryResults[0]).not.toContain(id);
              const ownedPid = Number(
                await readFile(join(directory, 'owned.pid'), 'utf8'),
              );
              let disposed = false;
              const closing = fixture.agent.dispose().then(() => {
                disposed = true;
              });
              try {
                await deadline(
                  aborted.promise,
                  'held child owner cancellation',
                );
                await setImmediate();
                expect(childSignal?.aborted).toBe(true);
                expect(disposed).toBe(false);
                expect(fixture.siblingWork.signal()?.aborted).toBe(false);
                expect(shells.connected('peer')).toBe(true);
                released.release();
                await deadline(closing, 'owned child and shell disposal join');
                await awaitShellGroupAbsence(ownedPid);
                expect(disposed).toBe(true);
                expect(existsSync(join(directory, 'owned'))).toBe(false);
                expect(fixture.agent.tasks.listRunning()).toStrictEqual([]);
                expect(
                  fixture.agent.tasks.get(ownedShellIds[0]),
                ).toBeUndefined();
                expect(
                  fixture.agent.tasks.list().map((task) => task.status),
                ).toStrictEqual(['cancelled']);
                expect(
                  peerIds.map((id) => sibling.tasks.get(id)?.status),
                ).toStrictEqual(['running', 'running']);
                expect(fixture.siblingWork.isWorkSettled()).toBe(false);
                expect(shells.connected('peer')).toBe(true);
              } finally {
                released.release();
                await closing;
              }
            } finally {
              clearScript();
              released.release();
              fixture.siblingWork.releaseWork();
              await sibling.dispose();
            }
          },
          undefined,
          ['run_shell_command'],
        );
      } finally {
        released.release();
        await shells.stop();
        await rm(directory, { recursive: true, force: true });
      }
    },
    30000,
  );
});
