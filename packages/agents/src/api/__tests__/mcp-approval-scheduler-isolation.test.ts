/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, spyOn } from 'bun:test';
import fs from 'node:fs/promises';
import { Storage } from '@vybestack/llxprt-code-settings';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { json } from 'node:stream/consumers';
import { PolicyDecision } from '@vybestack/llxprt-code-policy';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { createAgent } from '@vybestack/llxprt-code-agents';

import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import type { Agent, AgentToolHandle } from '../agent.js';
import type { AgentEvent, ToolConfirmation } from '../event-types.js';

const evidence = join(tmpdir(), 'llxprt-mcp-approval-scheduler-repro');

async function transport(): Promise<{
  url: string;
  requestTool(name: string): void;
  bodies: unknown[];
  stop(): Promise<void>;
}> {
  let nextTool: string | undefined;
  const bodies: unknown[] = [];
  const server = createServer((request, reply) => {
    if (request.url === '/v1/models') {
      reply
        .writeHead(200, { 'content-type': 'application/json' })
        .end('{"data":[]}');
      return;
    }
    void json(request)
      .then((body: unknown) => {
        bodies.push(body);
        const tool = nextTool;
        nextTool = undefined;
        const delta = tool
          ? {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: randomUUID(),
                  type: 'function',
                  function: { name: tool, arguments: '{}' },
                },
              ],
            }
          : { role: 'assistant', content: 'Finished.' };
        const chunk = {
          id: randomUUID(),
          object: 'chat.completion.chunk',
          created: 1,
          model: 'scheduler-fixture',
          choices: [
            { index: 0, delta, finish_reason: tool ? 'tool_calls' : 'stop' },
          ],
        };
        reply
          .writeHead(200, { 'content-type': 'text/event-stream' })
          .end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
      })
      .catch((cause: unknown) =>
        reply.destroy(new Error('Invalid local request', { cause })),
      );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Expected TCP address');
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    bodies,
    requestTool: (name) => {
      nextTool = name;
    },
    stop: () =>
      new Promise<void>((resolveStop, reject) => {
        server.close((error) => (error ? reject(error) : resolveStop()));
        server.closeAllConnections();
      }),
  };
}

function tool(agent: Agent, server: string): AgentToolHandle {
  const info = agent.tools
    .list()
    .find(
      (entry) =>
        entry.server === server && entry.serverToolName === 'increment',
    );
  if (!info) throw new Error(`Missing discovered tool: ${server}`);
  const handle = agent.tools.get(info.name);
  if (!handle) throw new Error('Missing public tool handle');
  return handle;
}

async function confirm(details: unknown): Promise<void> {
  if (
    typeof details !== 'object' ||
    details === null ||
    !('onConfirm' in details) ||
    typeof details.onConfirm !== 'function'
  )
    throw new Error('Missing actual confirmation callback');
  await details.onConfirm(ToolConfirmationOutcome.ProceedAlwaysTool);
}

function discoveryReady(agent: Agent): Promise<void> {
  if (agent.mcp.discoveryState() === 'ready') return Promise.resolve();
  return new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('MCP discovery did not become ready'));
    }, 30000);
    const unsubscribe = agent.mcp.subscribeStatus(() => {
      if (agent.mcp.discoveryState() !== 'ready') return;
      clearTimeout(timer);
      unsubscribe();
      resolveReady();
    });
  });
}

function allowRules(agent: Agent, server: string) {
  return agent.policy
    .getRules()
    .filter(
      (rule) =>
        rule.toolName === `${server}__increment` &&
        rule.decision === PolicyDecision.ALLOW,
    );
}

