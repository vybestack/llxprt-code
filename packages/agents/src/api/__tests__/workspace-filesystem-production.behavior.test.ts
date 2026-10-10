import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FakeProvider } from '@vybestack/llxprt-code-providers';
import { setTimeout as sleep } from 'node:timers/promises';

import { describe, expect, it, spyOn } from 'bun:test';
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { fromConfig } from '../fromConfig.js';
import { createSessionClientEngineFixture } from './helpers/session-client-engine-fixture.js';
import { CoreToolHostAdapter } from '@vybestack/llxprt-code-core';
import { ReadFileTool } from '@vybestack/llxprt-code-tools';

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
    const first = await buildCliStyleConfig('plain-text.jsonl', {
      sessionId: 'same-label',
      workingDir: aDir,
      folderTrust: true,
      harness: { includeProcessCwd: false },
      mcpServers: {
        roots: { command: process.execPath, args: [script, firstLog] },
      },
    });
    const second = await buildCliStyleConfig('plain-text.jsonl', {
      sessionId: 'same-label',
      workingDir: bDir,
      folderTrust: true,
      harness: { includeProcessCwd: false },
      mcpServers: {
        roots: { command: process.execPath, args: [script, secondLog] },
      },
    });
    const agent = await fromConfig({
      settingsOwner: first.settingsOwner,
      settingsService: first.settingsService,
      config: first.config,
      providerManager: first.providerManager,
      agentClient: first.agentClient,
      mcpRuntime: first.mcpRuntime,
    });
    try {
      const originalSibling = await waitForRoots(secondLog, (value) =>
        value.includes(pathToFileURL(bDir).href),
      );
      expect(
        await waitForRoots(firstLog, (value) =>
          value.includes(pathToFileURL(aDir).href),
        ),
      ).toContain(pathToFileURL(aDir).href);
      agent.workspace.addDirectory(extra);
      expect(first.mcpRuntime.workspacePaths.directories()).toContain(extra);
      expect(
        await waitForRoots(firstLog, (value) =>
          value.includes(pathToFileURL(extra).href),
        ),
      ).toContain(pathToFileURL(extra).href);
      first.mcpRuntime.workspaceFilesystem.setDirectories([aDir]);
      expect(
        await waitForRoots(
          firstLog,
          (value) =>
            value.includes(pathToFileURL(aDir).href) &&
            !value.includes(pathToFileURL(extra).href),
        ),
      ).not.toContain(pathToFileURL(extra).href);
      await first.mcpRuntime.trust.setTrustedFolderLive(false);
      expect(first.mcpRuntime.workspacePaths.contains(extra)).toBe(false);
      expect(() => agent.workspace.addDirectory(extra)).toThrow('trusted');
      const status = first.mcpRuntime.status();
      if (!status) throw new Error('Missing MCP runtime status');
      const states = status.serverStates;
      expect(
        [...states.values()].every((state) => state.status === 'disconnected'),
      ).toBe(true);
      expect(
        (await readFile(secondLog, 'utf8'))
          .trim()
          .split('\n')
          .every((value) => value === originalSibling),
      ).toBe(true);
      expect(second.mcpRuntime.workspacePaths.contains(bDir)).toBe(true);
    } finally {
      await agent.dispose();
      await first.cleanup();
      await second.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('replacement clients read current owner directories rather than an initial snapshot', async () => {
    const built = await createSessionClientEngineFixture('same-label');
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'replacement-roots-')),
    );
    const before = built.owner.getAgentClient();
    try {
      built.mcp.workspaceFilesystem.addDirectory(directory);
      await built.owner.refreshAuth();
      expect(before).not.toBe(built.owner.getAgentClient());
      expect(built.owner.workspaceDirectories()).toContain(directory);
      await built.owner.getAgentClient().startChat();
      const generate = FakeProvider.prototype.generateChatCompletion;
      const requests: string[] = [];
      const observation = spyOn(
        FakeProvider.prototype,
        'generateChatCompletion',
      ).mockImplementation(async function* (this: FakeProvider, input) {
        requests.push(JSON.stringify(input));
        yield* generate.call(this, input);
      });
      for await (const event of built.owner
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
      await built.owner.refreshAuth();
      expect(built.owner.workspaceDirectories()).not.toContain(directory);
      await built.owner.getAgentClient().startChat();
      for await (const event of built.owner
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
      await built.cleanup();
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
      const agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        config: built.config,
        providerManager: built.providerManager,
        agentClient: built.agentClient,
        mcpRuntime: built.mcpRuntime,
      });
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
