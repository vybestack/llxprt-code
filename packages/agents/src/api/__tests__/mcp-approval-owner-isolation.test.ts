import {
  RuntimePolicyOwner,
  SessionPolicyOwner,
} from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import {
  mkdtemp,
  realpath,
  rm,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { PolicyDecision } from '@vybestack/llxprt-code-policy';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { Agent, AgentToolHandle } from '../agent.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { awaitMcpDiscoveryReady } from './helpers/mcp-discovery-ready.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteAAgent, RouteAAgent } from './helpers/route-a-agent.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const evidence = join(tmpdir(), 'llxprt-mcp-approval-isolation-repro');

const fixture = fileURLToPath(
  new URL('./helpers/mcp-approval-stdio-fixture.ts', import.meta.url),
);

function tool(agent: Agent, server: string, name: string): AgentToolHandle {
  const info = agent.tools
    .list()
    .find((entry) => entry.server === server && entry.serverToolName === name);
  expect(info).toBeDefined();
  if (!info) throw new Error('Discovered tool missing');
  const handle = agent.tools.get(info.name);
  expect(handle?.source).toBe('mcp');
  if (!handle) throw new Error('Public tool handle missing');
  return handle;
}

async function confirm(
  details: unknown,
  outcome: ToolConfirmationOutcome,
): Promise<void> {
  if (
    typeof details !== 'object' ||
    details === null ||
    !('onConfirm' in details) ||
    typeof details.onConfirm !== 'function'
  )
    throw new Error('Public confirmation result has no onConfirm callback');
  await details.onConfirm(outcome);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH')
      return false;
    throw error;
  }
}

