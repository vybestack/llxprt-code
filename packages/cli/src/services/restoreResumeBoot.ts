/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type {
  ResumeCursorBoot,
  SessionRecordingService,
  HistoryService,
} from '@vybestack/llxprt-code-core';

type ResumeSourceClient = Pick<
  AgentClientContract,
  'getHistoryService' | 'hasChatInitialized' | 'storeHistoryForLaterUse'
>;

export async function restoreResumeBoot(
  client: ResumeSourceClient,
  recording: SessionRecordingService,
  boot: ResumeCursorBoot,
  publish: () => void,
): Promise<void> {
  const history = await admitResumeHistorySource(client, boot);
  await history.adoptResumeBoot(recording, boot, publish);
}

export async function admitResumeHistorySource(
  client: ResumeSourceClient,
  boot: ResumeCursorBoot,
): Promise<HistoryService> {
  if (!client.hasChatInitialized())
    await client.storeHistoryForLaterUse(boot.streamRows(), {
      counters: boot.counters,
      ownership: boot.ownership,
    });
  const history = client.getHistoryService();
  if (history === null)
    throw new Error('History service unavailable after resume initialization');
  return history;
}
