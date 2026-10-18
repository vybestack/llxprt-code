/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { collectResumeRows } from './__tests__/resumeRows.js';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Config,
  ResumeCursorBoot,
  SessionRecordingService,
  type SessionRecordingServiceConfig,
} from '@vybestack/llxprt-code-core';
import { createUiSessionOwner } from './__tests__/uiSessionOwner.js';
import { createOrResumeRecording } from './cliSessionBootstrap.js';
import { pinHistoryBackend } from './services/__tests__/support/pinHistoryBackend.js';

// The checkpoint fork still writes a JSONL child on every backend (W15 moves it).
pinHistoryBackend('old');

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

function sessionClientFor(config: Config) {
  return {
    getAgentClient: () => createUiSessionOwner(config).agentClient,
    workspaceDirectories: () => [root],
  };
}

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
  });
  const result = await createOrResumeRecording(
    config,
    PROJECT_HASH,
    chatsDir,
    sessionClientFor(config),
  );
  try {
    if (!(result.resumedBoot instanceof ResumeCursorBoot))
      throw new Error('Missing checkpoint boot');
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
  });

  await expect(
    createOrResumeRecording(
      config,
      PROJECT_HASH,
      chatsDir,
      sessionClientFor(config),
    ),
  ).rejects.toThrow(/Ambiguous continue target name/);
}
