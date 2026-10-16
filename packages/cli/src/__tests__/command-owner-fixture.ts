/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterAll, afterEach, beforeAll, beforeEach } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createAgent,
  type Agent,
  type AgentConfig,
} from '@vybestack/llxprt-code-agents';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';

export function useCommandOwners(): (
  label: string,
  mcpServers?: AgentConfig['mcpServers'],
  hooks?: AgentConfig['hooks'],
) => Promise<Agent> {
  const credentials = useOwnedCredentials();
  let root: string;
  let previousResponses: string | undefined;
  let previousPrompts: string | undefined;
  let prompts: string;
  const agents: Agent[] = [];

  beforeAll(async () => {
    previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
    prompts = await mkdtemp(join(tmpdir(), 'command-owner-prompts-'));
    await mkdir(join(prompts, 'core'), { recursive: true });
    await writeFile(
      join(prompts, 'core', 'default.md'),
      'Test command-owner system prompt.',
    );
    process.env.LLXPRT_PROMPTS_DIR = prompts;
  });

  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(prompts, { recursive: true, force: true });
  });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'command-owner-'));
    previousResponses = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL(
        '../../../agents/src/api/__tests__/fixtures/multi-turn-text.jsonl',
        import.meta.url,
      ),
    );
  });

  afterEach(async () => {
    try {
      await Promise.all(agents.splice(0).map((agent) => agent.dispose()));
    } finally {
      if (previousResponses === undefined)
        delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previousResponses;
      await rm(root, { recursive: true, force: true });
    }
  });

  return async (label, mcpServers, hooks) => {
    const workingDir = join(root, label);
    await mkdir(workingDir);
    const agent = await createAgent({
      credentialAuthority: credentials().authority,
      provider: 'fake',
      model: `${label}-initial`,
      workingDir,
      sessionId: 'same-command-owner-label',
      harness: {
        forceInteractive: false,
        forceConfirmations: false,
        includeProcessCwd: false,
      },
      mcpServers,
      hooks,
      settings: hooks === undefined ? undefined : { enableHooks: true },
      mcpEnabled: mcpServers !== undefined,
      folderTrust: mcpServers === undefined ? undefined : true,
      lsp: false,
    });
    agents.push(agent);
    return agent;
  };
}
