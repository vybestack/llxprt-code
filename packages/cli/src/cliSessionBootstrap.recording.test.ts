/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { collectResumeRows } from './test-utils/resumeRows.js';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
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

let root: string;

let chatsDir: string;

describe('recording bootstrap checkpoint resolution', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'recording-bootstrap-'));
    chatsDir = join(root, 'chats');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it(
    'returns the checkpoint child boot directly and keeps the prefix independent',
    verifyReturnsTheCheckpointChildBootDirectlyAndKeepsThePrefixIndependent,
  );

  it(
    'reports an ambiguous checkpoint reference instead of starting a fresh session',
    verifyReportsAnAmbiguousCheckpointReferenceInsteadOfStartingAFreshSession,
  );
});

async function verifyReturnsTheCheckpointChildBootDirectlyAndKeepsThePrefixIndependent(): Promise<void> {
  const source = new SessionRecordingService(
    recordingConfig(chatsDir, 'parent'),
  );
  source.recordContent({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'prefix' }],
  });
  await source.createCheckpoint('startup-cut');
  source.recordContent({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'excluded' }],
  });
  await source.dispose();
  const config = new Config({
    cwd: root,
    targetDir: root,
    debugMode: false,
    question: undefined,
    userMemory: '',
    sessionId: 'fresh',
    model: 'test-model',
    provider: 'test-provider',
    continueSession: 'startup-cut',
    settingsService: new SettingsService(),
  });
  const result = await createOrResumeRecording(config, PROJECT_HASH, chatsDir);
  try {
    if (result.resumedBoot === null) throw new Error('Missing checkpoint boot');
    expect(result.discardOnFailure).toBe(true);
    expect(result.resumedSessionId).not.toBe('parent');
    expect(
      (await collectResumeRows(result.resumedBoot.streamRows())).map(
        (row) => row.blocks,
      ),
    ).toStrictEqual([[{ type: 'text', text: 'prefix' }]]);
    const childPath = result.recordingService.getFilePath();
    if (childPath === null) throw new Error('Missing child path');
    expect(result.resumedBoot.filePath).toBe(childPath);
  } finally {
    await result.recordingService.dispose();
  }
  await expect(
    collectResumeRows(result.resumedBoot.streamRows()),
  ).rejects.toThrow('closed');
}

async function verifyReportsAnAmbiguousCheckpointReferenceInsteadOfStartingAFreshSession(): Promise<void> {
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
}
