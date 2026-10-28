/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A compression summary carries the origin that produced it. Recording
 * subscribers bound to an owner record summaries from their own origin and
 * from no origin at all, and skip summaries tagged with another owner.
 *
 * Real HistoryService, real RecordingIntegration and SessionRecordingService
 * writing JSONL into temp directories. Assertions are on the recorded files.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { SessionRecordingService } from './SessionRecordingService.js';

interface OwnedRecording {
  readonly owner: object;
  readonly service: SessionRecordingService;
  readonly integration: RecordingIntegration;
}

function textContent(
  text: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function openOwnedRecording(
  tempDir: string,
  name: string,
  history: HistoryService,
): OwnedRecording {
  const chatsDir = path.join(tempDir, name);
  const service = new SessionRecordingService({
    sessionId: `compression-origin-${name}-0001`,
    projectHash: 'project-hash-compression-origin',
    chatsDir,
    workspaceDirs: ['/workspace/project'],
    provider: 'anthropic',
    model: 'claude-4',
  });
  const integration = new RecordingIntegration(service);
  const owner = { name };
  integration.subscribeToHistory(history, owner);
  return { owner, service, integration };
}

/** The summary text of every `compressed` record in the owner's journal. */
async function compressedSummaryTexts(
  recording: OwnedRecording,
): Promise<string[]> {
  await recording.integration.flushAtTurnBoundary();
  const filePath = recording.service.getFilePath();
  if (filePath === null) throw new Error('Missing recording path');
  const texts: string[] = [];
  for (const line of (await fs.readFile(filePath, 'utf-8'))
    .trim()
    .split('\n')) {
    const event = JSON.parse(line) as {
      type: string;
      payload?: { summary?: IContent };
    };
    if (event.type !== 'compressed') continue;
    for (const block of event.payload?.summary?.blocks ?? []) {
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
    first = openOwnedRecording(tempDir, 'first', history);
    second = openOwnedRecording(tempDir, 'second', history);
  });

  afterEach(async () => {
    for (const recording of [second, first]) {
      await recording.integration.dispose();
      await recording.service.dispose();
    }
    history.dispose();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('records an unbound compression summary for every owned subscriber while an owner-tagged summary reaches only its owner', async () => {
    history.add(textContent('seed'));
    history.add(textContent('reply', 'ai'));

    history.startCompression();
    history.endCompression(textContent('external-summary', 'ai'), 2);

    expect(await compressedSummaryTexts(first)).toStrictEqual([
      'external-summary',
    ]);
    expect(await compressedSummaryTexts(second)).toStrictEqual([
      'external-summary',
    ]);

    history.startCompression(first.owner);
    history.endCompression(
      textContent('first-owned-summary', 'ai'),
      2,
      first.owner,
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
