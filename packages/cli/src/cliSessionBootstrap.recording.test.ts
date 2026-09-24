/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Config,
  getProjectHash,
  SessionRecordingService,
  type AgentClientContract,
  type IContent,
  type SessionRecordingServiceConfig,
} from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ParsedCliArgs } from './cliBootstrap.js';
import {
  createOrResumeRecording,
  setupSessionRecording,
} from './cliSessionBootstrap.js';

const PROJECT_HASH = 'startup-recording-test';

function recordingConfig(
  chatsDir: string,
  sessionId: string,
  projectHash: string = PROJECT_HASH,
  workspaceDir: string = chatsDir,
): SessionRecordingServiceConfig {
  return {
    chatsDir,
    sessionId,
    projectHash,
    workspaceDirs: [workspaceDir],
    provider: 'test-provider',
    model: 'test-model',
  };
}

describe('recording bootstrap checkpoint resolution', () => {
  let root: string;
  let chatsDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'recording-bootstrap-'));
    chatsDir = join(root, 'chats');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reports an ambiguous checkpoint reference instead of starting a fresh session', async () => {
    for (const sessionId of ['source-one', 'source-two']) {
      const recording = new SessionRecordingService(
        recordingConfig(chatsDir, sessionId),
      );
      try {
        recording.recordContent({
          speaker: 'human',
          blocks: [{ type: 'text', text: sessionId }],
        });
        await recording.createCheckpoint('duplicate-name');
        await recording.flush();
      } finally {
        await recording.dispose();
      }
    }

    const config = new Config({
      cwd: root,
      targetDir: root,
      debugMode: false,
      question: undefined,
      userMemory: '',
      sessionId: 'fresh-session',
      model: 'test-model',
      provider: 'test-provider',
      continueSession: 'duplicate-name',
      settingsService: new SettingsService(),
    });

    await expect(
      createOrResumeRecording(config, PROJECT_HASH, chatsDir),
    ).rejects.toThrow(/Ambiguous continue target name/);
  });

  it('restores continued history into the active Agent session client', async () => {
    const config = new Config({
      cwd: root,
      targetDir: root,
      debugMode: false,
      question: undefined,
      userMemory: '',
      sessionId: 'fresh-session',
      model: 'test-model',
      provider: 'test-provider',
      continueSession: true,
      settingsService: new SettingsService(),
    });
    const projectHash = getProjectHash(config.getProjectRoot());
    const projectChatsDir = join(config.getProjectTempDir(), 'chats');
    const priorRecording = new SessionRecordingService(
      recordingConfig(projectChatsDir, randomUUID(), projectHash, root),
    );
    priorRecording.recordContent({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'recorded turn' }],
    });
    await priorRecording.flush();
    await priorRecording.dispose();

    let bootstrapHistory: readonly IContent[] = [];
    Reflect.set(config, 'agentClient', {
      restoreHistory: async (history: readonly IContent[]) => {
        bootstrapHistory = history;
      },
    });
    let sessionHistory: readonly IContent[] = [];
    const sessionClient: Pick<
      AgentClientContract,
      'resetChat' | 'restoreHistory'
    > = {
      resetChat: async () => {},
      restoreHistory: async (history) => {
        sessionHistory = history;
      },
    };

    const setup = await setupSessionRecording(
      config,
      { listSessions: false } as ParsedCliArgs,
      null,
      sessionClient,
    );
    try {
      expect(sessionHistory.length).toBeGreaterThan(0);
      expect(bootstrapHistory).toHaveLength(0);
    } finally {
      await setup.recordingIntegration.dispose();
      await setup.recordingService.dispose();
      await setup.resumedLockHandle?.release();
      await rm(config.getProjectTempDir(), { recursive: true, force: true });
    }
  });
});
