import { forbidHistoryMaterializationForTest } from '../../test-utils/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';

class CursorOnlyHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(this, 'eager curation');
  }
}

describe('provider history stream facade', () => {
  it('has no synchronous provider-array facade', () => {
    expect('getCuratedForProvider' in HistoryService.prototype).toBe(false);
  });

  it('opens an asynchronous override only on first demand and closes it before emitting normalized rows', async () => {
    const history = new CursorOnlyHistory();
    const events: string[] = [];
    async function* input(): AsyncGenerator<IContent, void, unknown> {
      events.push('open');
      try {
        yield { speaker: 'human', blocks: [{ type: 'text', text: 'first' }] };
        events.push('second');
        yield { speaker: 'human', blocks: [{ type: 'text', text: 'second' }] };
      } finally {
        events.push('close');
      }
    }
    const rows = history.getCuratedForProviderStream([], undefined, input());
    try {
      expect(events).toStrictEqual([]);
      const first = await rows.next();
      expect(events).toStrictEqual(['open', 'second', 'close']);
      expect(first.value?.blocks).toStrictEqual([
        { type: 'text', text: 'first' },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect((await rows.next()).value?.blocks).toStrictEqual([
        { type: 'text', text: 'second' },
      ]);
      expect((await rows.next()).done).toBe(true);
    } finally {
      await rows.return();
      history.dispose();
    }
  });

  it('propagates an asynchronous override fault without publishing a partial row', async () => {
    const history = new CursorOnlyHistory();
    let closed = false;
    const failure = new Error('override failed');
    async function* input(): AsyncGenerator<IContent, void, unknown> {
      try {
        yield { speaker: 'human', blocks: [{ type: 'text', text: 'partial' }] };
        throw failure;
      } finally {
        closed = true;
      }
    }
    const rows = history.getCuratedForProviderStream([], undefined, input());
    try {
      await expect(rows.next()).rejects.toBe(failure);
      expect(closed).toBe(true);
      expect((await rows.next()).done).toBe(true);
    } finally {
      await rows.return();
      history.dispose();
    }
  });
});

describe('request boundary validation', () => {
  it('rejects conflicting purge identities before producing any request row', async () => {
    const history = new CursorOnlyHistory();
    const input: IContent[] = [{}, {}].map((boundaryId) => ({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'boundary' }],
      metadata: { semanticMediaPurgeBoundary: { boundaryId, blockIndex: 0 } },
    }));
    const rows = history.getCuratedForProviderStream([], undefined, input);
    try {
      await expect(rows.next()).rejects.toThrow(
        'conflicting semantic purge boundaries',
      );
      expect((await rows.next()).done).toBe(true);
    } finally {
      await rows.return();
      history.dispose();
    }
  });
});
