/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, afterEach, beforeEach } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  PolicyEngine,
  PolicyDecision,
  loadPolicyFromToml,
  USER_POLICY_TIER,
} from '@vybestack/llxprt-code-policy';
import { DiscoveredMCPTool } from '@vybestack/llxprt-code-mcp';
import {
  ToolConfirmationOutcome,
  type CallableTool,
} from '@vybestack/llxprt-code-tools';
import { createMcpApprovalPolicy } from './mcp-approval.js';
import { buildMcpTrustedRules, persistPolicyToToml } from './config.js';

const target = { serverName: 'raw.server-name', toolName: 'raw.tool-name' };
const callable: CallableTool = {
  tool: async () => [],
  callTool: async () => {
    throw new Error('Transport is not used for confirmation');
  },
};

function buildTool(
  policy: ReturnType<typeof createMcpApprovalPolicy>,
  name = target.toolName,
  trusted = false,
) {
  return new DiscoveredMCPTool(
    policy,
    callable,
    target.serverName,
    name,
    '',
    { type: 'object' },
    trusted,
    undefined,
    { isTrustedFolder: () => true },
  );
}
async function confirmation(tool: DiscoveredMCPTool) {
  const result = await tool
    .build({})
    .shouldConfirmExecute(new AbortController().signal);
  if (result === false || result.type !== 'mcp')
    throw new Error('Expected MCP confirmation');
  return result;
}

