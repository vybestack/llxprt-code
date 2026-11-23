/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4128: summaries written before compression tagged them (#2768)
 * reach a resumed session only through the `compressed` journal record.
 * Replay recognizes them there, so their scratchpad is never sent again,
 * while ordinary user messages are never treated as summaries.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { replaySession } from './ReplayEngine.js';
import { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';
import {
  assertReplayOk,
  PROJECT_HASH,
  makeContent,
  sessionStartLine,
  contentLine,
  compressedLine,
  writeJsonlFile,
} from './__tests__/replay-test-helpers.js';

const SNAPSHOT =
  '<state_snapshot><overall_goal>Resume #4128</overall_goal></state_snapshot>';
const LEGACY_SUMMARY_TEXT = `<scratchpad>\nI will now review the conversation.\n</scratchpad>\n\n${SNAPSHOT}`;

function textOf(content: IContent | undefined): string {
  return (content?.blocks ?? [])
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('');
}

function providerTexts(history: readonly IContent[]): string[] {
  const service = new HistoryService();
  for (const content of history) {
    service.add(content);
  }
  return service.getCuratedForProvider().map(textOf);
}

/**
 * A `compressed` record whose summary is written verbatim, so a test can
 * store blocks that no valid IContent could hold.
 */
function rawCompressedLine(seq: number, summary: unknown): string {
  return JSON.stringify({
    v: 1,
    seq,
    ts: '2026-02-11T16:00:00.000Z',
    type: 'compressed',
    payload: { summary, itemsCompressed: 2 },
  });
}

describe('replaying summaries recorded before summaries were tagged (issue #4128)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'replay-legacy-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function replayResult(
    lines: string[],
  ): Promise<{ history: IContent[]; warnings: string[] }> {
    const filePath = path.join(tempDir, 'session.jsonl');
    await writeJsonlFile(filePath, lines);
    const result = await replaySession(filePath, PROJECT_HASH);
    assertReplayOk(result);
    return { history: result.history, warnings: result.warnings };
  }

  async function replay(lines: string[]): Promise<IContent[]> {
    return (await replayResult(lines)).history;
  }

  it('sends a compressed-record summary without its scratchpad', async () => {
    const history = await replay([
      sessionStartLine(1),
      contentLine(2, makeContent('first request', 'human')),
      contentLine(3, makeContent('first answer', 'ai')),
      compressedLine(4, makeContent(LEGACY_SUMMARY_TEXT, 'human'), 2),
      contentLine(5, makeContent('next request', 'human')),
    ]);

    expect(providerTexts(history)).toStrictEqual([SNAPSHOT, 'next request']);
  });

  it('keeps a compressed-record entry that is not shaped like a summary unchanged', async () => {
    const firstMessage = makeContent(
      '<scratchpad> tags: what do they do?',
      'human',
    );

    const history = await replay([
      sessionStartLine(1),
      compressedLine(2, firstMessage, 6),
    ]);

    expect(history).toStrictEqual([firstMessage]);
  });

  it('never alters a recorded user message shaped like a summary', async () => {
    const userText =
      '<scratchpad>example notes</scratchpad><state_snapshot>example output</state_snapshot>';

    const history = await replay([
      sessionStartLine(1),
      contentLine(2, makeContent(userText, 'human')),
    ]);

    expect(providerTexts(history)).toStrictEqual([userText]);
  });

  it('tags a valid legacy compressed-record summary as a summary', async () => {
    const history = await replay([
      sessionStartLine(1),
      compressedLine(2, makeContent(LEGACY_SUMMARY_TEXT, 'human'), 2),
    ]);

    expect(history).toHaveLength(1);
    expect(history[0].metadata?.isSummary).toBe(true);
    expect(textOf(history[0])).toBe(LEGACY_SUMMARY_TEXT);
  });

  describe('compressed records whose summary blocks are malformed', () => {
    it('reports a null block as a malformed record and keeps replaying', async () => {
      const { history, warnings } = await replayResult([
        sessionStartLine(1),
        contentLine(2, makeContent('first request', 'human')),
        rawCompressedLine(3, { speaker: 'human', blocks: [null] }),
        contentLine(4, makeContent('next request', 'human')),
      ]);

      expect(warnings).toContain(
        'Line 3: malformed compressed event, skipping',
      );
      expect(history.map(textOf)).toStrictEqual([
        'first request',
        'next request',
      ]);
    });

    it('reports a text block whose text is not a string as a malformed record', async () => {
      const { history, warnings } = await replayResult([
        sessionStartLine(1),
        contentLine(2, makeContent('first request', 'human')),
        rawCompressedLine(3, {
          speaker: 'human',
          blocks: [{ type: 'text', text: 42 }],
        }),
      ]);

      expect(warnings).toContain(
        'Line 3: malformed compressed event, skipping',
      );
      expect(history.map(textOf)).toStrictEqual(['first request']);
    });

    it('reports a block without a string type as a malformed record', async () => {
      const { history, warnings } = await replayResult([
        sessionStartLine(1),
        contentLine(2, makeContent('first request', 'human')),
        rawCompressedLine(3, { speaker: 'human', blocks: [{ text: 'x' }] }),
      ]);

      expect(warnings).toContain(
        'Line 3: malformed compressed event, skipping',
      );
      expect(history.map(textOf)).toStrictEqual(['first request']);
    });

    it('applies a later valid compressed record and tags its legacy summary', async () => {
      const { history, warnings } = await replayResult([
        sessionStartLine(1),
        contentLine(2, makeContent('first request', 'human')),
        rawCompressedLine(3, { speaker: 'human', blocks: [null] }),
        compressedLine(4, makeContent(LEGACY_SUMMARY_TEXT, 'human'), 2),
        contentLine(5, makeContent('next request', 'human')),
      ]);

      expect(warnings).toContain(
        'Line 3: malformed compressed event, skipping',
      );
      expect(history).toHaveLength(2);
      expect(history[0].metadata?.isSummary).toBe(true);
      expect(providerTexts(history)).toStrictEqual([SNAPSHOT, 'next request']);
    });
  });
});