describe('MCP public tool approval owner isolation', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });
  useFakeResponsesReplay('plain-text.jsonl');
  const credentials = useOwnedCredentials();
  const ownerCCredentials = useOwnedCredentials();

  for (const outcome of [
    ToolConfirmationOutcome.ProceedAlwaysTool,
    ToolConfirmationOutcome.ProceedAlwaysServer,
  ]) {
    it(`keeps B confirmation required after A chooses ${outcome}`, async () => {
      await mkdir(evidence, { recursive: true });
      const directory = await mkdtemp(join(evidence, 'runtime-'));
      const server = `approval_${randomUUID().replaceAll('-', '')}`;
      const routes: RouteAAgent[] = [];
      const pids: number[] = [];
      const signal = new AbortController().signal;
      async function openAgent(
        name: string,
        authority: CredentialAuthority,
      ): Promise<RouteAAgent> {
        const cwd = join(directory, name);
        await mkdir(cwd);
        const route = await openRouteAAgent({
          authority,
          config: {
            workingDir: await realpath(cwd),
            interactive: true,
            folderTrust: true,
            coreTools: [],
            policy: { defaultDecision: PolicyDecision.ASK_USER },
            telemetry: { enabled: false },
            recording: { enabled: false },
            mcpServers: {
              [server]: {
                command: process.execPath,
                args: [fixture, join(cwd, 'server.pid')],
                trust: false,
              },
            },
          },
        });
        routes.push(route);
        await awaitMcpDiscoveryReady(route.agent);
        expect(
          route.agent.mcp
            .listServers()
            .filter((entry) => entry.status !== 'connected'),
        ).toStrictEqual([]);
        pids.push(Number(await readFile(join(cwd, 'server.pid'), 'utf8')));
        return route;
      }
      async function openCaller(name: string): Promise<void> {
        const { agent } = await openAgent(name, credentials().authority);
        expect(agent.policy.getDefaultDecision()).toBe(PolicyDecision.ASK_USER);
        const discovered = agent.tools
          .list()
          .filter((entry) => entry.server === server);
        expect(
          discovered.map((entry) => entry.serverToolName).sort(),
        ).toStrictEqual(['increment', 'other']);
        const decisions = [];
        for (const entry of discovered) {
          const qualifiedName = `${entry.server}__${entry.serverToolName}`;
          const confirmation = await tool(
            agent,
            entry.server ?? server,
            entry.serverToolName ?? '',
          )
            .build({})
            .shouldConfirmExecute(signal);
          expect(confirmation).toMatchObject({
            type: 'mcp',
            serverName: entry.server,
            toolName: entry.serverToolName,
          });
          decisions.push({ qualifiedName, confirmation });
        }
        await writeFile(
          join(evidence, `${outcome}-${name}-policy-baseline.json`),
          JSON.stringify(decisions, null, 2),
        );
      }
      try {
        for (const name of ['A', 'B']) await openCaller(name);
        const [agentA, agentB] = routes.map((route) => route.agent);
        const a = tool(agentA, server, 'increment');
        const b = tool(agentB, server, 'increment');
        const baselineA = await a.build({}).shouldConfirmExecute(signal);
        const baselineB = await b.build({}).shouldConfirmExecute(signal);
        const expected = {
          type: 'mcp',
          serverName: server,
          toolName: 'increment',
        };
        expect(baselineA).toMatchObject(expected);
        expect(baselineB).toMatchObject(expected);
        await writeFile(
          join(evidence, `${outcome}-baseline.json`),
          JSON.stringify({ a: baselineA, b: baselineB }, null, 2),
        );
        await confirm(baselineA, outcome);
        expect(await a.build({}).shouldConfirmExecute(signal)).toBe(false);
        expect(await a.build({}).execute(signal)).toMatchObject({
          llmContent: [{ text: '1' }],
          returnDisplay: '1',
        });
        const sameOwnerOther = await tool(agentA, server, 'other')
          .build({})
          .shouldConfirmExecute(signal);
        const otherConfirmation = expect.objectContaining({
          type: 'mcp',
          toolName: 'other',
        });
        expect(sameOwnerOther).toStrictEqual(
          outcome === ToolConfirmationOutcome.ProceedAlwaysServer
            ? false
            : otherConfirmation,
        );
        const afterB = await b.build({}).shouldConfirmExecute(signal);
        await writeFile(
          join(evidence, `${outcome}-after.json`),
          JSON.stringify({ b: afterB, sameOwnerOther }, null, 2),
        );
        expect(afterB).toMatchObject(expected);
        expect(await a.build({}).shouldConfirmExecute(signal)).toBe(false);
        await agentA.mcp.refresh(server);
        pids.push(
          Number(await readFile(join(directory, 'A', 'server.pid'), 'utf8')),
        );
        expect(
          await tool(agentA, server, 'increment')
            .build({})
            .shouldConfirmExecute(signal),
        ).toBe(false);
        expect(
          await tool(agentA, server, 'other')
            .build({})
            .shouldConfirmExecute(signal),
        ).toStrictEqual(
          outcome === ToolConfirmationOutcome.ProceedAlwaysServer
            ? false
            : otherConfirmation,
        );
        expect(await b.build({}).shouldConfirmExecute(signal)).toMatchObject(
          expected,
        );
        await agentA.dispose();
        expect(
          await tool(agentB, server, 'increment')
            .build({})
            .shouldConfirmExecute(signal),
        ).toMatchObject(expected);
        const freshOwner = new RuntimePolicyOwner(routes[1].config);
        const fresh = new SessionPolicyOwner(
          freshOwner.workspace,
          routes[0].config,
        );
        try {
          expect(
            fresh.decisions.evaluate(`${server}__increment`, {}, server),
          ).toBe(PolicyDecision.ASK_USER);
        } finally {
          await fresh.dispose();
          await freshOwner.dispose();
        }
        expect(() => agentA.policy.getRules()).toThrow(
          'Session policy is disposed',
        );
        await expect(confirm(baselineA, outcome)).rejects.toThrow(
          /Tool dispatch admission is closed/,
        );
        expect(() => agentA.policy.getRules()).toThrow(
          'Session policy is disposed',
        );
        const agentC = (await openAgent('C', ownerCCredentials().authority))
          .agent;
        try {
          expect(
            await tool(agentC, server, 'increment')
              .build({})
              .shouldConfirmExecute(signal),
          ).toMatchObject(expected);
        } finally {
          await agentC.dispose();
        }
      } finally {
        const results = await Promise.allSettled(
          routes.map((route) => route.agent.dispose()),
        );
        results.push(
          ...(await Promise.allSettled(
            [...routes].reverse().map((route) => route.close()),
          )),
        );
        const alive = pids.filter(isAlive);
        await writeFile(
          join(evidence, `${outcome}-cleanup.json`),
          JSON.stringify(
            { pids, alive, results },
            (_key, value: unknown) => {
              if (value instanceof AggregateError)
                return { message: value.message, errors: value.errors };
              if (value instanceof Error)
                return { message: value.message, stack: value.stack };
              return value;
            },
            2,
          ),
        );
        await rm(directory, { recursive: true, force: true });
        expect(
          results.filter((result) => result.status === 'rejected'),
        ).toStrictEqual([]);
        expect(alive).toStrictEqual([]);
      }
    });
  }
});
