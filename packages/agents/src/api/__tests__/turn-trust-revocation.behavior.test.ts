/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createSessionSettingsFixture } from './helpers/session-settings-fixture.js';

import { describe, expect, it } from 'bun:test';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { json } from 'node:stream/consumers';
import {
  fromConfig,
  toConfigParameters,
  type Agent,
  type AgentEvent,
} from '@vybestack/llxprt-code-agents';

import {
  Config,
  ApprovalMode,
} from '@vybestack/llxprt-code-core/config/config.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';

function barrier(): { promise: Promise<void>; release(): void } {
  let release = (): void => {
    throw new Error('Uninitialized barrier');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function transport(): Promise<{
  url: string;
  entered: Promise<void>;
  release(): void;
  requestTool(path: string, hold?: boolean): void;
  stop(): Promise<void>;
}> {
  const entered = barrier();
  const release = barrier();
  let nextTool: { path: string; hold: boolean } | undefined;
  const server = createServer((request, reply) => {
    if (request.url === '/v1/models') {
      reply
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ object: 'list', data: [] }));
      return;
    }
    void json(request)
      .then(async (): Promise<void> => {
        const tool = nextTool;
        nextTool = undefined;
        if (tool?.hold === true) {
          entered.release();
          await release.promise;
        }
        const delta = tool
          ? {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'same-write-call',
                  type: 'function',
                  function: {
                    name: 'write_file',
                    arguments: JSON.stringify({
                      file_path: tool.path,
                      content: 'authorized marker',
                    }),
                  },
                },
              ],
            }
          : { role: 'assistant', content: 'Finished.' };
        const chunk = {
          id: 'same-completion',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'trust-conformance',
          choices: [
            { index: 0, delta, finish_reason: tool ? 'tool_calls' : 'stop' },
          ],
        };
        reply
          .writeHead(200, { 'content-type': 'text/event-stream' })
          .end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
      })
      .catch((cause: unknown) => {
        reply.destroy(new Error('Invalid loopback request', { cause }));
      });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Expected TCP address');
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    entered: entered.promise,
    release: release.release,
    requestTool: (path, hold = false) => {
      nextTool = { path, hold };
    },
    stop: async () => {
      release.release();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        server.closeAllConnections();
      });
    },
  };
}

interface Observation {
  readonly events: readonly AgentEvent[];
  readonly markerAtConfirmation: readonly boolean[];
  readonly rejection?: unknown;
}

async function collect(
  agent: Agent,
  marker: string,
  signal: AbortSignal,
): Promise<Observation> {
  let events: readonly AgentEvent[] = [];
  let markerAtConfirmation: readonly boolean[] = [];
  const answered = new Set<string>();
  try {
    for await (const event of agent.stream('Write the requested marker.', {
      promptId: 'same-prompt',
      mcpDiscovery: 'skip',
      signal,
    })) {
      events = [...events, event];
      if (
        event.type === 'tool-confirmation' &&
        !answered.has(event.confirmation.confirmationId)
      ) {
        answered.add(event.confirmation.confirmationId);
        markerAtConfirmation = [...markerAtConfirmation, existsSync(marker)];
        agent
          .getMessageBus()
          .respondToConfirmation(
            event.confirmation.confirmationId,
            ToolConfirmationOutcome.Cancel,
          );
      }
    }
    return { events, markerAtConfirmation };
  } catch (rejection) {
    return { events, markerAtConfirmation, rejection };
  }
}

function completed(observation: Observation): void {
  expect(observation.rejection).toBeUndefined();
  expect(
    observation.events.filter((event) => event.type === 'error'),
  ).toStrictEqual([]);
  expect(
    observation.events.filter((event) => event.type === 'done'),
  ).toMatchObject([{ type: 'done', reason: 'stop' }]);
}

