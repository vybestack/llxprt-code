/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  JournalResumeBoot,
  resumeJournalSession,
} from '@vybestack/llxprt-code-core/recording/journalResume.js';
import {
  SessionLockManager,
  SessionLockedError,
} from '@vybestack/llxprt-code-core/recording/SessionLockManager.js';
import {
  diskToolState,
  projectHash,
  recordingConfig,
  recordingFile,
  type DiskToolRow,
} from './service-tool-recorders.js';
import {
  localProvider,
  requestFacts,
  serviceToolChat,
  toolId,
  toolResult,
  providerName,
  modelName,
  type RequestFacts,
} from './service-tool-runtime.js';

export async function proveToolResume(
  directory: string,
  name: string,
  expected: readonly DiskToolRow[],
): Promise<void> {
  const config = recordingConfig(directory, name);
  const result = await resumeJournalSession({
    continueRef: name,
    projectHash,
    chatsDir: config.chatsDir,
    currentProvider: providerName,
    currentModel: modelName,
    workspaceDirs: ['/work'],
  });
  if (!result.ok) throw new Error(result.error);
  const history = new HistoryService({ backend: 'journal' });
  let captured: RequestFacts | undefined;
  const provider = localProvider((options) =>
    (async function* () {
      captured = await requestFacts(options.contents);
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'resumed safely' }],
      };
    })(),
  );
  const setup = serviceToolChat(history, provider, name, directory);
  try {
    expect(result.recording.getSessionId()).toBe(name);
    expect(result.resumePoint.rows).toBe(3);
    expect(result.recording.ownsLockFor(name)).toBe(true);
    expect(await result.lockHandle.ownsLock()).toBe(true);
    await expect(
      SessionLockManager.acquire(config.chatsDir, name),
    ).rejects.toBeInstanceOf(SessionLockedError);
    expect(
      (await diskToolState(recordingFile(result.recording))).rows,
    ).toStrictEqual([...expected]);
    await history.adoptResumeBoot(
      result.recording,
      new JournalResumeBoot(result.recording, result.resumePoint),
    );
    let position = 0;
    for await (const row of history.streamRawHistory())
      expect(row).toStrictEqual(expected[position++].content);
    expect(position).toBe(3);
    await setup.chat.sendMessage({ message: 'Resume after crash.' }, 'resume');
    expect(captured).toMatchObject({
      calls: 1,
      results: 1,
      ids: [toolId, toolId],
      result: toolResult,
    });
    expect(captured?.texts).not.toContain(
      'subsequent response must not survive crash',
    );
  } finally {
    await history.dispose();
    await result.recording.dispose();
    await setup.close();
  }
  expect(await SessionLockManager.isLocked(config.chatsDir, name)).toBe(false);
}
