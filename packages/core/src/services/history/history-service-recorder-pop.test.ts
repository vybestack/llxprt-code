/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RecordingIntegration } from '../../recording/RecordingIntegration.js';
import { resumeSession } from '../../recording/resumeSession.js';
import { HistoryService } from './HistoryService.js';
import {
  mutationText,
  persistedMutationRows,
  useServiceRecorderMutations,
} from './__tests__/support/service-recorder-mutations.js';
import { historyOriginId } from './historyOriginId.js';

describe('recorded HistoryService repeat-sequence pop', () => {
  const fixture = useServiceRecorderMutations();

  it('self-merges A B then durably pops only the final B and A across real resume', async () => {
    const history = fixture.history();
    const { recording, integration, origin } = await fixture.recorder('pop');
    await integration.subscribeToJournal(history, origin);
    await history.addBatch([mutationText('A')], undefined, { origin });
    await history.addBatch([mutationText('B')]);
    await integration.flushAtTurnBoundary();
    const initial = await persistedMutationRows(recording);
    expect(initial.map(({ origin: owner }) => owner)).toStrictEqual([
      historyOriginId(origin),
      undefined,
    ]);
    expect(initial.map(({ content }) => content.blocks)).toStrictEqual([
      mutationText('A').blocks,
      mutationText('B').blocks,
    ]);
    expect(
      initial.map(({ content }) => content.metadata?.chronology?.seq),
    ).toStrictEqual([1, 2]);

    const publishedRows: number[] = [];
    history.on('contentBatchAdded', (batch) =>
      publishedRows.push(batch.length),
    );
    await history.merge(history);
    await integration.flushAtTurnBoundary();
    expect(publishedRows).toStrictEqual([2]);
    const merged = [...initial, ...initial];
    expect(await persistedMutationRows(recording)).toStrictEqual(merged);
    expect(await Array.fromAsync(history.streamRawHistory())).toStrictEqual(
      merged.map(({ content }) => content),
    );

    expect(await history.pop()).toStrictEqual(initial[1].content);
    await integration.flushAtTurnBoundary();
    const afterFirstPop = [initial[0], initial[1], initial[0]];
    expect(await persistedMutationRows(recording)).toStrictEqual(afterFirstPop);
    expect(await Array.fromAsync(history.streamRawHistory())).toStrictEqual(
      afterFirstPop.map(({ content }) => content),
    );
    await integration.dispose();
    await history.dispose();
    await recording.dispose();

    const resumed = await resumeSession({
      continueRef: recording.getSessionId(),
      projectHash: recording.getProjectHash(),
      chatsDir: recording.getChatsDir(),
      currentProvider: 'anthropic',
      currentModel: 'model-1',
      workspaceDirs: ['/work'],
    });
    if (!resumed.ok) throw new Error(resumed.error);
    const restored = new HistoryService({});
    const resumedIntegration = new RecordingIntegration(resumed.recording);
    try {
      await restored.adoptResumeBoot(resumed.recording, resumed.boot);
      await resumedIntegration.subscribeToJournal(restored, origin);
      expect(await Array.fromAsync(restored.streamRawHistory())).toStrictEqual(
        afterFirstPop.map(({ content }) => content),
      );
      expect(await persistedMutationRows(resumed.recording)).toStrictEqual(
        afterFirstPop,
      );
      expect(await restored.pop()).toStrictEqual(initial[0].content);
      await resumedIntegration.flushAtTurnBoundary();
      expect(await Array.fromAsync(restored.streamRawHistory())).toStrictEqual(
        initial.map(({ content }) => content),
      );
      expect(await persistedMutationRows(resumed.recording)).toStrictEqual(
        initial,
      );
    } finally {
      await resumedIntegration.dispose();
      await restored.dispose();
      await resumed.recording.dispose();
    }
  });
});
