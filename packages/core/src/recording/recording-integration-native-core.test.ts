/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';
import {
  nativeText,
  useNativeIntegration,
} from './__tests__/support/native-integration-fixture.js';

function toolCall(name: string): IContent {
  return {
    speaker: 'ai',
    blocks: [
      { type: 'text', text: `calling ${name}` },
      { type: 'tool_call', id: `call_${name}`, name, parameters: { x: 1 } },
    ],
  };
}

function toolResponse(name: string): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: `call_${name}`,
        toolName: name,
        result: { ok: true },
      },
    ],
  };
}

describe('native recording integration core contracts', () => {
  const fixture = useNativeIntegration();

  it('records a single service addition exactly once', async () => {
    const { history, integration, texts } = fixture();
    await integration.subscribeToJournal(history);
    history.add(nativeText('hello one'));
    await integration.flushAtTurnBoundary();
    expect(await texts()).toStrictEqual(['hello one']);
  });

  it('keeps notifications observable without recording them again', async () => {
    const { history, integration, texts } = fixture();
    await integration.subscribeToJournal(history);
    const notifications: IContent[] = [];
    history.on('contentAdded', (row) => notifications.push(row));
    history.add(nativeText('one mutation'));
    await integration.flushAtTurnBoundary();
    history.emit('contentAdded', nativeText('notification only'));
    history.emit('compressionStarted');
    history.emit(
      'compressionEnded',
      nativeText('notification summary', 'ai'),
      1,
    );
    history.emit('compressionLockReleased');
    await integration.flushAtTurnBoundary();
    expect(notifications).toHaveLength(2);
    expect(await texts()).toStrictEqual(['one mutation']);
  });

  it('does not record notifications preceding attachment', async () => {
    const { history, integration, texts } = fixture();
    history.emit('contentAdded', nativeText('before-subscribe'));
    await integration.subscribeToJournal(history);
    history.add(nativeText('after-subscribe'));
    await integration.flushAtTurnBoundary();
    expect(await texts()).toStrictEqual(['after-subscribe']);
  });

  it('records service additions in FIFO order', async () => {
    const { history, integration, texts } = fixture();
    await integration.subscribeToJournal(history);
    for (const text of ['a', 'b', 'c']) history.add(nativeText(text));
    await integration.flushAtTurnBoundary();
    expect(await texts()).toStrictEqual(['a', 'b', 'c']);
  });

  for (const [name, makeRow] of [
    ['tool call', (): IContent => toolCall('search')],
    ['tool response', (): IContent => toolResponse('search')],
  ] as const) {
    it(`preserves complete ${name} blocks on disk`, async () => {
      const { history, integration, recorded } = fixture();
      await integration.subscribeToJournal(history);
      history.add(makeRow());
      await integration.flushAtTurnBoundary();
      expect(await recorded()).toStrictEqual([makeRow()]);
    });
  }

  it('stops recording after unsubscribe without losing the admitted row', async () => {
    const { history, integration, texts } = fixture();
    await integration.subscribeToJournal(history);
    history.add(nativeText('before-unsubscribe'));
    integration.unsubscribeFromHistory();
    history.add(nativeText('after-unsubscribe'));
    await integration.flushAtTurnBoundary();
    await history.waitForCommit();
    expect(await texts()).toStrictEqual(['before-unsubscribe']);
  });

  it('re-subscribes to the same history without duplicating later rows', async () => {
    const { history, integration, texts } = fixture();
    await integration.subscribeToJournal(history);
    integration.unsubscribeFromHistory();
    await integration.subscribeToJournal(history);
    history.add(nativeText('rebound'));
    await integration.flushAtTurnBoundary();
    expect(await texts()).toStrictEqual(['rebound']);
  });

  it('ignores rebuild notifications while persisting the compression result', async () => {
    const { history, integration, texts } = fixture();
    await integration.subscribeToJournal(history);
    history.add(nativeText('baseline-materialize'));
    history.startCompression();
    history.emit('contentAdded', nativeText('re-added item'));
    await history.replaceAll([nativeText('compression summary', 'ai')]);
    history.endCompression(nativeText('compression summary', 'ai'), 42);
    await integration.flushAtTurnBoundary();
    expect(await texts()).toStrictEqual(['compression summary']);
  });

  it('persists the summary replacing all seven original rows', async () => {
    const { history, integration, texts } = fixture();
    await integration.subscribeToJournal(history);
    for (let index = 0; index < 7; index++)
      history.add(nativeText(`baseline-${index}`));
    history.startCompression();
    await history.replaceAll([nativeText('summary', 'ai')]);
    history.endCompression(nativeText('summary', 'ai'), 7);
    await integration.flushAtTurnBoundary();
    expect(await texts()).toStrictEqual(['summary']);
    expect(history.getContextRange().totalEntries).toBe(1);
  });

  it('records post-compression content after the summary', async () => {
    const { history, integration, texts } = fixture();
    await integration.subscribeToJournal(history);
    history.add(nativeText('baseline-materialize'));
    history.startCompression();
    await history.replaceAll([nativeText('summary', 'ai')]);
    history.endCompression(nativeText('summary', 'ai'), 3);
    history.add(nativeText('new-content-after-compression'));
    await integration.flushAtTurnBoundary();
    expect(await texts()).toStrictEqual([
      'summary',
      'new-content-after-compression',
    ]);
  });

  for (const removed of [undefined, 5]) {
    it(`records content after a no-summary compression ending with ${removed}`, async () => {
      const { history, integration, texts } = fixture();
      await integration.subscribeToJournal(history);
      history.add(nativeText('before'));
      history.startCompression();
      history.endCompression(undefined, removed);
      history.add(nativeText('after'));
      await integration.flushAtTurnBoundary();
      expect(await texts()).toStrictEqual(['before', 'after']);
    });
  }

  it('records after sequential no-op compression cycles', async () => {
    const { history, integration, texts } = fixture();
    await integration.subscribeToJournal(history);
    for (const text of ['after-first-noop', 'after-second-noop']) {
      history.startCompression();
      history.endCompression();
      history.add(nativeText(text));
    }
    await integration.flushAtTurnBoundary();
    expect(await texts()).toStrictEqual([
      'after-first-noop',
      'after-second-noop',
    ]);
  });

  it('keeps queued compression-window content between summary and later content', async () => {
    const { history, integration, texts } = fixture();
    await integration.subscribeToJournal(history);
    history.add(nativeText('before'));
    history.startCompression();
    history.add(nativeText('during'));
    await history.replaceAll([nativeText('summary', 'ai')]);
    history.endCompression(nativeText('summary', 'ai'), 3);
    history.add(nativeText('after'));
    await integration.flushAtTurnBoundary();
    expect(await texts()).toStrictEqual(['summary', 'during', 'after']);
  });

  it('persists the last summary of sequential replacement cycles without duplicates', async () => {
    const { history, integration, texts } = fixture();
    await integration.subscribeToJournal(history);
    history.add(nativeText('baseline-materialize'));
    for (const [text, count] of [
      ['summary-1', 10],
      ['summary-2', 12],
    ] as const) {
      history.startCompression();
      await history.replaceAll([nativeText(text, 'ai')]);
      history.endCompression(nativeText(text, 'ai'), count);
    }
    await integration.flushAtTurnBoundary();
    expect(await texts()).toStrictEqual(['summary-2']);
  });

  for (const late of [false, true]) {
    it(`recovers a complete tool entry added ${late ? 'after' : 'before'} the compression rebuild`, async () => {
      const { history, integration, recorded } = fixture();
      await integration.subscribeToJournal(history);
      history.add(nativeText('original question'));
      const entry = toolCall(late ? 'late' : 'mid');
      history.startCompression();
      if (!late) history.add(entry);
      await history.replaceAll([nativeText('summary', 'ai')]);
      if (late) history.add(entry);
      history.endCompression(nativeText('summary', 'ai'), 1);
      await integration.flushAtTurnBoundary();
      expect(await recorded()).toStrictEqual([
        nativeText('summary', 'ai'),
        toolCall(late ? 'late' : 'mid'),
      ]);
    });
  }

  it('switches history subscriptions and ignores the old instance', async () => {
    const { history, integration, histories, texts } = fixture();
    const replacement = new HistoryService({ backend: 'journal' });
    histories.push(replacement);
    await integration.subscribeToJournal(history);
    await integration.subscribeToJournal(replacement);
    history.add(nativeText('old service'));
    replacement.add(nativeText('new service'));
    await integration.flushAtTurnBoundary();
    expect(await texts()).toStrictEqual(['new service']);
  });
});
