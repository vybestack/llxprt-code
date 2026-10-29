/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { journalFileRows } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';

/**
 * A compression summary carries the origin that produced it. Recording
 * subscribers bound to an owner record summaries from their own origin and
 * from no origin at all, and skip summaries tagged with another owner.
 *
 * Real HistoryService, real RecordingIntegration and JournalRecordingService
 * writing native journals into temp directories. Assertions are on the recorded files.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { JournalRecordingService } from './journalRecordingService.js';

interface OwnedRecording {
  readonly owner: object;
  readonly service: JournalRecordingService;
  readonly integration: RecordingIntegration;
}

function textContent(
  text: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

async function openOwnedRecording(
  tempDir: string,
  name: string,
  history: HistoryService,
): Promise<OwnedRecording> {
  const chatsDir = path.join(tempDir, name);
  const service = JournalRecordingService.create({
    sessionId: `compression-origin-${name}-0001`,
    projectHash: 'project-hash-compression-origin',
    chatsDir,
    workspaceDirs: ['/workspace/project'],
    provider: 'anthropic',
    model: 'claude-4',
  });
  const integration = new RecordingIntegration(service);
  const owner = { name };
  await integration.subscribeToJournal(history, owner);
  return { owner, service, integration };
}

/** The text of every summary row in the owner's journal. */
async function compressedSummaryTexts(
  recording: OwnedRecording,
): Promise<string[]> {
  await recording.integration.flushAtTurnBoundary();
  const texts: string[] = [];
  const file = recording.service.getFilePath();
  if (file === null) throw new Error('Missing recording path');
  for await (const row of journalFileRows(file)) {
    if (row.metadata?.isSummary !== true) continue;
    for (const block of row.blocks) {
      if (block.type === 'text') texts.push(block.text);
    }
  }
  return texts;
}

describe('RecordingIntegration compression summary origin', () => {
  let tempDir: string;
  let history: HistoryService;
  let first: OwnedRecording;
  let second: OwnedRecording;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'recording-compression-origin-'),
    );
    history = new HistoryService();
    first = await openOwnedRecording(tempDir, 'first', history);
    second = await openOwnedRecording(tempDir, 'second', history);
  });

  afterEach(async () => {
    for (const recording of [second, first]) {
      await recording.integration.dispose();
      await recording.service.dispose();
    }
    await history.dispose();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('records an unbound compression summary for every owned subscriber while an owner-tagged summary reaches only its owner', async () => {
    history.add(textContent('seed'));
    history.add(textContent('reply', 'ai'));

    history.startCompression();
    history.endCompression();
    await history.addBatch([
      {
        ...textContent('external-summary', 'ai'),
        metadata: { isSummary: true },
      },
    ]);

    expect(await compressedSummaryTexts(first)).toStrictEqual([
      'external-summary',
    ]);
    expect(await compressedSummaryTexts(second)).toStrictEqual([
      'external-summary',
    ]);

    history.startCompression(first.owner);
    history.endCompression(undefined, undefined, first.owner);
    await history.addBatch(
      [
        {
          ...textContent('first-owned-summary', 'ai'),
          metadata: { isSummary: true },
        },
      ],
      undefined,
      { origin: first.owner },
    );

    expect(await compressedSummaryTexts(first)).toStrictEqual([
      'external-summary',
      'first-owned-summary',
    ]);
    expect(await compressedSummaryTexts(second)).toStrictEqual([
      'external-summary',
    ]);
  });
});
