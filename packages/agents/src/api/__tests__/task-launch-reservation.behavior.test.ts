/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import * as fs from 'node:fs/promises';
import type { PathLike, OpenMode, ObjectEncodingOptions } from 'node:fs';
import type { Abortable } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { ApprovalMode } from '@vybestack/llxprt-code-agents';
import { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
import { resolveShellJobSettings } from '@vybestack/llxprt-code-core/config/asyncTaskServices.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ToolResult } from '@vybestack/llxprt-code-tools';
import { assembleTaskOwner } from '../agent-shell-assembly.js';
import { ChildToolDisplay } from '../../session/childToolDisplay.js';
import { ShellJobOwner } from '../../session/shell-job-owner.js';
import type { TaskLaunchOwner } from '../../session/task-launch-owner.js';
import { gate } from './helpers/async-child-disposal-join-fixture.js';
import { openClientOwner } from './helpers/client-owner-session.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

interface HeldLaunch {
  readonly tasks: TaskLaunchOwner;
  readonly entered: Promise<void>;
  readonly release: () => void;
  readonly launch: (signal: AbortSignal) => Promise<ToolResult>;
}

/**
 * A production `TaskLaunchOwner` (and its `AsyncTaskManager`) behind the real
 * task tool of a session client owner, with one async slot and the subagent
 * definition read held in storage so the launch stays pending.
 */
async function withHeldLaunch(
  authority: CredentialAuthority,
  scenario: (held: HeldLaunch) => Promise<void>,
): Promise<void> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'task-launch-reservation-')),
  );
  const definitions = new WorkspaceDefinitionOwner(
    join(directory, 'profiles'),
    join(directory, 'subagents'),
  );
  const entered = gate();
  const released = gate();
  const target = join(directory, 'subagents', 'child.json');
  const original = fs.readFile;
  function heldRead(
    path: PathLike | fs.FileHandle,
    options?: ({ encoding?: null; flag?: OpenMode } & Abortable) | null,
  ): Promise<Buffer<ArrayBuffer>>;
  function heldRead(
    path: PathLike | fs.FileHandle,
    options:
      | BufferEncoding
      | ({ encoding: BufferEncoding; flag?: OpenMode } & Abortable),
  ): Promise<string>;
  function heldRead(
    path: PathLike | fs.FileHandle,
    options?:
      | BufferEncoding
      | (ObjectEncodingOptions & Abortable & { flag?: OpenMode })
      | null,
  ): Promise<string | Buffer<ArrayBuffer>>;
  async function heldRead(
    path: PathLike | fs.FileHandle,
    options?:
      | BufferEncoding
      | (ObjectEncodingOptions & Abortable & { flag?: OpenMode })
      | null,
  ): Promise<string | Buffer<ArrayBuffer>> {
    if (String(path) === target) {
      entered.release();
      await released.promise;
    }
    return original(path, options);
  }
  let opened: Awaited<ReturnType<typeof openClientOwner>> | undefined;
  let tasks: TaskLaunchOwner | undefined;
  let shell: ShellJobOwner | undefined;
  const read = vi.spyOn(fs, 'readFile');
  try {
    await definitions.profileWrites.saveProfile('child', {
      version: 1,
      provider: 'openai',
      model: 'child-model',
      modelParams: {},
      ephemeralSettings: {
        'auth-key': 'test-key',
        'base-url': 'http://127.0.0.1:9/v1',
      },
    });
    await definitions.subagentWrites.saveSubagent(
      'child',
      'child',
      'Complete the goal.',
    );
    let foregroundSettings: SettingsService | undefined;
    opened = await openClientOwner(
      authority,
      {
        provider: 'openai',
        model: 'parent-model',
        sessionId: randomUUID(),
        workingDir: directory,
        approvalMode: ApprovalMode.YOLO,
        folderTrust: true,
        interactive: false,
        coreTools: ['task'],
        telemetry: { enabled: false },
        recording: { enabled: false },
        definitionOwner: definitions,
        definitionOwnership: 'caller',
        harness: { includeProcessCwd: false },
      },
      {
        provider: 'openai',
        model: 'parent-model',
        cliOverrides: { key: 'test-key', baseUrl: 'http://127.0.0.1:9/v1' },
      },
      {
        createSettingsOwner: (settings) => {
          foregroundSettings = settings;
          return new SessionSettingsOwner(settings);
        },
      },
    );
    if (foregroundSettings === undefined) throw new Error('No parent settings');
    foregroundSettings.set('task-max-async', 1);
    const owner = assembleTaskOwner(foregroundSettings);
    tasks = owner;
    const settings = foregroundSettings;
    shell = new ShellJobOwner(() => resolveShellJobSettings(settings));
    opened.owner.toolCatalog.bindChildExecution(
      new ChildToolDisplay(),
      owner,
      shell,
    );
    const task = opened.owner.toolCatalog.acquireChildTools().getTool('task');
    if (task === undefined) throw new Error('Missing task tool');
    read.mockImplementation(heldRead);
    await scenario({
      tasks: owner,
      entered: entered.promise,
      release: released.release,
      launch: (signal) =>
        task.buildAndExecute(
          {
            subagent_name: 'child',
            goal_prompt: 'Complete.',
            async: true,
          },
          signal,
        ),
    });
  } finally {
    released.release();
    read.mockRestore();
    tasks?.closeAdmissionAndAbort();
    await Promise.allSettled([shell?.dispose(), tasks?.join()]);
    await opened?.close();
    await definitions.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}

describe('task launch owner pending reservation', () => {
  const credentials = useOwnedCredentials();

  it('holds its async slot while the launch is blocked in subagent storage and releases it when the parent aborts', async () => {
    await withHeldLaunch(credentials().authority, async (held) => {
      expect(held.tasks.manager.canLaunchAsync().allowed).toBe(true);
      const controller = new AbortController();
      const result = held.launch(controller.signal);
      await held.entered;
      expect(held.tasks.manager.canLaunchAsync().allowed).toBe(false);
      expect(held.tasks.getAllTasks()).toHaveLength(0);
      controller.abort(new Error('Parent cancelled pending child'));
      held.release();
      const outcome = await result;
      expect(String(outcome.llmContent)).toMatch(/abort|cancel/i);
      expect(held.tasks.getAllTasks()).toHaveLength(0);
      expect(held.tasks.manager.canLaunchAsync().allowed).toBe(true);
    });
  }, 30000);

  it('keeps its async slot until the blocked launch settles after the owner closes admission, then releases it', async () => {
    await withHeldLaunch(credentials().authority, async (held) => {
      const result = held.launch(new AbortController().signal);
      await held.entered;
      expect(held.tasks.manager.canLaunchAsync().allowed).toBe(false);
      held.tasks.closeAdmissionAndAbort();
      let joined = false;
      const joining = held.tasks.join().then(() => {
        joined = true;
      });
      await setImmediate();
      expect(joined).toBe(false);
      expect(held.tasks.getAllTasks()).toHaveLength(0);
      held.release();
      expect((await result).error).toBeDefined();
      await joining;
      expect(held.tasks.getAllTasks()).toHaveLength(0);
      expect(held.tasks.manager.canLaunchAsync().allowed).toBe(true);
    });
  }, 30000);
});
