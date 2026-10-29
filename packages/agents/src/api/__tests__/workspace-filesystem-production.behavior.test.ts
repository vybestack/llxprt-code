import { FakeProvider } from '@vybestack/llxprt-code-providers';
import { CoreToolHostAdapter } from '@vybestack/llxprt-code-core';
import { ReadFileTool } from '@vybestack/llxprt-code-tools';
import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { openClientOwner } from './helpers/client-owner-session.js';
import { fromConfig } from '../fromConfig.js';
import { spyOn } from 'bun:test';
import { writeFile } from 'node:fs/promises';
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

  useFakeResponsesReplay('multi-turn-text.jsonl');
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
  it('replacement clients read current owner directories rather than an initial snapshot', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'replacement-roots-')),
    );
    const workingDir = await realpath(
      await mkdtemp(join(tmpdir(), 'workspace-current-')),
    );
    const built = await openClientOwner(
      credentials().authority,
      {
        provider: 'fake',
        model: 'fake-model',
        sessionId: 'same-label',
        interactive: true,
        workingDir,
      },
      { provider: 'fake', model: 'fake-model' },
    );
    const before = built.owner.clients.getAgentClient();
    try {
      built.mcp.workspaceFilesystem.addDirectory(directory);
      await built.owner.clients.refreshAuth();
      expect(before).not.toBe(built.owner.clients.getAgentClient());
      expect(built.mcp.workspacePaths.directories()).toContain(directory);
      await built.owner.clients.getAgentClient().startChat();
      const generate = FakeProvider.prototype.generateChatCompletion;
      const requests: string[] = [];
      const observation = spyOn(
        FakeProvider.prototype,
        'generateChatCompletion',
      ).mockImplementation(async function* (this: FakeProvider, input) {
        if (!('contents' in input)) throw new Error('Expected chat options');
        const contents = await Array.fromAsync(input.contents);
        requests.push(
          JSON.stringify({
            contents,
            systemInstruction: input.systemInstruction,
          }),
        );
        yield* generate.call(this, {
          ...input,
          contents: (async function* () {
            yield* contents;
          })(),
        });
      });
      for await (const event of built.owner.clients
        .getAgentClient()
        .sendMessageStream(
          'Observe current workspace',
          new AbortController().signal,
          'workspace-added',
        )) {
        if (event.type === 'error') throw new Error(JSON.stringify(event));
      }
      expect(requests.join('\n')).toContain(directory);
      requests.length = 0;
      built.mcp.workspaceFilesystem.setDirectories([
        built.config.getTargetDir(),
      ]);
      await built.owner.clients.refreshAuth();
      expect(built.mcp.workspacePaths.directories()).not.toContain(directory);
      await built.owner.clients.getAgentClient().startChat();
      for await (const event of built.owner.clients
        .getAgentClient()
        .sendMessageStream(
          'Observe removed workspace',
          new AbortController().signal,
          'workspace-removed',
        )) {
        if (event.type === 'error') throw new Error(JSON.stringify(event));
      }
      expect(requests.join('\n')).not.toContain(directory);
      observation.mockRestore();
    } finally {
      await built.close();
      await rm(workingDir, { recursive: true, force: true });
      await rm(directory, { recursive: true, force: true });
    }
  });
  it.each([
    { name: 'utf8', bytes: Buffer.from('Plain UTF-8 λ') },
    {
      name: 'utf8-bom',
      bytes: Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('UTF-8 BOM λ'),
      ]),
    },
    {
      name: 'utf16le',
      bytes: Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from('UTF-16 λ', 'utf16le'),
      ]),
    },
  ])(
    'keeps default public read_file decoding before and after adoption: $name',
    async ({ bytes }) => {
      const directory = await realpath(
        await mkdtemp(join(tmpdir(), 'public-bom-')),
      );
      const file = join(directory, 'input.txt');
      await writeFile(file, bytes);
      const built = await buildCliStyleConfig('plain-text.jsonl', {
        workingDir: directory,
      });
      const tool = new ReadFileTool(
        new CoreToolHostAdapter(
          built.config,
          built.mcpRuntime.workspacePaths,
          built.mcpRuntime.workspaceFiles,
          built.mcpRuntime.workspaceIgnore,
          built.mcpRuntime.workspaceScans,
          () => built.settingsOwner.readToolExecutionPolicy(),
          built.mcpRuntime.trust,
          RootTelemetry.prepare({
            enabled: false,
            sessionId: 'isolated-caller-fixture',
            maxBytes: 1024,
            maxFiles: 1,
          }),
        ),
      );
      const before = await tool
        .build({ absolute_path: file })
        .execute(new AbortController().signal);
      const agent = await fromConfig(
        built.config,
        built.settingsService,
        {},
        credentials().authority,
      );
      try {
        const reader = agent.tools.get('read_file');
        if (!reader) throw new Error('Missing public read_file');
        const after = await reader.buildAndExecute(
          { file_path: file },
          new AbortController().signal,
        );
        expect(before.error).toBeUndefined();
        expect(after.error).toBeUndefined();
        expect(after.llmContent).toContain('λ');
        expect(after.llmContent).toBe(before.llmContent);
      } finally {
        await agent.dispose();
        await built.cleanup();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
