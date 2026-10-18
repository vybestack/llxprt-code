/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { isJournalFileName } from '@vybestack/llxprt-code-core/recording/sessionFileExtension.js';
import { JournalResolver } from '@vybestack/llxprt-code-core/recording/journalResolver.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { collectJournalFileRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import { EmptySummaryError } from '@vybestack/llxprt-code-core/core/compression/types.js';
import { OneShotStrategy } from '../../compression/OneShotStrategy.js';
import { TopDownTruncationStrategy } from '../../compression/TopDownTruncationStrategy.js';
import { withRecordingLifetimeFixture } from './helpers/recording-owner-lifetime-fixture.js';
import { drain } from './helpers/agentHarness.js';

async function recordingRows(path: string): Promise<IContent[]> {
  if (isJournalFileName(path)) {
    let result: IContent[] = [];
    await collectJournalFileRowsForAssertions(path, (rows) => {
      result = [...rows];
    });
    return result;
  }
  const resolver = await JournalResolver.open(path);
  try {
    const rows: IContent[] = [];
    for await (const entry of resolver.resolve()) rows.push(entry.content);
    return rows;
  } finally {
    await resolver.close();
  }
}

async function replacementRecordingText(
  path: string,
  rows: readonly IContent[],
): Promise<string> {
  return isJournalFileName(path)
    ? JSON.stringify(rows)
    : readFile(path, 'utf8');
}

function recordingPath(state: { readonly path?: string }): string {
  if (!state.path) throw new Error('Missing recording path');
  return state.path;
}

/**
 * Compression publishes through the disk runners, so the summary the provider
 * would write is injected at the strategy's disk entry point.
 */
function useSummaryStrategy(fails = false): () => void {
  let index = 0;
  const spy = spyOn(
    OneShotStrategy.prototype,
    'compressDisk',
  ).mockImplementation(async (_context, candidate) => {
    if (fails) throw new Error('compression rejected');
    candidate.append({
      speaker: 'ai',
      blocks: [{ type: 'text', text: `owned-summary-${++index}` }],
      metadata: { reason: 'compression-state-snapshot' },
    });
    return { kind: 'applied', top: 0 };
  });
  return () => spy.mockRestore();
}

const seed = [
  {
    speaker: 'human' as const,
    blocks: [{ type: 'text' as const, text: 'seed' }],
  },
  {
    speaker: 'ai' as const,
    blocks: [{ type: 'text' as const, text: 'reply' }],
  },
];

