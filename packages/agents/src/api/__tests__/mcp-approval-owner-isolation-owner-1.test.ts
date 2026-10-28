import { Storage } from '@vybestack/llxprt-code-settings';
import { mkdtemp, realpath, rm, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, spyOn } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { PolicyDecision } from '@vybestack/llxprt-code-policy';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { Agent, AgentToolHandle } from '../agent.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { awaitMcpDiscoveryReady } from './helpers/mcp-discovery-ready.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';

import fs from 'node:fs/promises';

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

describe('MCP saved approval lifetime', () => {
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

  it('joins an admitted saved approval at owner disposal without restoring session approval', async () => {
    await mkdir(evidence, { recursive: true });
    const directory = await mkdtemp(join(evidence, 'save-runtime-'));
    const server = `save_${randomUUID().replaceAll('-', '')}`;

    const route = await openRouteAAgent({
      authority: credentials().authority,
      config: {
        workingDir: await realpath(directory),
        interactive: true,
        folderTrust: true,
        coreTools: [],
        policy: { defaultDecision: PolicyDecision.ASK_USER },
        telemetry: { enabled: false },
        recording: { enabled: false },
        mcpServers: {
          [server]: {
            command: process.execPath,
            args: [fixture, join(directory, 'server.pid')],
            trust: false,
          },
        },
      },
    });
    const { agent } = route;

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
    let approval: Promise<void> | undefined;
    let disposal: Promise<void> | undefined;
    try {
      await awaitMcpDiscoveryReady(agent);
      expect(
        agent.mcp.listServers().filter((entry) => entry.status !== 'connected'),
      ).toStrictEqual([]);
      const increment = tool(agent, server, 'increment');
      const details = await increment
        .build({})
        .shouldConfirmExecute(new AbortController().signal);
      approval = confirm(details, ToolConfirmationOutcome.ProceedAlwaysAndSave);
      await admitted;
      expect(agent.policy.getRules()).toContainEqual(
        expect.objectContaining({
          toolName: `${server}__increment`,
          decision: PolicyDecision.ALLOW,
        }),
      );
      let disposed = false;
      disposal = agent.dispose().then(() => {
        disposed = true;
      });
      await expect(
        Promise.resolve().then(() =>
          increment
            .build({})
            .shouldConfirmExecute(new AbortController().signal),
        ),
      ).rejects.toThrow(/Tool dispatch admission is closed/);
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
      expect(() => agent.policy.getRules()).toThrow(
        'Session policy is disposed',
      );
    } finally {
      release();
      await Promise.allSettled([approval, disposal]);
      saving.mockRestore();
      storage.mockRestore();
      await route.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
