import {
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  afterEach,
  beforeEach,
} from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { Storage } from '@vybestack/llxprt-code-settings';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  processRestorableToolCalls,
  getToolCallDataSchema,
} from '@vybestack/llxprt-code-core';

import { buildAgent } from './helpers/agentHarness.js';
import { makeScratchDir } from './helpers/scratch-dir.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('public Agent workspace checkpoint lifetime', () => {
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

  function useProject(): () => string {
    let root = '';
    let project = '';
    let dataHome: string | undefined;
    let sandbox: string | undefined;
    beforeEach(async () => {
      root = await makeScratchDir('agent-checkpoints-');
      expect(root).not.toContain(resolve(import.meta.dir, '../../..'));
      project = join(root, 'project');
      await mkdir(project);
      execFileSync('git', ['init', '--initial-branch=main', project]);
      dataHome = process.env.LLXPRT_DATA_HOME;
      sandbox = process.env.SANDBOX;
      process.env.LLXPRT_DATA_HOME = join(root, 'data');
      delete process.env.SANDBOX;
      await writeFile(join(project, 'source.txt'), 'before edit\n');
    });
    afterEach(async () => {
      if (dataHome === undefined) delete process.env.LLXPRT_DATA_HOME;
      else process.env.LLXPRT_DATA_HOME = dataHome;
      if (sandbox === undefined) delete process.env.SANDBOX;
      else process.env.SANDBOX = sandbox;
      await rm(root, { recursive: true, force: true });
    });
    return () => project;
  }

  const project = useProject();

  it('snapshots and restores physical workspace files through the public Agent', async () => {
    const built = await buildAgent('plain-text.jsonl', {
      workingDir: project(),
      checkpointing: true,
      harness: { includeProcessCwd: false, forceConfirmations: false },
    });
    try {
      const hash =
        await built.agent.workspace.checkpoints.createFileSnapshot(
          'public snapshot',
        );
      await writeFile(join(project(), 'source.txt'), 'after edit');
      await built.agent.workspace.checkpoints.restoreProjectFromSnapshot(hash);
      expect(await readFile(join(project(), 'source.txt'), 'utf8')).toBe(
        'before edit\n',
      );
      await writeFile(
        join(project(), 'accepted.txt'),
        'accepted before close\n',
      );
      const accepted = built.agent.workspace.checkpoints.createFileSnapshot(
        'accepted before disposal',
      );
      const closing = built.agent.dispose();
      expect(() =>
        built.agent.workspace.checkpoints.getCurrentCommitHash(),
      ).toThrow('closed');
      expect(await accepted).toMatch(/^[0-9a-f]+$/);
      await closing;
      expect(
        await readFile(
          join(new Storage(project()).getHistoryDir(), '.git/HEAD'),
          'utf8',
        ),
      ).toMatch(/^ref: refs\/heads\/main/);
    } finally {
      await built.cleanup();
    }
  }, 30000);

  it('serializes restorable tool checkpoints using only admitted workspace operations', async () => {
    const built = await buildAgent('plain-text.jsonl', {
      workingDir: project(),
      checkpointing: true,
      harness: { includeProcessCwd: false, forceConfirmations: false },
    });
    try {
      const result = await processRestorableToolCalls(
        [
          {
            callId: 'physical-call',
            name: 'write_file',
            args: {
              file_path: join(project(), 'source.txt'),
              content: 'replacement',
            },
            isClientInitiated: false,
            prompt_id: 'physical-prompt',
          },
        ],
        built.agent.workspace.checkpoints,
        { getHistory: () => built.agent.getHistory() },
      );
      expect(result.errors).toStrictEqual([]);
      expect(result.checkpointsToWrite.size).toBe(1);
      for (const serialized of result.checkpointsToWrite.values()) {
        const checkpoint = getToolCallDataSchema().parse(
          JSON.parse(serialized),
        );
        const hash = checkpoint.commitHash;
        if (hash === undefined)
          throw new Error('Physical checkpoint hash missing');
        await writeFile(join(project(), 'source.txt'), 'replacement');
        await built.agent.workspace.checkpoints.restoreProjectFromSnapshot(
          hash,
        );
        expect(await readFile(join(project(), 'source.txt'), 'utf8')).toBe(
          'before edit\n',
        );
        expect(checkpoint.messageId).toBe('physical-prompt');
      }
    } finally {
      await built.cleanup();
    }
  }, 30000);
  it.each([0, 1])(
    "keeps the surviving agent's checkpoints usable when the other agent closes first (%s)",
    async (closingIndex) => {
      const first = await buildAgent('multi-turn-text.jsonl', {
        workingDir: project(),
        checkpointing: true,
        harness: { includeProcessCwd: false, forceConfirmations: false },
      });
      const second = await buildAgent('multi-turn-text.jsonl', {
        workingDir: project(),
        checkpointing: true,
        harness: { includeProcessCwd: false, forceConfirmations: false },
      });
      const closing = closingIndex === 0 ? first.agent : second.agent;
      const peer = closingIndex === 0 ? second.agent : first.agent;
      try {
        const hash =
          await peer.workspace.checkpoints.createFileSnapshot(
            'caller checkpoint',
          );
        const disposal = closing.dispose();
        expect(() =>
          closing.workspace.checkpoints.createFileSnapshot('closed facade'),
        ).toThrow('closed');
        await disposal;
        await writeFile(join(project(), 'source.txt'), 'peer edit');
        await peer.workspace.checkpoints.restoreProjectFromSnapshot(hash);
        expect(await readFile(join(project(), 'source.txt'), 'utf8')).toBe(
          'before edit\n',
        );
        expect(await peer.workspace.checkpoints.getCurrentCommitHash()).toBe(
          hash,
        );
      } finally {
        await second.cleanup();
        await first.cleanup();
      }
    },
    30000,
  );
});
