import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '../session/session-settings-owner.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  EditTool,
  ShellTool,
  GlobTool,
  GrepTool,
  RipGrepTool,
  ReadFileTool,
  ReadManyFilesTool,
  WriteFileTool,
} from '@vybestack/llxprt-code-tools';
import { Config } from '../config/config.js';
import { StandardFileSystemService } from '../services/fileSystemService.js';
import { WorkspaceFilesystemOwner } from '../services/workspace-filesystem-owner.js';
import { CoreToolHostAdapter } from './CoreToolHostAdapter.js';
import { CoreShellToolHostAdapter } from './CoreShellToolHostAdapter.js';
import { initializeParser } from '../utils/shell-parser.js';

class TransformingFilesystem extends StandardFileSystemService {
  override async readTextFile(filePath: string): Promise<string> {
    return (await super.readTextFile(filePath)).replaceAll(
      'physical',
      'borrowed',
    );
  }
  override async writeTextFile(
    filePath: string,
    content: string,
  ): Promise<void> {
    await super.writeTextFile(filePath, content.replaceAll('model', 'host'));
  }
}

describe('public tools with workspace filesystem authority @issue:2615', () => {
  let directory = '';
  let target = '';
  let outside = '';
  let trusted = true;
  let owner: WorkspaceFilesystemOwner;
  let config: Config;
  let settingsOwner: SessionSettingsOwner;
  let host: CoreToolHostAdapter;
  beforeEach(async () => {
    directory = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'filesystem-tools-2615-')),
    );
    target = path.join(directory, 'target');
    outside = path.join(directory, 'outside');
    await Promise.all([mkdir(target), mkdir(outside)]);
    await writeFile(
      path.join(target, 'data.txt'),
      'physical first\nphysical second\n',
    );
    await writeFile(path.join(outside, 'outside.txt'), 'outside marker\n');
    trusted = true;
    settingsOwner = new SessionSettingsOwner(new SettingsService());
    config = new Config({
      targetDir: target,
      cwd: target,
      sessionId: 'same-label',
      model: 'test',
      debugMode: false,
    });
    owner = new WorkspaceFilesystemOwner({
      targetDir: target,
      isTrusted: () => trusted,
      fileSystem: {
        service: new TransformingFilesystem(),
        ownership: 'caller',
      },
    });
    host = new CoreToolHostAdapter(
      config,
      owner.paths,
      owner.files,
      owner.ignore,
      owner.scans,
      () => settingsOwner.readToolExecutionPolicy(),
      { isTrustedFolder: () => trusted, getIdeTrust: () => undefined },
      RootTelemetry.prepare({
        enabled: false,
        sessionId: 'isolated-caller-fixture',
        maxBytes: 1024,
        maxFiles: 1,
      }),
    );
  });
  afterEach(async () => {
    await owner.dispose();
    await config.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  it('refreshes physical llxprt ignore rules between public glob operations', async () => {
    const tool = new GlobTool(host);
    const signal = new AbortController().signal;
    const first = await tool.build({ pattern: '*.txt' }).execute(signal);
    expect(first.llmContent).toContain('data.txt');
    await writeFile(path.join(target, '.llxprtignore'), 'data.txt\n');
    const excluded = await tool.build({ pattern: '*.txt' }).execute(signal);
    expect(excluded.llmContent).not.toContain('data.txt');
    await writeFile(path.join(target, '.llxprtignore'), '');
    const restored = await tool.build({ pattern: '*.txt' }).execute(signal);
    expect(restored.llmContent).toContain('data.txt');
  });

  it('uses each admitted root ignore file for actual public ripgrep', async () => {
    owner.addDirectory(outside);
    await writeFile(path.join(target, '.llxprtignore'), 'data.txt\n');
    await writeFile(path.join(outside, '.llxprtignore'), 'outside.txt\n');
    const tool = new RipGrepTool(host);
    const signal = new AbortController().signal;
    const ignored = await tool
      .build({ pattern: 'outside marker', path: outside })
      .execute(signal);
    expect(ignored.llmContent).not.toContain('File: outside.txt');
    const selected = await tool
      .build({
        pattern: 'outside marker',
        path: outside,
        file_filtering_options: { respect_llxprt_ignore: false },
      })
      .execute(signal);
    expect(selected.llmContent).toContain('File: outside.txt');
  });

  it('closes bulk-read publication when an admitted directory loses trust', async () => {
    owner.addDirectory(outside);
    const accepted = new ReadManyFilesTool(host)
      .build({ paths: [path.join(outside, '*.txt')] })
      .execute(new AbortController().signal);
    trusted = false;
    await expect(accepted).rejects.toThrow('live workspace');
  });

  it('withdraws a trusted directory during an admitted public ripgrep scan', async () => {
    await writeFile(
      path.join(outside, 'secret.txt'),
      'withdrawn-resource-secret',
    );
    owner.addDirectory(outside);
    const accepted = new RipGrepTool(host)
      .build({ pattern: 'withdrawn-resource-secret', path: outside })
      .execute(new AbortController().signal);
    trusted = false;
    const result = await accepted;
    expect(result.llmContent).toContain('live workspace');
    expect(result.llmContent).not.toContain('File: secret.txt');
  });

  it('reads the borrowed implementation through the public read tool with line slicing', async () => {
    const result = await new ReadFileTool(host)

      .build({
        absolute_path: path.join(target, 'data.txt'),
        offset: 1,
        limit: 1,
      })
      .execute(new AbortController().signal);
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('borrowed second');
    expect(result.llmContent).not.toContain('physical');
  });

  it('writes through the borrowed implementation rather than bypassing it', async () => {
    const file = path.join(target, 'written.txt');
    const result = await new WriteFileTool(host)
      .build({ absolute_path: file, content: 'model content' })
      .execute(new AbortController().signal);
    expect(result.error).toBeUndefined();
    expect(await readFile(file, 'utf8')).toBe('host content');
  });

  it('searches an added directory through actual glob and grep tools and rejects it after removal', async () => {
    owner.addDirectory(outside);
    const glob = new GlobTool(host);
    const grep = new GrepTool(host);
    const signal = new AbortController().signal;
    const found = await glob
      .build({ pattern: '*.txt', dir_path: outside })
      .execute(signal);
    const matched = await grep
      .build({ pattern: 'marker', path: outside })
      .execute(signal);
    expect(found.llmContent).toContain('outside.txt');
    expect(matched.llmContent).toContain('outside marker');
    owner.setDirectories([target]);
    expect(() => glob.build({ pattern: '*.txt', dir_path: outside })).toThrow(
      'workspace',
    );
    expect(() => grep.build({ pattern: 'marker', path: outside })).toThrow(
      'workspace',
    );
  });

  it('rejects retained read and write invocations immediately when trust is revoked', async () => {
    owner.addDirectory(outside);
    const read = new ReadFileTool(host).build({
      absolute_path: path.join(outside, 'outside.txt'),
    });
    const write = new WriteFileTool(host).build({
      absolute_path: path.join(outside, 'new.txt'),
      content: 'forbidden',
    });
    trusted = false;
    const signal = new AbortController().signal;
    expect((await read.execute(signal)).error).toBeDefined();
    expect((await write.execute(signal)).error).toBeDefined();
    await expect(readFile(path.join(outside, 'new.txt'))).rejects.toThrow(
      'ENOENT',
    );
  });

  it('rejects retained search invocations when trust is revoked', async () => {
    owner.addDirectory(outside);
    const glob = new GlobTool(host).build({
      pattern: '*.txt',
      dir_path: outside,
    });
    const grep = new GrepTool(host).build({ pattern: 'marker', path: outside });
    trusted = false;
    const signal = new AbortController().signal;
    expect((await glob.execute(signal)).error).toBeDefined();
    expect((await grep.execute(signal)).error).toBeDefined();
  });
  it('runs a real shell in the live added directory and rejects a retained invocation after trust withdrawal', async () => {
    await initializeParser();
    owner.addDirectory(outside);
    const shell = new ShellTool(
      new CoreShellToolHostAdapter(config, owner.paths, () =>
        settingsOwner.readToolExecutionPolicy(),
      ),
      {
        requestConfirmation: async () => {
          throw new Error('Unexpected shell confirmation');
        },
      },
    );
    const signal = new AbortController().signal;
    const result = await shell
      .build({ command: "printf 'workspace-shell\\n'", dir_path: outside })
      .execute(signal);
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('workspace-shell');
    const retained = shell.build({
      command: "printf 'forbidden-shell\\n'",
      dir_path: outside,
    });
    trusted = false;
    await expect(retained.execute(signal)).rejects.toThrow('workspace');
  });

  it('edits real content through the same borrowed read and write implementation', async () => {
    const file = path.join(target, 'data.txt');
    const result = await new EditTool(host)
      .build({
        file_path: file,
        old_string: 'borrowed first',
        new_string: 'model change',
      })
      .execute(new AbortController().signal);
    expect(result.error).toBeUndefined();
    expect(await readFile(file, 'utf8')).toContain('host change');
    expect(await readFile(file, 'utf8')).not.toContain('physical first');
  });
  it('does not create an external parent directory when trust is revoked during an admitted preview read', async () => {
    let entered = (): void => {
      throw new Error('Uninitialized read gate');
    };
    let release = (): void => {
      throw new Error('Uninitialized read gate');
    };
    const ready = new Promise<void>((done) => {
      entered = done;
    });
    const held = new Promise<void>((done) => {
      release = done;
    });
    class HeldRead extends StandardFileSystemService {
      override async readTextFile(filePath: string): Promise<string> {
        entered();
        await held;
        return super.readTextFile(filePath);
      }
    }
    await owner.replaceFileSystem({
      service: new HeldRead(),
      ownership: 'caller',
    });
    owner.addDirectory(outside);
    const parent = path.join(outside, 'denied-parent');
    const pending = new WriteFileTool(host)
      .build({ absolute_path: path.join(parent, 'new.txt'), content: 'denied' })
      .execute(new AbortController().signal);
    await ready;
    trusted = false;
    release();
    expect((await pending).error).toBeDefined();
    await expect(stat(parent)).rejects.toThrow('ENOENT');
  });
});
