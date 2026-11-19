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

describe('replaying summaries recorded before summaries were tagged (issue #4128)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'replay-legacy-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function replay(lines: string[]): Promise<IContent[]> {
    const filePath = path.join(tempDir, 'session.jsonl');
    await writeJsonlFile(filePath, lines);
    const result = await replaySession(filePath, PROJECT_HASH);
    assertReplayOk(result);
    return result.history;
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
});
