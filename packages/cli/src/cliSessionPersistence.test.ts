/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMediaStore } from '@vybestack/llxprt-code-core';
import { Storage } from '@vybestack/llxprt-code-settings';
import { AgentSessionPersistence } from '../../agents/src/api/control/recordedHistoryPersistence.js';
import { CliSessionPersistence } from './cliSessionPersistence.js';

describe('CLI session persistence lifetime', () => {
  const directories: string[] = [];
  afterEach(async () => {
    for (const directory of directories.splice(0))
      await rm(directory, { recursive: true, force: true });
  });

  it('reuses one journal during resume and rejects requests after close', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cli-persistence-'));
    directories.push(root);
    const owner = new CliSessionPersistence(
      {
        projectRoot: new Storage(root).getProjectRoot(),
        chatsDir: new Storage(root).getProjectChatsDir(),
      },
      {
        mediaStore: new LocalMediaStore({
          rootDirectory: join(root, 'media'),
          quotaBytes: 4096,
        }),
        maxQueueBytes: 4096,
      },
    );
    const first = owner.forRecording('early-resume');
    const resumed = owner.forRecording('early-resume');
    expect(new Set([first, resumed]).size).toBe(1);
    owner.close();
    expect(() => owner.mediaStore).toThrow('CLI session persistence is closed');
    expect(() => owner.forRecording('early-resume')).toThrow(
      'CLI session persistence is closed',
    );
    const reopened = new CliSessionPersistence(
      {
        projectRoot: new Storage(root).getProjectRoot(),
        chatsDir: new Storage(root).getProjectChatsDir(),
      },
      {
        maxQueueBytes: 4096,
      },
    );
    expect(reopened.forRecording('early-resume').getSessionFilePath()).not.toBe(
      first.getSessionFilePath(),
    );
    reopened.close();
  });

  it('keeps Agent and CLI journals independent even for the same label', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cli-persistence-'));
    directories.push(root);
    const storage = new Storage(root);
    const agent = new AgentSessionPersistence(
      {
        projectRoot: storage.getProjectRoot(),
        chatsDir: storage.getProjectChatsDir(),
      },
      {},
    );
    const cli = new CliSessionPersistence(
      {
        projectRoot: storage.getProjectRoot(),
        chatsDir: storage.getProjectChatsDir(),
      },
      {},
    );
    const agentJournal = agent.forRecording('shared');
    expect(cli.forRecording('shared').getSessionFilePath()).not.toBe(
      agentJournal.getSessionFilePath(),
    );
    cli.close();
    expect(new Set([agentJournal, agent.forRecording('shared')]).size).toBe(1);
    agent.close();
  });
});
