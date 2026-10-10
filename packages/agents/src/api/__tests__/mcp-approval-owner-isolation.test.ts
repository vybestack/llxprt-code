/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { SessionPolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';

import { describe, expect, it, spyOn } from 'bun:test';
import fs from 'node:fs/promises';
import { Storage } from '@vybestack/llxprt-code-settings';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PolicyDecision } from '@vybestack/llxprt-code-policy';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import type { Agent, AgentToolHandle } from '../agent.js';
import { fromConfig } from '../fromConfig.js';
import { CONFIRMATION_FORCING_SOURCE } from '../confirmationForcing.js';
import {
  buildCliStyleConfig,
  type BuiltCliConfig,
} from './helpers/buildCliStyleConfig.js';

const evidence = join(tmpdir(), 'llxprt-mcp-approval-isolation-repro');
const fixture = fileURLToPath(
  new URL('./helpers/mcp-approval-stdio-fixture.ts', import.meta.url),
);

function buildOwner(cwd: string, server: string): Promise<BuiltCliConfig> {
  return buildCliStyleConfig('plain-text.jsonl', {
    workingDir: cwd,
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
  });
}

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
  for (const outcome of [
    ToolConfirmationOutcome.ProceedAlwaysTool,
    ToolConfirmationOutcome.ProceedAlwaysServer,
  ]) {
    it(`keeps B confirmation required after A chooses ${outcome}`, async () => {
      await mkdir(evidence, { recursive: true });
      const directory = await mkdtemp(join(evidence, 'runtime-'));
      const server = `approval_${randomUUID().replaceAll('-', '')}`;
      const builtOwners: BuiltCliConfig[] = [];
      const agents: Agent[] = [];
      const pids: number[] = [];
      const signal = new AbortController().signal;
      try {
        for (const name of ['A', 'B']) {
          const cwd = join(directory, name);
          await mkdir(cwd);
          const built = await buildOwner(cwd, server);
          builtOwners.push(built);
          expect(
            Array.from(await built.mcpRuntime.awaitDiscovery()),
          ).toStrictEqual([]);
          pids.push(Number(await readFile(join(cwd, 'server.pid'), 'utf8')));
          built.mcpRuntime.policyOwner.session.confirmation.removeRulesBySource(
            CONFIRMATION_FORCING_SOURCE,
          );
          const agent = await fromConfig({
            settingsOwner: built.settingsOwner,
            settingsService: built.settingsService,
            agentClient: built.agentClient,
            providerManager: built.providerManager,
            runtimeFactoryBindings: built.runtimeFactoryBindings,
            config: built.config,
            mcpRuntime: built.mcpRuntime,
            mcpOwnership: 'caller',
            messageBus: built.messageBus,
          });

          agents.push(agent);
          expect(agent.policy.getDefaultDecision()).toBe(
            PolicyDecision.ASK_USER,
          );
          const discovered = agent.tools
            .list()
            .filter((entry) => entry.server === server);
          expect(
            discovered.map((entry) => entry.serverToolName).sort(),
          ).toStrictEqual(['increment', 'other']);
          const decisions = discovered.map((entry) => {
            const qualifiedName = `${entry.server}__${entry.serverToolName}`;
            const decision =
              built.mcpRuntime.policyOwner.session.decisions.evaluate(
                qualifiedName,
                {},
                entry.server,
              );
            expect(decision).toBe(PolicyDecision.ASK_USER);
            return { qualifiedName, decision };
          });
          await writeFile(
            join(evidence, `${outcome}-${name}-policy-baseline.json`),
            JSON.stringify(decisions, null, 2),
          );
        }
        const [agentA, agentB] = agents;
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
        const ownerA = builtOwners[0];
        expect(
          ownerA.mcpRuntime.policyOwner.session.decisions.evaluate(
            `${server}__increment`,
            {},
            server,
          ),
        ).toBe(PolicyDecision.ALLOW);
        await ownerA.mcpRuntime.refresh(server);
        await ownerA.mcpRuntime.awaitDiscovery();
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
        expect(
          ownerA.mcpRuntime.policyOwner.session.decisions.evaluate(
            `${server}__increment`,
            {},
            server,
          ),
        ).toBe(PolicyDecision.ALLOW);
        await ownerA.mcpRuntime.dispose();
        const fresh = new SessionPolicyOwner(
          builtOwners[1].policyOwner.workspace,
          ownerA.config,
        );
        try {
          expect(
            fresh.decisions.evaluate(`${server}__increment`, {}, server),
          ).toBe(PolicyDecision.ASK_USER);
        } finally {
          await fresh.dispose();
        }
        expect(() =>
          ownerA.mcpRuntime.policyOwner.session.decisions.evaluate(
            `${server}__increment`,
            {},
            server,
          ),
        ).toThrow('Session policy is disposed');
        await expect(confirm(baselineA, outcome)).rejects.toThrow(
          /Tool dispatch admission is closed/,
        );
        expect(() =>
          ownerA.mcpRuntime.policyOwner.session.decisions.evaluate(
            `${server}__increment`,
            {},
            server,
          ),
        ).toThrow('Session policy is disposed');
        const cwd = join(directory, 'C');
        await mkdir(cwd);
        const ownerC = await buildOwner(cwd, server);
        builtOwners.push(ownerC);
        expect(
          Array.from(await ownerC.mcpRuntime.awaitDiscovery()),
        ).toStrictEqual([]);
        pids.push(Number(await readFile(join(cwd, 'server.pid'), 'utf8')));
        ownerC.mcpRuntime.policyOwner.session.confirmation.removeRulesBySource(
          CONFIRMATION_FORCING_SOURCE,
        );
        const agentC = await fromConfig({
          settingsOwner: ownerC.settingsOwner,
          settingsService: ownerC.settingsService,
          providerManager: ownerC.providerManager,
          config: ownerC.config,
          mcpRuntime: ownerC.mcpRuntime,
          mcpOwnership: 'caller',
          messageBus: ownerC.messageBus,
        });
        try {
          agents.push(agentC);
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
          agents.map((a) => a.dispose()),
        );
        for (const built of [...builtOwners].reverse()) {
          results.push(
            ...(await Promise.allSettled([built.mcpRuntime.dispose()])),
          );
          results.push(...(await Promise.allSettled([built.config.dispose()])));
          results.push(...(await Promise.allSettled([built.cleanup()])));
        }
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

describe('MCP saved approval lifetime', () => {
  it('joins an admitted saved approval at owner disposal without restoring session approval', async () => {
    await mkdir(evidence, { recursive: true });
    const directory = await mkdtemp(join(evidence, 'save-runtime-'));
    const server = `save_${randomUUID().replaceAll('-', '')}`;
    const built = await buildOwner(directory, server);
    const policies = join(directory, 'policies');
    const storage = spyOn(Storage, 'getUserPoliciesDir').mockReturnValue(
      policies,
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const admitted = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const rename = fs.rename;
    const saving = spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === join(policies, 'auto-saved.toml')) {
        entered();
        await gate;
      }
      await rename(from, to);
    });
    let agent: Agent | undefined;
    let approval: Promise<void> | undefined;
    let disposal: Promise<void> | undefined;
    try {
      expect(Array.from(await built.mcpRuntime.awaitDiscovery())).toStrictEqual(
        [],
      );
      built.mcpRuntime.policyOwner.session.confirmation.removeRulesBySource(
        CONFIRMATION_FORCING_SOURCE,
      );
      agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        runtimeFactoryBindings: built.runtimeFactoryBindings,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        mcpOwnership: 'caller',
        messageBus: built.messageBus,
      });
      const details = await tool(agent, server, 'increment')
        .build({})
        .shouldConfirmExecute(new AbortController().signal);
      approval = confirm(details, ToolConfirmationOutcome.ProceedAlwaysAndSave);
      await admitted;
      expect(
        built.mcpRuntime.policyOwner.session.decisions.evaluate(
          `${server}__increment`,
          {},
          server,
        ),
      ).toBe(PolicyDecision.ALLOW);
      let disposed = false;
      disposal = built.mcpRuntime.dispose().then(() => {
        disposed = true;
      });
      expect(() =>
        built.mcpRuntime.policyOwner.session.decisions.evaluate(
          `${server}__increment`,
          {},
          server,
        ),
      ).toThrow('Session policy is disposed');
      await expect(
        confirm(details, ToolConfirmationOutcome.ProceedAlwaysAndSave),
      ).rejects.toThrow(/Tool dispatch admission is closed/);
      expect(disposed).toBe(false);
      release();
      await approval;
      await disposal;
      expect(disposed).toBe(true);
      expect(
        await readFile(join(policies, 'auto-saved.toml'), 'utf8'),
      ).toContain('toolName = "increment"');
      expect(() =>
        built.mcpRuntime.policyOwner.session.decisions.evaluate(
          `${server}__increment`,
          {},
          server,
        ),
      ).toThrow('Session policy is disposed');
    } finally {
      release();
      await Promise.allSettled([approval, disposal]);
      saving.mockRestore();
      storage.mockRestore();
      await agent?.dispose();
      await built.mcpRuntime.dispose();
      await built.config.dispose();
      await built.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
