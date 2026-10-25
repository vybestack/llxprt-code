import { mkdtemp, realpath, rm, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Agent } from '../agent.js';
import { createAgent } from '../createAgent.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

async function waitForRoots(
  file: string,
  matches: (value: string) => boolean,
): Promise<string> {
  for (let turn = 0; turn < 400; turn++) {
    let content = '';
    try {
      content = await readFile(file, 'utf8');
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      )
        throw error;
    }
    const lines = content.trim().split('\n');
    const latest = lines[lines.length - 1];
    if (matches(latest)) return latest;
    await sleep(20);
  }
  throw new Error(
    `MCP roots observation did not arrive: ${await readFile(file, 'utf8')}`,
  );
}

describe('production filesystem roots', () => {
  let promptDirectory: string;

  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;

  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'workspace-owner-prompts-'));
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

  it('publishes live MCP roots and trust changes without affecting a same-label sibling', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'mcp-roots-')),
    );
    const aDir = join(directory, 'first');
    const bDir = join(directory, 'second');
    const extra = join(directory, 'extra');
    await Promise.all([mkdir(aDir), mkdir(bDir), mkdir(extra)]);
    const firstLog = join(directory, 'first.jsonl');
    const secondLog = join(directory, 'second.jsonl');
    const script = fileURLToPath(
      new URL('./helpers/mcp-roots-server-fixture.ts', import.meta.url),
    );
    // The first root's filesystem owner and trust are the test's own, so the
    // test can narrow the declared directories, which has no public Agent
    // member, and revoke trust live.
    const trust = new WorkspaceTrustLifecycle({ localTrust: true });
    const root = new WorkspaceFilesystemOwner({
      targetDir: aDir,
      isTrusted: () => trust.isTrustedFolder(),
    });
    const agents: Agent[] = [];
    try {
      const agent = await createAgent({
        provider: 'fake',
        model: 'fake-model',
        sessionId: 'same-label',
        workingDir: aDir,
        interactive: true,
        folderTrust: true,
        harness: { includeProcessCwd: false },
        mcpServers: {
          roots: { command: process.execPath, args: [script, firstLog] },
        },
        filesystemOwner: root,
        trustPort: trust,
        credentialAuthority: credentials().authority,
      });
      agents.push(agent);
      const sibling = await createAgent({
        provider: 'fake',
        model: 'fake-model',
        sessionId: 'same-label',
        workingDir: bDir,
        interactive: true,
        folderTrust: true,
        harness: { includeProcessCwd: false },
        mcpServers: {
          roots: { command: process.execPath, args: [script, secondLog] },
        },
        credentialAuthority: credentials().authority,
      });
      agents.push(sibling);
      const originalSibling = await waitForRoots(secondLog, (value) =>
        value.includes(pathToFileURL(bDir).href),
      );
      expect(
        await waitForRoots(firstLog, (value) =>
          value.includes(pathToFileURL(aDir).href),
        ),
      ).toContain(pathToFileURL(aDir).href);
      agent.workspace.addDirectory(extra);
      expect(agent.workspace.getDirectories()).toContain(extra);
      expect(
        await waitForRoots(firstLog, (value) =>
          value.includes(pathToFileURL(extra).href),
        ),
      ).toContain(pathToFileURL(extra).href);
      root.setDirectories([aDir]);
      expect(
        await waitForRoots(
          firstLog,
          (value) =>
            value.includes(pathToFileURL(aDir).href) &&
            !value.includes(pathToFileURL(extra).href),
        ),
      ).not.toContain(pathToFileURL(extra).href);
      await trust.setTrustedFolderLive(false);
      expect(agent.workspace.containsPath(extra)).toBe(false);
      expect(() => agent.workspace.addDirectory(extra)).toThrow('trusted');
      const states = agent.mcp.status().servers;
      expect(states.every((state) => state.status === 'disconnected')).toBe(
        true,
      );
      expect(
        (await readFile(secondLog, 'utf8'))
          .trim()
          .split('\n')
          .every((value) => value === originalSibling),
      ).toBe(true);
      expect(sibling.workspace.containsPath(bDir)).toBe(true);
    } finally {
      await runCleanupSteps([
        ...agents.map((agent) => () => agent.dispose()),
        () => root.dispose(),
        () => trust.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    }
  });
});
