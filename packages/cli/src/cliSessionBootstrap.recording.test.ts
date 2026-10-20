/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Config,
  SessionRecordingService,
  type SessionRecordingServiceConfig,
  getProjectHash,
} from '@vybestack/llxprt-code-core';
import {
  createUiSessionOwner,
  uiFixtureResources,
} from './__tests__/uiSessionOwner.js';
import { setupOwnerSessionRecording } from './cliSessionBootstrap.js';

let projectHash: string;

function recordingConfig(
  chatsDir: string,
  sessionId: string,
): SessionRecordingServiceConfig {
  return {
    chatsDir,
    sessionId,
    projectHash,
    workspaceDirs: [chatsDir],
    provider: 'test-provider',
    model: 'test-model',
  };
}

class RecordingConfig extends Config {
  override readonly projectTempDir: string;
  override readonly projectChatsDir: string;
  constructor(
    root: string,
    parameters: ConstructorParameters<typeof Config>[0],
  ) {
    super(parameters);
    this.projectTempDir = join(root, getProjectHash(root));
    this.projectChatsDir = join(root, 'chats');
  }
}

describe('recording bootstrap checkpoint resolution', () => {
  let root: string;
  let chatsDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'recording-bootstrap-'));
    chatsDir = join(root, 'chats');
    projectHash = getProjectHash(root);
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

    const config = new RecordingConfig(root, {
      cwd: root,
      targetDir: root,
      debugMode: false,
      question: undefined,
      userMemory: '',
      sessionId: 'fresh-session',
      model: 'test-model',
      provider: 'test-provider',
      continueSession: 'duplicate-name',
    });

    const owner = await createUiSessionOwner(config);
    const session = uiFixtureResources(
      owner,
    ).sessionClient.createSessionControl(
      'config',
      () => config.getSessionId(),
      (operation) => operation(),
      () => {},
      () => {},
      () => config.getProvider() ?? '',
      () => config.getModel(),
    );
    try {
      await expect(
        setupOwnerSessionRecording(
          config,
          session,
          session.listBrowserTargetsDetailed,
          { listSessions: false, deleteSession: undefined },
          null,
        ),
      ).rejects.toThrow(/Ambiguous continue target name/);
    } finally {
      await session.dispose();
      await config.dispose();
    }
  });
});
