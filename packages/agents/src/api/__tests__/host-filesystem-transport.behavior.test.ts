/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgent } from '../createAgent.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { StandardFileSystemService } from '@vybestack/llxprt-code-core/services/fileSystemService.js';
import type { IShellToolHost } from '@vybestack/llxprt-code-tools';
import { ShellExecutionService } from '@vybestack/llxprt-code-core/services/shellExecutionService.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';

class UppercaseReadFileSystem extends StandardFileSystemService {
  override async readTextFile(path: string): Promise<string> {
    return (await super.readTextFile(path)).toUpperCase();
  }
}

describe('preferred Agent borrowed host filesystem transport', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    await runCleanupSteps(cleanup.splice(0).reverse());
  });
  const credentials = useOwnedCredentials();
  let directory: string;
  let prompts: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    prompts = await mkdtemp(join(tmpdir(), 'host-transport-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = prompts;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(prompts, { recursive: true, force: true });
  });
  beforeEach(async () => {
    directory = await realpath(
      await mkdtemp(join(tmpdir(), 'agent-host-transport-')),
    );
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
    );
    cleanup.push(() => {
      if (previousReplay === undefined)
        delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
    });
  });
  it('owns separate same-label workspace roots while borrowing the real file transport', async () => {
    const firstTransport = new UppercaseReadFileSystem();
    const secondTransport = new StandardFileSystemService();
    const first = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      sessionId: 'same-host-label',
      workingDir: directory,
      filesystemService: firstTransport,
      credentialAuthority: credentials().authority,
      harness: { includeProcessCwd: false },
    });
    cleanup.push(() => first.dispose());
    const second = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      sessionId: 'same-host-label',
      workingDir: directory,
      filesystemService: secondTransport,
      credentialAuthority: credentials().authority,
      harness: { includeProcessCwd: false },
    });
    cleanup.push(() => second.dispose());
    const path = join(directory, 'host-shared.txt');
    await first.workspace.writeTextFile(path, 'seventeen');
    expect(await readFile(path, 'utf8')).toBe('seventeen');
    expect(await first.workspace.readTextFile(path)).toBe('SEVENTEEN');
    expect(await second.workspace.readTextFile(path)).toBe('seventeen');
    await first.dispose();
    await expect(first.workspace.writeTextFile(path, 'closed')).rejects.toThrow(
      'closed',
    );
    await second.workspace.writeTextFile(path, 'seventeen doubled');
    expect(await firstTransport.readTextFile(path)).toBe('SEVENTEEN DOUBLED');
    await second.dispose();
    await secondTransport.writeTextFile(path, 'caller survives both');
    expect(await readFile(path, 'utf8')).toBe('caller survives both');
  });
  it('closes workspace admission immediately and joins a real admitted filesystem read', async () => {
    const transport = new StandardFileSystemService();
    let release = (): void => {};
    let entered = (): void => {};
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const source = join(directory, 'admitted.txt');
    await writeFile(source, 'admitted host data');
    const agent = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: directory,
      credentialAuthority: credentials().authority,
      filesystemService: {
        readTextFile: async (path) => {
          if (path === source) {
            entered();
            await proceed;
          }
          return transport.readTextFile(path);
        },
        writeTextFile: (path, text) => transport.writeTextFile(path, text),
      },
      harness: { includeProcessCwd: false },
    });
    cleanup.push(() => agent.dispose());
    const accepted = agent.workspace.readTextFile(source);
    try {
      await reading;
      let closed = false;
      const closing = agent.dispose().then(() => {
        closed = true;
      });
      await expect(agent.workspace.readTextFile(source)).rejects.toThrow(
        'closed',
      );
      expect(closed).toBe(false);
      release();
      expect(await accepted).toBe('admitted host data');
      await closing;
      expect(closed).toBe(true);
      await transport.writeTextFile(source, 'host remains usable');
      expect(await transport.readTextFile(source)).toBe('host remains usable');
    } finally {
      release();
      await accepted;
    }
  });
  it.each(['owner', 'caller-ownership'] as const)(
    'rejects conflicting filesystem %s before acquiring credentials',
    async (conflict) => {
      const filesystem = new WorkspaceFilesystemOwner({
        targetDir: directory,
        isTrusted: () => true,
      });
      cleanup.push(() => filesystem.dispose());
      const construction = createAgent({
        provider: 'fake',
        model: 'fake-model',
        workingDir: directory,
        credentialAuthority: credentials().authority,
        filesystemService: new StandardFileSystemService(),
        ...(conflict === 'owner'
          ? { filesystemOwner: filesystem }
          : { filesystemOwnership: 'caller' }),
      });
      cleanup.push(async () => {
        await construction.then(
          (agent) => agent.dispose(),
          () => undefined,
        );
      });
      await expect(construction).rejects.toThrow(
        'Filesystem transport requires an Agent-owned workspace root',
      );
      expect(credentials().snapshot()).toStrictEqual([]);
      expect(credentials().keySnapshot()).toStrictEqual([]);
      const path = join(directory, 'caller-root.txt');
      await filesystem.files.writeTextFile(path, 'caller still owns its root');
      expect(await readFile(path, 'utf8')).toBe('caller still owns its root');
    },
  );
  it('uses only the host execution transport while retaining session shell governance and retirement', async () => {
    const executeShellCommand: IShellToolHost['executeShellCommand'] = async (
      command,
      cwd,
      onOutput,
      signal,
    ) => {
      const handle = await ShellExecutionService.execute(
        command,
        cwd,
        (event) => {
          if (event.type === 'data' && typeof event.chunk === 'string')
            onOutput({ type: 'data', chunk: event.chunk });
        },
        signal,
        false,
      );
      const result = await handle.result;
      return {
        ...result,
        output: 'host-transport:' + result.output,
        signal: result.signal === null ? null : String(result.signal),
      };
    };
    const agent = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: directory,
      credentialAuthority: credentials().authority,
      executeShellCommand,
      allowedTools: ['run_shell_command'],
      harness: { includeProcessCwd: false },
    });
    cleanup.push(() => agent.dispose());
    const tool = agent.tools.get('run_shell_command');
    if (!tool) throw new Error('Missing session shell');
    const result = await tool.buildAndExecute(
      { command: 'echo physically-executed' },
      new AbortController().signal,
    );
    expect(String(result.llmContent)).toContain(
      'host-transport:physically-executed',
    );
    expect(() =>
      tool.buildAndExecute(
        { command: 'echo forbidden', dir_path: tmpdir() },
        new AbortController().signal,
      ),
    ).toThrow('Directory must be within');
    await agent.dispose();
    expect(() =>
      tool.buildAndExecute(
        { command: 'echo retired' },
        new AbortController().signal,
      ),
    ).toThrow('closed');
    const restricted = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: directory,
      credentialAuthority: credentials().authority,
      executeShellCommand,
      excludeTools: ['ShellTool'],
      harness: { includeProcessCwd: false },
    });
    cleanup.push(() => restricted.dispose());
    expect(restricted.tools.get('run_shell_command')).toBeUndefined();
  });
  it.each([
    { filesystemService: null },
    {
      filesystemService: {
        readTextFile: 'not executable',
        writeTextFile: async () => {},
      },
    },
    { executeShellCommand: null },
    { executeShellCommand: 'not executable' },
  ])(
    'rejects malformed host transport before acquiring provider credentials (%j)',
    async (transport) => {
      const construction: ReturnType<typeof createAgent> = Reflect.apply(
        createAgent,
        undefined,
        [
          {
            provider: 'fake',
            model: 'fake-model',
            workingDir: directory,
            credentialAuthority: credentials().authority,
            ...transport,
          },
        ],
      );
      cleanup.push(() =>
        construction.then(
          (agent) => agent.dispose(),
          () => {},
        ),
      );
      await expect(construction).rejects.toThrow('Invalid host transport');
      expect(credentials().snapshot()).toStrictEqual([]);
      expect(credentials().keySnapshot()).toStrictEqual([]);
    },
  );
});
