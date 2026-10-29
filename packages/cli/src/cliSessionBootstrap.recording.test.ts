/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { recordRowsForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';

import { collectResumeRows } from './__tests__/resumeRows.js';

import {
  Config,
  createSessionRecorder,
  type SessionRecordingServiceConfig,
} from '@vybestack/llxprt-code-core';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getProjectHash } from '@vybestack/llxprt-code-core';
import { fromConfig } from '@vybestack/llxprt-code-agents';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { useFakeResponsesReplay } from '../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
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
    provider: 'fake',
    model: 'fake-model',
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
let root: string;

let chatsDir: string;

async function bootstrapRecording(config: Config) {
  const agent = await fromConfig(
    config,
    new SettingsService(),
    { activation: { provider: 'fake', model: 'fake-model' } },
    new CredentialAuthority(),
  );
  const session = agent.session;
  try {
    const warnings: string[] = [];
    const result = await setupOwnerSessionRecording(
      config,
      session,
      session.listBrowserTargetsDetailed,
      { listSessions: false, deleteSession: undefined },
      null,
      warnings,
    );
    return { ...result, session, warnings, dispose: () => agent.dispose() };
  } catch (error) {
    await agent.dispose();
    throw error;
  }
}

describe('recording bootstrap checkpoint resolution', () => {
  useFakeResponsesReplay('multi-turn-text.jsonl');
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'recording-bootstrap-'));
    chatsDir = join(root, 'chats');
    projectHash = getProjectHash(root);
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
  const source = createSessionRecorder(recordingConfig(chatsDir, 'parent'));
  await recordRowsForTest(source, [
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'prefix' }],
    },
  ]);
  await source.createCheckpoint('startup-cut');
  await recordRowsForTest(source, [
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'excluded' }],
    },
  ]);
  await source.dispose();
  const config = new RecordingConfig(root, {
    cwd: root,
    targetDir: root,
    debugMode: false,
    question: undefined,
    userMemory: '',
    sessionId: 'fresh',
    model: 'fake-model',
    provider: 'fake',
    continueSession: 'startup-cut',
  });
  const result = await bootstrapRecording(config);
  try {
    expect(result.warnings).toStrictEqual([]);
    if (result.resumedBoot === null) throw new Error('Missing checkpoint boot');
    expect(result.session.getRecording().enabled).toBe(true);
    expect(result.session.getSessionId()).not.toBe('parent');
    expect(
      (await collectResumeRows(result.resumedBoot.streamRows())).map(
        (row) => row.blocks,
      ),
    ).toStrictEqual([[{ type: 'text', text: 'prefix' }]]);
    const childPath = result.session.getRecording().path;
    if (childPath === undefined) throw new Error('Missing child path');
    expect(childPath.endsWith('.llxj')).toBe(true);
  } finally {
    await result.dispose();
  }
  const retired = await bootstrapRecording(config);
  if (retired.resumedBoot === null) throw new Error('Missing retired boot');
  await retired.dispose();
  await expect(
    collectResumeRows(retired.resumedBoot.streamRows()),
  ).rejects.toThrow('disposed');
}

async function verifyReportsAnAmbiguousCheckpointReferenceInsteadOfStartingAFreshSession(): Promise<void> {
  for (const sessionId of ['source-one', 'source-two']) {
    const recording = createSessionRecorder(
      recordingConfig(chatsDir, sessionId),
    );
    try {
      await recordRowsForTest(recording, [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: sessionId }],
        },
      ]);
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
    model: 'fake-model',
    provider: 'fake',
    continueSession: 'duplicate-name',
  });

  await expect(bootstrapRecording(config)).rejects.toThrow(
    /Ambiguous continue target name/,
  );
}