describe('MCP scheduler approval isolation', () => {
  it('requires B consent in the real scheduler after A retains MCP tool approval', async () => {
    await mkdir(evidence, { recursive: true });
    const directory = await mkdtemp(join(evidence, 'runtime-'));
    const environment = Object.fromEntries(
      ['LLXPRT_CONFIG_HOME', 'LLXPRT_DATA_HOME', 'LLXPRT_FAKE_RESPONSES'].map(
        (key) => [key, process.env[key]],
      ),
    );
    process.env.LLXPRT_CONFIG_HOME = join(directory, 'home');
    process.env.LLXPRT_DATA_HOME = join(directory, 'data');
    delete process.env.LLXPRT_FAKE_RESPONSES;
    const sharedServer = `isolation_${randomUUID().replaceAll('-', '')}`;
    const baselineServer = `baseline_${randomUUID().replaceAll('-', '')}`;
    const agents: Agent[] = [];
    const endpoints: Array<Awaited<ReturnType<typeof transport>>> = [];
    const pids: number[] = [];
    const controller = new AbortController();
    const trace: unknown[] = [];
    const pending: Array<Promise<void>> = [];
    const unsubscribers: Array<() => void> = [];
    async function owner(
      name: string,
      servers: string[],
    ): Promise<{
      agent: Agent;
      endpoint: Awaited<ReturnType<typeof transport>>;
      cwd: string;
    }> {
      const endpoint = await transport();
      endpoints.push(endpoint);
      const cwd = join(directory, name);
      await mkdir(cwd);
      const agent = await createAgent({
        provider: 'openai',
        model: 'scheduler-fixture',
        auth: { apiKey: 'local-only', baseUrl: endpoint.url },
        workingDir: cwd,
        folderTrust: true,
        coreTools: [],
        skillsSupport: false,
        interactive: true,
        harness: { forceConfirmations: false, includeProcessCwd: false },
        policy: { defaultDecision: PolicyDecision.ASK_USER },
        telemetry: { enabled: false },
        recording: { enabled: false },
        mcpServers: Object.fromEntries(
          servers.map((server) => [
            server,
            {
              command: process.execPath,
              args: [
                resolve(
                  resolveRepositoryFixture(
                    import.meta.url,
                    'packages/agents/src/api/__tests__/helpers/mcp-approval-scheduler-stdio-fixture.ts',
                  ),
                ),
                join(cwd, `${server}.pid`),
                join(cwd, `${server}.marker`),
              ],
              trust: false,
            },
          ]),
        ),
      });

      agents.push(agent);
      await discoveryReady(agent);
      expect(
        agent.mcp.listServers().filter((entry) => entry.status !== 'connected'),
      ).toStrictEqual([]);
      for (const server of servers) {
        pids.push(Number(await readFile(join(cwd, `${server}.pid`), 'utf8')));
        const approvals = allowRules(agent, server);
        trace.push({ owner: name, server, approvals });
        expect(approvals).toStrictEqual([]);
        expect(
          await tool(agent, server)
            .build({})
            .shouldConfirmExecute(controller.signal),
        ).toMatchObject({
          type: 'mcp',
          serverName: server,
          toolName: 'increment',
        });
      }
      return { agent, endpoint, cwd };
    }
    try {
      const a = await owner('A', [sharedServer]);
      const b = await owner('B', [sharedServer, baselineServer]);
      let requests: ToolConfirmation[] = [];
      let decision = ToolConfirmationOutcome.ProceedOnce;
      unsubscribers.push(
        b.agent.tools.onConfirmationRequest((request) => {
          requests = [...requests, request];
          trace.push({ busRequest: request, decision });
          queueMicrotask(() =>
            b.agent.tools.respondToConfirmation(
              request.confirmationId,
              decision,
            ),
          );
        }),
      );
      async function turn(name: string): Promise<AgentEvent[]> {
        b.endpoint.requestTool(tool(b.agent, name).name);
        const events: AgentEvent[] = [];
        const run = (async (): Promise<void> => {
          for await (const event of b.agent.stream(
            'Invoke the requested tool once.',
            { signal: controller.signal, mcpDiscovery: 'await' },
          ))
            events.push(event);
        })();
        pending.push(run);
        await run;
        trace.push({ server: name, events });
        expect(events.filter((event) => event.type === 'error')).toStrictEqual(
          [],
        );
        expect(events.filter((event) => event.type === 'done')).toMatchObject([
          { reason: 'stop' },
        ]);
        return events;
      }
      const baseline = await turn(baselineServer);
      expect(requests).toHaveLength(1);
      expect(requests[0].name).toBe(tool(b.agent, baselineServer).name);
      expect(
        baseline.filter((event) => event.type === 'tool-result'),
      ).toMatchObject([{ result: { isError: false } }]);
      expect(
        await readFile(join(b.cwd, `${baselineServer}.marker`), 'utf8'),
      ).toBe('invoked\n');
      requests = [];
      await confirm(
        await tool(a.agent, sharedServer)
          .build({})
          .shouldConfirmExecute(controller.signal),
      );
      trace.push({ aApproved: ToolConfirmationOutcome.ProceedAlwaysTool });
      expect(allowRules(a.agent, sharedServer)).toHaveLength(1);
      expect(allowRules(b.agent, sharedServer)).toStrictEqual([]);
      decision = ToolConfirmationOutcome.Cancel;
      const events = await turn(sharedServer);
      const marker = await readFile(
        join(b.cwd, `${sharedServer}.marker`),
        'utf8',
      );
      trace.push({ bRequests: requests, bMarker: marker });
      expect({
        consentRequests: requests.length,
        marker,
        successfulResults: events.filter(
          (event) =>
            event.type === 'tool-result' && event.result.isError === false,
        ).length,
      }).toStrictEqual({
        consentRequests: 1,
        marker: '',
        successfulResults: 0,
      });
      const saveFailure = new Error('MCP saved approval storage unavailable');
      const savedDirectory = join(b.cwd, 'policies');
      const storage = spyOn(Storage, 'getUserPoliciesDir').mockReturnValue(
        savedDirectory,
      );
      const rename = spyOn(fs, 'rename').mockRejectedValue(saveFailure);
      const deadline = setTimeout(() => controller.abort(), 5000);
      try {
        requests = [];
        decision = ToolConfirmationOutcome.ProceedAlwaysAndSave;
        const failedSave = await turn(sharedServer);
        expect(requests).toHaveLength(1);
        expect(
          await readFile(join(b.cwd, `${sharedServer}.marker`), 'utf8'),
        ).toBe('');
        expect(
          failedSave.filter((event) => event.type === 'tool-result'),
        ).toMatchObject([{ result: { isError: true } }]);
        expect(JSON.stringify(failedSave)).toContain(saveFailure.message);
        expect(
          await tool(b.agent, sharedServer)
            .build({})
            .shouldConfirmExecute(controller.signal),
        ).toBe(false);
        expect(
          await readFile(join(savedDirectory, 'auto-saved.toml')).catch(
            (error) => error.code,
          ),
        ).toBe('ENOENT');
      } finally {
        clearTimeout(deadline);
        rename.mockRestore();
        storage.mockRestore();
      }
    } catch (error) {
      trace.push({
        failure: error instanceof Error ? error.stack : String(error),
      });
      throw error;
    } finally {
      controller.abort();
      const turns = await Promise.allSettled(pending);
      for (const unsubscribe of unsubscribers) unsubscribe();
      const cleanup: Array<PromiseSettledResult<void>> = [];
      for (const agent of agents)
        cleanup.push(...(await Promise.allSettled([agent.dispose()])));
      for (const endpoint of endpoints)
        cleanup.push(...(await Promise.allSettled([endpoint.stop()])));
      const alive = pids.filter((pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (error) {
          if (
            error instanceof Error &&
            'code' in error &&
            error.code === 'ESRCH'
          )
            return false;
          throw error;
        }
      });
      await writeFile(
        join(evidence, 'trace.json'),
        JSON.stringify(
          {
            trace,
            bodies: endpoints.map((endpoint) => endpoint.bodies),
            turns,
            cleanup,
            pids,
            alive,
          },
          null,
          2,
        ),
      );
      for (const [key, value] of Object.entries(environment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(directory, { recursive: true, force: true });
      expect(
        cleanup.filter((result) => result.status === 'rejected'),
      ).toStrictEqual([]);
      expect(alive).toStrictEqual([]);
    }
  });
});
