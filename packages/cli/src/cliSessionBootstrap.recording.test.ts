/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Config,
  SessionRecordingService,
  type SessionRecordingServiceConfig,
} from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createOrResumeRecording } from './cliSessionBootstrap.js';

const PROJECT_HASH = 'startup-recording-test';

function recordingConfig(
  chatsDir: string,
  sessionId: string,
): SessionRecordingServiceConfig {
  return {
    chatsDir,
    sessionId,
    projectHash: PROJECT_HASH,
    workspaceDirs: [chatsDir],
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
      recording.recordContent({
        speaker: 'human',
        blocks: [{ type: 'text', text: sessionId }],
      });
      await recording.createCheckpoint('duplicate-name');
      await recording.flush();
      await recording.dispose();
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
    ).rejects.toThrow("Ambiguous continue target name 'duplicate-name'");
  });
});
