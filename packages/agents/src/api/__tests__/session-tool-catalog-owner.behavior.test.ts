/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CheckAsyncTasksTool,
  ReadFileTool,
} from '@vybestack/llxprt-code-tools';
import { fromConfig } from '../fromConfig.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';

async function openWorkspace(coreTools?: string[]) {
  const directory = await mkdtemp(join(tmpdir(), 'session-tools-'));
  await writeFile(join(directory, 'input.txt'), 'seven physical apples');
  const built = await buildCliStyleConfig('plain-text.jsonl', {
    workingDir: directory,
    coreTools,
    folderTrust: true,
    telemetry: { enabled: false },
    recording: { enabled: false },
  });
  return {
    directory,
    built,
    close: async (): Promise<void> => {
      await built.cleanup();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function adopt(workspace: Awaited<ReturnType<typeof openWorkspace>>) {
  return fromConfig({
    settingsOwner: workspace.built.settingsOwner,
    settingsService: workspace.built.settingsService,
    config: workspace.built.config,
    providerManager: workspace.built.providerManager,
    mcpRuntime: workspace.built.mcpRuntime,
  });
}

describe('session executable tool ownership', () => {
  it('registers an argument-specific ShellTool allowlist without registering ReadFileTool', async () => {
    const workspace = await openWorkspace(['ShellTool(git status)']);
    const agent = await adopt(workspace);
    try {
      const shell = agent.tools.get('run_shell_command');
      expect(shell).toBeDefined();
      expect(agent.tools.get('read_file')).toBeUndefined();
      if (!shell) throw new Error('Missing governed shell');
      const result = await shell.buildAndExecute(
        { command: 'git status' },
        new AbortController().signal,
      );
      expect(String(result.llmContent)).toContain('not a git repository');
    } finally {
      await agent.dispose();
      await workspace.close();
    }
  });

  it('reads and writes physical files without selecting runtime tooling through Config', async () => {
    const workspace = await openWorkspace();
    const agent = await adopt(workspace);
    Object.defineProperty(workspace.built.config, 'getToolRegistry', {
      configurable: true,
      value: (): never => {
        throw new Error('Config cannot select executable tooling');
      },
    });
    try {
      const input = agent.tools.get('read_file');
      const output = agent.tools.get('write_file');
      if (!input || !output) throw new Error('Missing physical file tools');
      const result = await input.buildAndExecute(
        { absolute_path: join(workspace.directory, 'input.txt') },
        new AbortController().signal,
      );
      expect(String(result.llmContent)).toContain('seven physical apples');
      await output.buildAndExecute(
        {
          absolute_path: join(workspace.directory, 'output.txt'),
          content: '49 apple pairs',
        },
        new AbortController().signal,
      );
      expect(
        await readFile(join(workspace.directory, 'output.txt'), 'utf8'),
      ).toBe('49 apple pairs');
    } finally {
      await agent.dispose();
      await workspace.close();
    }
  });

  it('rejects retained dispatch after disabling a tool and after facade disposal', async () => {
    const workspace = await openWorkspace();
    const agent = await adopt(workspace);
    try {
      const tool = agent.tools.get('write_file');
      if (!tool) throw new Error('Missing write tool');
      const invocation = tool.build({
        absolute_path: join(workspace.directory, 'forbidden.txt'),
        content: 'must not be written',
      });
      workspace.built.settingsService.set('tools.disabled', ['write_file']);
      await expect(
        invocation.execute(new AbortController().signal),
      ).rejects.toThrow('unavailable');
      await expect(
        readFile(join(workspace.directory, 'forbidden.txt')),
      ).rejects.toThrow('ENOENT');
      workspace.built.settingsService.set('tools.disabled', []);
      await agent.dispose();
      await expect(
        tool.buildAndExecute(
          {
            absolute_path: join(workspace.directory, 'closed.txt'),
            content: 'must not be written',
          },
          new AbortController().signal,
        ),
      ).rejects.toThrow('closed');
    } finally {
      await agent.dispose();
      await workspace.close();
    }
  });

  it('keeps executable file and shell tooling usable in a peer sharing the workspace', async () => {
    const workspace = await openWorkspace();
    const first = await adopt(workspace);
    const second = await adopt(workspace);
    try {
      await first.dispose();
      const read = second.tools.get('read_file');
      const shell = second.tools.get('run_shell_command');
      if (!read || !shell) throw new Error('Peer tooling was withdrawn');
      expect(
        String(
          (
            await read.buildAndExecute(
              { absolute_path: join(workspace.directory, 'input.txt') },
              new AbortController().signal,
            )
          ).llmContent,
        ),
      ).toContain('seven physical apples');
      const output = await shell.buildAndExecute(
        { command: 'printf "%s" "$((7 * 7))"' },
        new AbortController().signal,
      );
      expect(String(output.llmContent)).toContain('49');
    } finally {
      await first.dispose();
      await second.dispose();
      await workspace.close();
    }
  });
  it('rejects a retained session shell invocation without writing after facade close', async () => {
    const workspace = await openWorkspace();
    const agent = await adopt(workspace);
    try {
      const shell = agent.tools.get('run_shell_command');
      if (!shell) throw new Error('Missing shell tooling');
      const invocation = shell.build({
        command: 'printf forbidden > retained-shell.txt',
      });
      await agent.dispose();
      await expect(
        invocation.execute(new AbortController().signal),
      ).rejects.toThrow('closed');
      await expect(
        readFile(join(workspace.directory, 'retained-shell.txt')),
      ).rejects.toThrow('ENOENT');
    } finally {
      await agent.dispose();
      await workspace.close();
    }
  });
  it('denies validated retained file dispatch after its session closes', async () => {
    const fixture = await openWorkspace();
    const agent = await adopt(fixture);
    const signal = new AbortController().signal;
    const tool = agent.agentClient.tools.getTool('write_file');
    if (!tool) throw new Error('Missing executable writer');
    const file = join(fixture.directory, 'validated-retained.txt');
    try {
      await agent.dispose();
      await expect(
        tool.validateBuildAndExecute(
          { absolute_path: file, content: 'forbidden' },
          signal,
        ),
      ).rejects.toThrow('closed');
      await expect(readFile(file, 'utf8')).rejects.toThrow('ENOENT');
    } finally {
      await agent.dispose();
      await fixture.close();
    }
  });

  it('rejects a retained async task status invocation after session closure', async () => {
    const workspace = await openWorkspace();
    const agent = await adopt(workspace);
    try {
      const status = agent.tools.get('check_async_tasks');
      if (!status) throw new Error('Missing task status tooling');
      const invocation = status.build({});
      await agent.dispose();
      await expect(
        invocation.execute(new AbortController().signal),
      ).rejects.toThrow('closed');
    } finally {
      await agent.dispose();
      await workspace.close();
    }
  });
  it('denies direct retained asynchronous-status dispatch after session closure', async () => {
    const workspace = await openWorkspace();
    const agent = await adopt(workspace);
    const status = agent.agentClient.tools.getTool('check_async_tasks');
    if (!(status instanceof CheckAsyncTasksTool))
      throw new Error('Missing status tool');
    try {
      await agent.dispose();
      await expect(status.execute({})).rejects.toThrow('closed');
    } finally {
      await agent.dispose();
      await workspace.close();
    }
  });
  it('closes retained executable admission synchronously when facade disposal starts', async () => {
    const workspace = await openWorkspace();
    const agent = await adopt(workspace);
    const writer = agent.tools.get('write_file');
    if (!writer) throw new Error('Missing writer');
    try {
      const closing = agent.dispose();
      expect(() =>
        writer.build({
          absolute_path: join(workspace.directory, 'late.txt'),
          content: 'forbidden',
        }),
      ).toThrow('closed');
      await closing;
      await expect(
        readFile(join(workspace.directory, 'late.txt'), 'utf8'),
      ).rejects.toThrow('ENOENT');
    } finally {
      await agent.dispose();
      await workspace.close();
    }
  });
  it('rejects direct file reads when the caller has already cancelled admission', async () => {
    const workspace = await openWorkspace();
    const agent = await adopt(workspace);
    try {
      const tool = agent.agentClient.tools.getTool('read_file');
      if (!(tool instanceof ReadFileTool)) throw new Error('Missing reader');
      const cancelled = new AbortController();
      const failure = new Error('Caller cancelled physical read');
      cancelled.abort(failure);
      await expect(
        tool.execute(
          { absolute_path: join(workspace.directory, 'input.txt') },
          cancelled.signal,
        ),
      ).rejects.toBe(failure);
    } finally {
      await agent.dispose();
      await workspace.close();
    }
  });
});