function restoreEnvironment(
  environment: Record<string, string | undefined>,
): void {
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('Live workspace authority in captured turns', () => {
  it.each([ApprovalMode.AUTO_EDIT, ApprovalMode.YOLO])(
    'revokes workspace authority during an admitted turn without revoking a same-label sibling (#637, #2616) with mode %s',
    async (approvalMode: ApprovalMode) => {
      const evidence = join(tmpdir(), 'llxprt-turn-trust-conformance');
      await mkdir(evidence, { recursive: true });
      const directory = await mkdtemp(join(evidence, 'fixture-'));
      const environment = Object.fromEntries(
        ['LLXPRT_CONFIG_HOME', 'LLXPRT_DATA_HOME', 'LLXPRT_FAKE_RESPONSES'].map(
          (key) => [key, process.env[key]],
        ),
      );
      process.env.LLXPRT_CONFIG_HOME = join(directory, 'home');
      process.env.LLXPRT_DATA_HOME = join(directory, 'data');
      delete process.env.LLXPRT_FAKE_RESPONSES;
      const controller = new AbortController();
      let endpoints: ReadonlyArray<Awaited<ReturnType<typeof transport>>> = [];
      let owners: ReadonlyArray<{ agent: Agent; config: Config }> = [];
      let pending: ReadonlyArray<Promise<Observation>> = [];
      const start = (agent: Agent, marker: string): Promise<Observation> => {
        const result = collect(agent, marker, controller.signal);
        pending = [...pending, result];
        return result;
      };
      const owner = async (
        name: string,
      ): Promise<{
        agent: Agent;
        config: Config;
        endpoint: Awaited<ReturnType<typeof transport>>;
        workingDir: string;
      }> => {
        const endpoint = await transport();
        endpoints = [...endpoints, endpoint];
        const workingDir = join(directory, name);
        await mkdir(workingDir);
        const config = new Config({
          ...toConfigParameters({
            provider: 'openai',
            model: 'trust-conformance',
            workingDir,
            sessionId: 'same-trust-label',
            folderTrust: true,
            approvalMode,
            telemetry: { enabled: false },
            recording: { enabled: false },
            mcpEnabled: false,
            skillsSupport: false,
          }),
          interactive: true,
        });
        const agent = await fromConfig({
          ...createSessionSettingsFixture(config),
          config,
          sessionId: 'same-trust-label',
          activation: {
            provider: 'openai',
            model: 'trust-conformance',
            cliOverrides: { key: 'local-trust-only', baseUrl: endpoint.url },
          },
        });

        owners = [...owners, { agent, config }];
        return { agent, config, endpoint, workingDir };
      };
      try {
        const a = await owner('a');
        const b = await owner('b');
        expect(a.agent.getRuntimeId()).toBe(b.agent.getRuntimeId());
        expect(a.agent.getMessageBus()).not.toBe(b.agent.getMessageBus());
        expect(a.agent.agentClient.tools).not.toBe(b.agent.agentClient.tools);
        expect(a.agent.getMessageBus()).not.toBe(b.agent.getMessageBus());
        expect(a.agent.ide.isTrustedFolder()).toBe(true);
        expect(a.agent.getApprovalMode()).toBe(approvalMode);

        const baselineMarker = join(a.workingDir, 'baseline.txt');
        a.endpoint.requestTool(baselineMarker);
        const baseline = await start(a.agent, baselineMarker);
        await writeFile(
          join(evidence, 'authorized-baseline.json'),
          JSON.stringify(baseline, null, 2),
        );
        completed(baseline);
        expect(baseline.markerAtConfirmation).toStrictEqual([]);
        expect(
          baseline.events.filter((event) => event.type === 'tool-result'),
        ).toMatchObject([{ result: { name: 'write_file', isError: false } }]);
        expect(await readFile(baselineMarker, 'utf8')).toBe(
          'authorized marker',
        );

        const revokedMarker = join(a.workingDir, 'revoked.txt');
        a.endpoint.requestTool(revokedMarker, true);
        const revokedTurn = start(a.agent, revokedMarker);
        await Promise.race([
          a.endpoint.entered,
          revokedTurn.then((observation) => {
            throw new Error(
              `Turn ended before HTTP barrier: ${JSON.stringify(observation)}`,
            );
          }),
        ]);
        expect(a.agent.ide.isTrustedFolder()).toBe(true);
        expect(a.agent.getApprovalMode()).toBe(approvalMode);
        await a.agent.ide.setTrustedFolderLive(false);
        expect(a.agent.ide.isTrustedFolder()).toBe(false);
        expect(a.agent.getApprovalMode()).toBe(ApprovalMode.DEFAULT);

        const siblingMarker = join(b.workingDir, 'sibling.txt');
        b.endpoint.requestTool(siblingMarker);
        const sibling = await start(b.agent, siblingMarker);
        await writeFile(
          join(evidence, 'sibling.json'),
          JSON.stringify(sibling, null, 2),
        );
        completed(sibling);
        expect(b.agent.ide.isTrustedFolder()).toBe(true);
        expect(b.agent.getApprovalMode()).toBe(approvalMode);
        expect(sibling.markerAtConfirmation).toStrictEqual([]);
        expect(
          sibling.events.filter((event) => event.type === 'tool-result'),
        ).toMatchObject([{ result: { name: 'write_file', isError: false } }]);
        expect(await readFile(siblingMarker, 'utf8')).toBe('authorized marker');

        a.endpoint.release();
        const revoked = await revokedTurn;
        await writeFile(
          join(evidence, 'revoked-tool-result.json'),
          JSON.stringify(revoked, null, 2),
        );
        completed(revoked);
        expect(revoked.markerAtConfirmation).toStrictEqual([false]);
        expect(
          revoked.events.filter((event) => event.type === 'tool-result'),
        ).toMatchObject([
          {
            result: {
              name: 'write_file',
              isError: true,
              output: [
                {
                  result: {
                    error:
                      '[Operation Cancelled] Reason: User did not allow tool call',
                  },
                },
              ],
            },
          },
        ]);
        expect(
          revoked.events.filter((event) => event.type === 'tool-confirmation'),
        ).toMatchObject([
          {
            confirmation: {
              name: 'write_file',
              details: { filePath: revokedMarker },
            },
          },
        ]);
        expect(
          revoked.events.filter(
            (event) =>
              event.type === 'tool-status' &&
              event.update.status === 'executing',
          ),
        ).toStrictEqual([]);
        expect(existsSync(revokedMarker)).toBe(false);
        await writeFile(
          join(evidence, 'markers.json'),
          JSON.stringify(
            {
              authorizedBaseline: await readFile(baselineMarker, 'utf8'),
              revokedMarkerExists: existsSync(revokedMarker),
              sibling: await readFile(siblingMarker, 'utf8'),
              aTrusted: a.agent.ide.isTrustedFolder(),
              aApprovalMode: a.agent.getApprovalMode(),
              bTrusted: b.agent.ide.isTrustedFolder(),
              bApprovalMode: b.agent.getApprovalMode(),
            },
            null,
            2,
          ),
        );
      } finally {
        controller.abort();
        for (const endpoint of endpoints) endpoint.release();
        try {
          await Promise.all(pending);
          await Promise.all(
            owners.map(async ({ agent, config }) => {
              try {
                await agent.dispose();
              } finally {
                await config.dispose();
              }
            }),
          );
        } finally {
          await Promise.all(endpoints.map((endpoint) => endpoint.stop()));
          restoreEnvironment(environment);
          await rm(directory, { recursive: true, force: true });
        }
      }
    },
    30_000,
  );
});
