/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import createDebug from 'debug';
import { sha256KeyHash } from '../journal/idKeys.js';
import { openJournalReadOnly } from '../journal/journalReader.js';
import { stateReaderOf } from '../journal/journalReaderState.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { debugLogger } from '../utils/debugLogger.js';
import {
  nativeText,
  useNativeIntegration,
} from './__tests__/support/native-integration-fixture.js';
import { readSessionFacts } from './sessionMetaKeys.js';

async function rejected(operation: Promise<void>): Promise<unknown> {
  try {
    await operation;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected native lifecycle operation to reject');
}

describe('native recording integration lifecycle', () => {
  const fixture = useNativeIntegration();
  it('joins a rejected first batch and keeps both durable and live histories empty', async () => {
    const { history, integration, texts } = fixture();
    await integration.subscribeToJournal(history);
    const failure = new Error('first batch publication rejected');
    history.on('contentBatchAdded', () => {
      throw failure;
    });
    const publication = rejected(
      history.addBatch([
        nativeText('unpublished first'),
        nativeText('unpublished second', 'ai'),
      ]),
    );
    const disposal = integration.dispose();
    expect(await publication).toBe(failure);
    await disposal;
    expect(await texts()).toStrictEqual([]);
    expect(history.getStatistics().totalMessages).toBe(0);
  });

  it('routes operational severity and message through the debug output', () => {
    const { integration } = fixture();
    const previousNamespaces = createDebug.disable();
    const output: string[] = [];
    const consoleOutput = spyOn(console, 'log').mockImplementation(
      (...args: unknown[]) => {
        output.push(args.map(String).join(' '));
      },
    );
    debugLogger.configManager.setEphemeralConfig({
      enabled: true,
      namespaces: ['llxprt:*'],
      output: { target: 'stderr' },
    });
    createDebug.enable('llxprt:*');
    try {
      for (const severity of ['info', 'warning', 'error'] as const)
        integration.recordSessionEvent(severity, `disk ${severity}`);
      expect(
        output.map((line) => line.slice(line.indexOf('[SessionRecording]'))),
      ).toStrictEqual([
        '[SessionRecording] info: disk info',
        '[SessionRecording] warning: disk warning',
        '[SessionRecording] error: disk error',
      ]);
    } finally {
      consoleOutput.mockRestore();
      createDebug.enable(previousNamespaces);
      debugLogger.configManager.clearEphemeralConfig();
    }
  });

  for (const offset of [0, 1]) {
    it(`joins a batch held at native ${offset === 0 ? 'records' : 'trailer'} write before disposing`, async () => {
      const { history, integration, failures, seams, texts } = fixture();
      await integration.subscribeToJournal(history);
      history.add(nativeText('baseline'));
      await integration.flushAtTurnBoundary();
      const gateAt =
        seams.events.filter((event) => event.type === 'write').length + offset;
      failures.gateWriteAt = gateAt;
      const publication = history.addBatch([
        nativeText('first'),
        nativeText('second', 'ai'),
      ]);
      let disposed = false;
      const disposal = integration.dispose().then(() => {
        disposed = true;
      });
      try {
        while (
          seams.events.filter((event) => event.type === 'write').length <=
          gateAt
        )
          await new Promise<void>((resolve) => setImmediate(resolve));
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(disposed).toBe(false);
        expect(await texts()).toStrictEqual(['baseline']);
      } finally {
        seams.release();
      }
      await publication;
      await disposal;
      expect(await texts()).toStrictEqual(['baseline', 'first', 'second']);
    });
  }

  for (const kind of ['write', 'flush'] as const) {
    it(`reports an unobserved mirror ${kind} failure on disposal while detaching later rows`, async () => {
      const { history, integration, failures, seams, texts } = fixture();
      history.add(nativeText('durable baseline'));
      await history.waitForCommit();
      await integration.subscribeToJournal(history);
      await integration.flushAtTurnBoundary();
      const count = seams.events.filter((event) => event.type === kind).length;
      if (kind === 'write') failures.failWriteAt = count;
      else failures.failFlushAt = count;
      history.add(nativeText('rejected mirror row'));

      const failure = await rejected(integration.dispose());
      expect(failure).toBeInstanceOf(Error);
      expect(failure).toHaveProperty('message', `injected ${kind} failure`);
      await expect(integration.dispose()).resolves.toBeUndefined();
      history.add(nativeText('after disposal'));
      await history.waitForCommit();
      expect(await texts()).toStrictEqual(['durable baseline']);
      expect(history.getStatistics().totalMessages).toBe(3);
    });
  }

  it('persists provider and directory switches made before and after materialization', async () => {
    const { history, integration, recording, texts } = fixture();
    await integration.subscribeToJournal(history);
    integration.recordProviderSwitch('openai', 'before-model');
    integration.recordDirectoriesChanged(['/before']);
    await integration.flushAtTurnBoundary();
    expect(recording.getFilePath()).toBeNull();
    history.add(nativeText('materialize'));
    await integration.flushAtTurnBoundary();
    const file = recording.getFilePath();
    if (file === null) throw new Error('Expected materialized recorder');
    const before = await openJournalReadOnly(file);
    try {
      expect(
        await readSessionFacts(stateReaderOf(before, sha256KeyHash)),
      ).toMatchObject({
        provider: 'openai',
        model: 'before-model',
        directories: ['/before'],
      });
    } finally {
      await before.close();
    }
    integration.recordProviderSwitch('anthropic', 'after-model');
    integration.recordDirectoriesChanged(['/after', '/second']);
    await integration.flushAtTurnBoundary();
    const after = await openJournalReadOnly(file);
    try {
      expect(
        await readSessionFacts(stateReaderOf(after, sha256KeyHash)),
      ).toMatchObject({
        provider: 'anthropic',
        model: 'after-model',
        directories: ['/after', '/second'],
      });
    } finally {
      await after.close();
    }
    expect(await texts()).toStrictEqual(['materialize']);
  });

  it('keeps operational events out of the native session journal', async () => {
    const { history, integration, recording, texts } = fixture();
    await integration.subscribeToJournal(history);
    integration.recordSessionEvent('warning', 'before materialization');
    await integration.flushAtTurnBoundary();
    expect(recording.getFilePath()).toBeNull();
    history.add(nativeText('only history row'));
    await integration.flushAtTurnBoundary();
    const file = recording.getFilePath();
    if (file === null) throw new Error('Expected materialized recorder');
    const before = await openJournalReadOnly(file);
    const trailer = before.trailer;
    await before.close();
    for (const severity of ['info', 'warning', 'error'] as const)
      integration.recordSessionEvent(
        severity,
        `${severity} after materialization`,
      );
    await integration.flushAtTurnBoundary();
    const after = await openJournalReadOnly(file);
    try {
      expect(after.trailer).toStrictEqual(trailer);
    } finally {
      await after.close();
    }
    expect(await texts()).toStrictEqual(['only history row']);
  });

  it('keeps an idle attached recorder unmaterialized', async () => {
    const { history, integration, recording } = fixture();
    await integration.subscribeToJournal(history);
    await integration.flushAtTurnBoundary();
    await integration.dispose();
    expect(recording.getFilePath()).toBeNull();
  });

  it('persists a complete batch before disposing and permits independent history reads afterwards', async () => {
    const { history, integration, texts } = fixture();
    await integration.subscribeToJournal(history);
    await history.addBatch([nativeText('first'), nativeText('second', 'ai')]);
    await integration.dispose();
    expect(await texts()).toStrictEqual(['first', 'second']);
    const reader = history.streamRawHistory();
    try {
      expect((await reader.next()).value?.blocks).toStrictEqual(
        nativeText('first').blocks,
      );
      expect((await reader.next()).value?.blocks).toStrictEqual(
        nativeText('second', 'ai').blocks,
      );
      expect((await reader.next()).done).toBe(true);
    } finally {
      await reader.return();
    }
  });

  it('does not close an active history reader when detaching and closing the recorder', async () => {
    const { history, integration, recording } = fixture();
    await integration.subscribeToJournal(history);
    await history.addBatch([nativeText('first'), nativeText('second', 'ai')]);
    await integration.flushAtTurnBoundary();
    const reader = history.streamRawHistory();
    try {
      expect((await reader.next()).value?.blocks).toStrictEqual(
        nativeText('first').blocks,
      );
      await integration.dispose();
      await recording.dispose();
      expect((await reader.next()).value?.blocks).toStrictEqual(
        nativeText('second', 'ai').blocks,
      );
      expect((await reader.next()).done).toBe(true);
    } finally {
      await reader.return();
    }
    history.add(nativeText('continued'));
    await history.waitForCommit();
    expect(history.getStatistics().totalMessages).toBe(3);
  });

  it('ignores metadata after disposal while preserving the recorded session facts', async () => {
    const { history, integration, recording } = fixture();
    await integration.subscribeToJournal(history);
    history.add(nativeText('before disposal'));
    await integration.flushAtTurnBoundary();
    await integration.dispose();
    integration.recordProviderSwitch('late-provider', 'late-model');
    integration.recordDirectoriesChanged(['/late']);
    integration.recordSessionEvent('error', 'late event');
    await recording.flush();
    const file = recording.getFilePath();
    if (file === null) throw new Error('Expected materialized recorder');
    const reader = await openJournalReadOnly(file);
    try {
      expect(
        await readSessionFacts(stateReaderOf(reader, sha256KeyHash)),
      ).toMatchObject({
        provider: 'anthropic',
        model: 'model-1',
        directories: ['/workspace/project-a'],
      });
    } finally {
      await reader.close();
    }
  });

  it('reuses the same subscription without replacing or duplicating its rows', async () => {
    const { history, integration, texts } = fixture();
    await integration.subscribeToJournal(history);
    history.add(nativeText('before repeated subscribe'));
    await integration.subscribeToJournal(history);
    history.add(nativeText('after repeated subscribe'));
    await integration.flushAtTurnBoundary();
    expect(await texts()).toStrictEqual([
      'before repeated subscribe',
      'after repeated subscribe',
    ]);
  });

  it('refuses a replacement subscription after a failed detach without binding the new history', async () => {
    const { history, integration, failures, seams, histories, texts } =
      fixture();
    history.add(nativeText('baseline'));
    await history.waitForCommit();
    await integration.subscribeToJournal(history);
    await integration.flushAtTurnBoundary();
    failures.failWriteAt = seams.events.filter(
      (event) => event.type === 'write',
    ).length;
    history.add(nativeText('failed mirror'));
    const replacement = new HistoryService({});
    histories.push(replacement);
    const failure = await rejected(integration.subscribeToJournal(replacement));
    expect(failure).toHaveProperty('message', 'injected write failure');
    await expect(integration.dispose()).rejects.toBe(failure);
    replacement.add(nativeText('not attached'));
    history.add(nativeText('detached original'));
    await replacement.waitForCommit();
    await history.waitForCommit();
    expect(await texts()).toStrictEqual(['baseline']);
  });
});
