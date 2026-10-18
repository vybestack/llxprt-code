/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { ResumeCursorBoot } from '@vybestack/llxprt-code-core';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { mutateChatHistory } from '../ui/commands/chatHistoryMutation.js';
import type { RecordingSwapCallbacks } from './performResume.js';
import { restoreResumeBoot } from './restoreResumeBoot.js';

/**
 * Compile-time contract (#854 W12): the CLI's resume and history-mutation
 * entry points take the session surface, so the journal recorder is a valid
 * argument. Never called; `tsc` is the assertion.
 */
export function entryPointsAcceptTheJournalRecorder(
  journal: JournalRecordingService,
  client: Parameters<typeof restoreResumeBoot>[0],
  boot: ResumeCursorBoot,
  mutationClient: Parameters<typeof mutateChatHistory>[0],
  ui: Parameters<typeof mutateChatHistory>[1],
  signal: AbortSignal,
): readonly unknown[] {
  return [
    restoreResumeBoot(client, journal, boot, () => undefined),
    mutateChatHistory(mutationClient, ui, null, signal, journal),
  ];
}

describe('CLI recorder consumers take the session surface', () => {
  it('a resume swap callback set holds a journal recorder as the current recording', async () => {
    const journal = JournalRecordingService.create({
      sessionId: 'session-port-0003',
      projectHash: 'project',
      chatsDir: 'unused',
      workspaceDirs: [],
      provider: 'anthropic',
      model: 'model-1',
    });
    let current: ReturnType<RecordingSwapCallbacks['getCurrentRecording']> =
      null;
    const callbacks: Pick<
      RecordingSwapCallbacks,
      'getCurrentRecording' | 'setRecording'
    > = {
      getCurrentRecording: () => current,
      setRecording: (recording) => {
        current = recording;
      },
    };
    callbacks.setRecording(journal, null, null, null);
    expect(callbacks.getCurrentRecording()).toBe(journal);
    await journal.dispose();
  });
});