describe('owner MCP policy approval', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-mcp-approval-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  function owner() {
    const engine = new PolicyEngine({
      defaultDecision: PolicyDecision.ASK_USER,
    });
    const policy = createMcpApprovalPolicy(
      engine,
      (message) => persistPolicyToToml(message, directory),
      () => {},
    );
    return { engine, policy };
  }
  it.each([
    ToolConfirmationOutcome.ProceedAlwaysTool,
    ToolConfirmationOutcome.ProceedAlwaysServer,
  ])(
    'remembers %s in the exact engine across replacement tools',
    async (outcome) => {
      const a = owner();
      const b = owner();
      await (await confirmation(buildTool(a.policy))).onConfirm(outcome);
      expect(
        a.engine.evaluate(
          `${target.serverName}__${target.toolName}`,
          {},
          target.serverName,
        ),
      ).toBe(PolicyDecision.ALLOW);
      expect(
        await buildTool(a.policy)
          .build({})
          .shouldConfirmExecute(new AbortController().signal),
      ).toBe(false);
      expect(b.policy.evaluate(target, {})).toBe('ask_user');
      expect(
        a.policy.evaluate({ ...target, toolName: 'later-discovered' }, {}),
      ).toBe(
        outcome === ToolConfirmationOutcome.ProceedAlwaysServer
          ? 'allow'
          : 'ask_user',
      );
      expect(
        a.policy.evaluate(
          { ...target, serverName: `${target.serverName}-near` },
          {},
        ),
      ).toBe('ask_user');
      expect(
        await readFile(join(directory, 'auto-saved.toml')).catch(
          (error) => error.code,
        ),
      ).toBe('ENOENT');
    },
  );
  it('awaits actual saved tool persistence without mutating another live engine', async () => {
    const a = owner();
    const b = owner();
    await (
      await confirmation(buildTool(a.policy))
    ).onConfirm(ToolConfirmationOutcome.ProceedAlwaysAndSave);
    const saved = await loadPolicyFromToml(
      join(directory, 'auto-saved.toml'),
      USER_POLICY_TIER,
    );
    const reloaded = new PolicyEngine({
      rules: saved,
      defaultDecision: PolicyDecision.ASK_USER,
    });
    expect(
      reloaded.evaluate(
        `${target.serverName}__${target.toolName}`,
        {},
        target.serverName,
      ),
    ).toBe(PolicyDecision.ALLOW);
    expect(
      reloaded.evaluate(`${target.serverName}__other`, {}, target.serverName),
    ).toBe(PolicyDecision.ASK_USER);
    expect(b.policy.evaluate(target, {})).toBe('ask_user');
  });
  it('rejects the original external save error while retaining only session approval', async () => {
    const engine = new PolicyEngine({
      defaultDecision: PolicyDecision.ASK_USER,
    });
    const failure = new Error('External storage unavailable');
    const policy = createMcpApprovalPolicy(
      engine,
      async () => {
        throw failure;
      },
      () => {},
    );
    const details = await confirmation(buildTool(policy));
    await expect(
      details.onConfirm(ToolConfirmationOutcome.ProceedAlwaysAndSave),
    ).rejects.toBe(failure);
    expect(policy.evaluate(target, {})).toBe('allow');
    expect(policy.evaluate({ ...target, toolName: 'other' }, {})).toBe(
      'ask_user',
    );
  });
  it('does not report success or overwrite malformed external saved policy', async () => {
    const a = owner();
    await writeFile(join(directory, 'auto-saved.toml'), 'not valid [toml');
    await expect(
      (await confirmation(buildTool(a.policy))).onConfirm(
        ToolConfirmationOutcome.ProceedAlwaysAndSave,
      ),
    ).rejects.toThrow(/parse|invalid|Unexpected/i);
    expect(await readFile(join(directory, 'auto-saved.toml'), 'utf8')).toBe(
      'not valid [toml',
    );
  });
  it('keeps stronger ASK and DENY effective for direct tools, even trusted tools', async () => {
    const a = owner();
    const details = await confirmation(buildTool(a.policy));
    for (const rule of buildMcpTrustedRules({
      mcpServers: { [target.serverName]: { trust: true } },
    })) {
      a.engine.addRule(rule);
    }
    expect(
      await buildTool(a.policy, target.toolName, true)
        .build({})
        .shouldConfirmExecute(new AbortController().signal),
    ).toBe(false);
    a.engine.addRule({
      toolNamePrefix: `${target.serverName}__`,
      priority: 10000,
      decision: PolicyDecision.ASK_USER,
    });
    await details.onConfirm(ToolConfirmationOutcome.ProceedAlwaysServer);
    expect(
      await buildTool(a.policy, target.toolName, true)
        .build({})
        .shouldConfirmExecute(new AbortController().signal),
    ).toMatchObject({ type: 'mcp' });
    a.engine.addRule({
      toolName: `${target.serverName}__${target.toolName}`,
      priority: 10001,
      decision: PolicyDecision.DENY,
    });
    await expect(
      buildTool(a.policy, target.toolName, true)
        .build({})
        .shouldConfirmExecute(new AbortController().signal),
    ).rejects.toThrow('denied by policy');
  });
  it.each([
    ToolConfirmationOutcome.Cancel,
    ToolConfirmationOutcome.ProceedOnce,
    ToolConfirmationOutcome.ProceedAlways,
  ])('does not remember %s', async (outcome) => {
    const a = owner();
    await (await confirmation(buildTool(a.policy))).onConfirm(outcome);
    expect(a.policy.evaluate(target, {})).toBe('ask_user');
  });
  it('waits at the external save boundary and rejects a stopped owner', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let active = true;
    const engine = new PolicyEngine({
      defaultDecision: PolicyDecision.ASK_USER,
    });
    const policy = createMcpApprovalPolicy(
      engine,
      () => gate,
      () => {
        if (!active) throw new Error('Stopped owner');
      },
    );
    const details = await confirmation(buildTool(policy));
    let settled = false;
    const pending = details
      .onConfirm(ToolConfirmationOutcome.ProceedAlwaysAndSave)
      .then(() => {
        settled = true;
      });
    expect(
      engine.evaluate(
        `${target.serverName}__${target.toolName}`,
        {},
        target.serverName,
      ),
    ).toBe(PolicyDecision.ALLOW);
    await Promise.resolve();
    expect(settled).toBe(false);
    active = false;
    await expect(
      details.onConfirm(ToolConfirmationOutcome.ProceedAlwaysTool),
    ).rejects.toThrow('Stopped owner');
    release();
    await pending;
    expect(settled).toBe(true);
  });
});
