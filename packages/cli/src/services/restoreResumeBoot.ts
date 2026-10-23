/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  ResumeCursorBoot,
  type AgentClientContract,
  type ResumeBootHandle,
  type SessionRecordingPort,
  type HistoryService,
  type IContent,
} from '@vybestack/llxprt-code-core';

type ResumeSourceClient = Pick<
  AgentClientContract,
  'getHistoryService' | 'hasChatInitialized' | 'storeHistoryForLaterUse'
>;

export async function restoreResumeBoot(
  client: ResumeSourceClient,
  recording: SessionRecordingPort,
  boot: ResumeBootHandle,
  publish: () => void,
): Promise<void> {
  const history = await admitResumeHistorySource(client, boot);
  await history.adoptResumeBoot(recording, boot, publish);
}

export async function admitResumeHistorySource(
  client: ResumeSourceClient,
  boot: ResumeBootHandle,
): Promise<HistoryService> {
  if (!client.hasChatInitialized()) {
    // A journal resume adopts the recorder's file as the history, so the rows
    // are not copied into the deferred history first; the client only needs a
    // history to adopt into.
    if (boot instanceof ResumeCursorBoot)
      await client.storeHistoryForLaterUse(boot.streamRows(), {
        counters: boot.counters,
        ownership: boot.ownership,
      });
    else await client.storeHistoryForLaterUse(emptyHistory());
  }
  const history = client.getHistoryService();
  if (history === null)
    throw new Error('History service unavailable after resume initialization');
  return history;
}

async function* emptyHistory(): AsyncGenerator<IContent, void, unknown> {
  yield* [];
}