describe('shared history compression recording origin', () => {
  it('records A-only and B-only compression summaries in their own journals', async () => {
    const restore = useSummaryStrategy();
    try {
      await withRecordingLifetimeFixture(async ({ agent, borrow }) => {
        const sibling = await borrow();
        await agent.setHistory(seed);
        await agent.session.setRecording({ enabled: true });
        await new Promise((resolve) => setTimeout(resolve, 1100));
        await sibling.session.setRecording({ enabled: true });
        const aPath = recordingPath(agent.session.getRecording());
        const bPath = recordingPath(sibling.session.getRecording());
        expect((await agent.compress()).status).toBe('compressed');
        await agent.setHistory(seed);
        expect((await sibling.compress()).status).toBe('compressed');
        await agent.session.setRecording({ enabled: false });
        await sibling.session.setRecording({ enabled: false });
        const a = await readFile(aPath, 'utf8');
        const b = await readFile(bPath, 'utf8');
        expect(a).toContain('owned-summary-1');
        expect(b).not.toContain('owned-summary-1');
        expect(b).toContain('owned-summary-2');
        expect(a).not.toContain('owned-summary-2');
      });
    } finally {
      restore();
    }
  }, 30000);

  it('keeps unbound external compression summaries broadcast to both subscribers', async () => {
    await withRecordingLifetimeFixture(async ({ agent, borrow }) => {
      const sibling = await borrow();
      await agent.setHistory(seed);
      await agent.session.setRecording({ enabled: true });
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await sibling.session.setRecording({ enabled: true });
      const history = agent.agentClient.getHistoryService();
      if (!history) throw new Error('Missing shared history');
      const summary = {
        speaker: 'ai' as const,
        blocks: [{ type: 'text' as const, text: 'external-summary' }],
        metadata: { reason: 'compression-state-snapshot' as const },
      };
      history.startCompression();
      await history.detachedValues.replace([summary]);
      history.endCompression(summary, 2);
      const aPath = recordingPath(agent.session.getRecording());
      const bPath = recordingPath(sibling.session.getRecording());
      await agent.session.setRecording({ enabled: false });
      await sibling.session.setRecording({ enabled: false });
      expect(await readFile(aPath, 'utf8')).toContain('external-summary');
      expect(await readFile(bPath, 'utf8')).toContain('external-summary');
    });
  }, 30000);

  it('preserves compression ownership across profile adoption and session resume', async () => {
    const restore = useSummaryStrategy();
    try {
      await withRecordingLifetimeFixture(async ({ agent, borrow }) => {
        const sibling = await borrow();
        await agent.setHistory(seed);
        await agent.session.setRecording({ enabled: true });
        await agent.session.nameCurrentSession('compression-origin-A');
        await new Promise((resolve) => setTimeout(resolve, 1100));
        await sibling.session.setRecording({ enabled: true });
        const bPath = recordingPath(sibling.session.getRecording());
        await agent.profiles.applySnapshot({
          version: 1,
          provider: 'fake',
          model: 'fake-model',
          modelParams: {},
          ephemeralSettings: {},
        });
        await agent.setHistory(seed);
        expect((await agent.compress()).status).toBe('compressed');
        expect(await readFile(bPath, 'utf8')).not.toContain('owned-summary-1');
        await agent.session.setRecording({ enabled: false });
        const saved = (await agent.session.listSessions()).find(
          (session) => session.name === 'compression-origin-A',
        );
        if (!saved) throw new Error('Missing recorded session');
        await agent.session.resume(saved.id);
        await agent.setHistory(seed);
        await agent.compress();
        const aPath = recordingPath(agent.session.getRecording());
        await agent.session.setRecording({ enabled: false });
        await sibling.session.setRecording({ enabled: false });
        const a = await readFile(aPath, 'utf8');
        const b = await readFile(bPath, 'utf8');
        expect(a).toContain('owned-summary-1');
        expect(a).toContain('owned-summary-2');
        expect(b).not.toContain('owned-summary-1');
        expect(b).not.toContain('owned-summary-2');
      });
    } finally {
      restore();
    }
  }, 30000);

  it('unlocks after a rejected owner compression without recording a summary', async () => {
    const restore = useSummaryStrategy(true);
    try {
      await withRecordingLifetimeFixture(async ({ agent, borrow }) => {
        const sibling = await borrow();
        await agent.setHistory(seed);
        await agent.session.setRecording({ enabled: true });
        await new Promise((resolve) => setTimeout(resolve, 1100));
        await sibling.session.setRecording({ enabled: true });
        const aPath = recordingPath(agent.session.getRecording());
        const bPath = recordingPath(sibling.session.getRecording());
        await expect(agent.compress()).rejects.toThrow('compression rejected');
        const history = agent.agentClient.getHistoryService();
        if (!history) throw new Error('Missing history');
        history.add({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'external-after-error' }],
        });
        await agent.session.setRecording({ enabled: false });
        await sibling.session.setRecording({ enabled: false });
        expect(await readFile(aPath, 'utf8')).toContain('external-after-error');
        const b = await readFile(bPath, 'utf8');
        expect(b).toContain('external-after-error');
        expect(b).not.toContain('owned-summary');
      });
    } finally {
      restore();
    }
  }, 30000);

  it('keeps a fallback summary with its originating facade after a primary error', async () => {
    const primary = spyOn(
      OneShotStrategy.prototype,
      'compressDisk',
    ).mockRejectedValue(new EmptySummaryError('one-shot'));
    const fallback = spyOn(
      TopDownTruncationStrategy.prototype,
      'compressDisk',
    ).mockImplementation(async (context) => {
      const rows = context.history;
      if (!(rows instanceof HistoryDensityRows))
        throw new Error('Expected disk compression rows');
      const start = rows.length;
      rows.append({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'A-fallback-summary' }],
        metadata: { reason: 'compression-state-snapshot' },
      });
      return {
        kind: 'applied',
        start,
        metadata: {
          originalMessageCount: start,
          compressedMessageCount: 1,
          strategyUsed: 'top-down-truncation',
          llmCallMade: false,
        },
      };
    });
    try {
      await withRecordingLifetimeFixture(async ({ agent, borrow }) => {
        const sibling = await borrow();
        await agent.setHistory(seed);
        await agent.session.setRecording({ enabled: true });
        await new Promise((resolve) => setTimeout(resolve, 1100));
        await sibling.session.setRecording({ enabled: true });
        const aPath = recordingPath(agent.session.getRecording());
        const bPath = recordingPath(sibling.session.getRecording());
        expect((await agent.compress()).status).toBe('compressed');
        await agent.session.setRecording({ enabled: false });
        await sibling.session.setRecording({ enabled: false });
        expect(await readFile(aPath, 'utf8')).toContain('A-fallback-summary');
        expect(await readFile(bPath, 'utf8')).not.toContain(
          'A-fallback-summary',
        );
      });
    } finally {
      fallback.mockRestore();
      primary.mockRestore();
    }
  }, 30000);

  it('retains the committed summary origin after a failed history replacement', async () => {
    const restore = useSummaryStrategy();
    try {
      await withRecordingLifetimeFixture(async ({ agent, borrow }) => {
        const sibling = await borrow();
        await agent.setHistory(seed);
        await agent.session.setRecording({ enabled: true });
        await new Promise((resolve) => setTimeout(resolve, 1100));
        await sibling.session.setRecording({ enabled: true });
        expect((await agent.compress()).status).toBe('compressed');
        const history = agent.agentClient.getHistoryService();
        if (!history) throw new Error('Missing shared history');
        const summary = (await collectRawHistory(history)).find((entry) =>
          entry.blocks.some(
            (block) =>
              block.type === 'text' && block.text === 'owned-summary-1',
          ),
        );
        if (!summary) throw new Error('Missing committed summary');
        const candidate = {
          speaker: 'ai' as const,
          blocks: [{ type: 'text' as const, text: 'rejected-summary' }],
        };
        await expect(
          history.replaceAll([candidate], undefined, {
            origin: agent.session,
            afterPublication: () => {
              throw new Error('reject summary replacement');
            },
          }),
        ).rejects.toThrow('reject summary replacement');
        expect(await collectRawHistory(history)).toContainEqual(summary);
        const aPath = recordingPath(agent.session.getRecording());
        const bPath = recordingPath(sibling.session.getRecording());
        await agent.session.setRecording({ enabled: false });
        await sibling.session.setRecording({ enabled: false });
        const aRows = await recordingRows(aPath);
        const bRows = await recordingRows(bPath);
        expect(aRows).toContainEqual(summary);
        expect(bRows).not.toContainEqual(summary);
        const a = await replacementRecordingText(aPath, aRows);
        const b = await replacementRecordingText(bPath, bRows);
        expect(a).toContain('owned-summary-1');
        expect(b).not.toContain('owned-summary-1');
        expect(a).not.toContain('rejected-summary');
        expect(b).not.toContain('rejected-summary');
      });
    } finally {
      restore();
    }
  }, 30000);

  it('does not seed a late sibling with an owner summary after profile adoption', async () => {
    const restore = useSummaryStrategy();
    try {
      await withRecordingLifetimeFixture(async ({ agent, borrow }) => {
        const sibling = await borrow();
        await agent.setHistory(seed);
        await agent.session.setRecording({ enabled: true });
        expect((await agent.compress()).status).toBe('compressed');
        await agent.profiles.applySnapshot({
          version: 1,
          provider: 'fake',
          model: 'fake-model',
          modelParams: {},
          ephemeralSettings: {},
        });
        await new Promise((resolve) => setTimeout(resolve, 1100));
        await sibling.session.setRecording({ enabled: true });
        await drain(sibling.stream('B-after-profile-origin'));
        const bPath = recordingPath(sibling.session.getRecording());
        const b = await readFile(bPath, 'utf8');
        expect(b).toContain('B-after-profile-origin');
        expect(b).not.toContain('owned-summary-1');
      });
    } finally {
      restore();
    }
  }, 30000);
});
