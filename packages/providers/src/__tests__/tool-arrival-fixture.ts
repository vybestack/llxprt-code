/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ContentBlock,
  IContent,
  ToolCallBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ResponseArrival } from '@vybestack/llxprt-code-core/services/history/history-response-arrival.js';
import type { DirectoryBlock } from '@vybestack/llxprt-code-core/journal/row-directory.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { createSessionRecorder } from '@vybestack/llxprt-code-core/recording/sessionRecorderFactory.js';
import { openJournalReadOnly } from '@vybestack/llxprt-code-core/journal/journalReader.js';
import { TranscriptReader } from '@vybestack/llxprt-code-core/journal/transcript-reader.js';
import { sha256KeyHash } from '@vybestack/llxprt-code-core/journal/idKeys.js';
export const pieces = ['{"path":"a', '\\nb","count":', '2}'];
export const expected: ToolCallBlock = {
  type: 'tool_call',
  id: 'call_frozen',
  name: 'lookup',
  parameters: { path: 'a\nb', count: 2 },
};

async function recordedParameters(path: string): Promise<string> {
  const file = await openJournalReadOnly(path);
  try {
    const reader = new TranscriptReader(file, sha256KeyHash);
    const entries = await reader.page({ direction: 'forward', limit: 10 });
    let text = '';
    for (const entry of entries.filter((entry) => entry.rowRef !== 0))
      text += await blockText(reader.blocks(entry));
    return text;
  } finally {
    await file.close();
  }
}

export async function runDiskArrival(
  factory: (gate: (index: number) => Promise<void>) => AsyncIterable<IContent>,
  retain: boolean,
): Promise<ContentBlock[]> {
  const directory = await mkdtemp(join(tmpdir(), 'responses-tool-arrival-'));
  const history = new HistoryService();
  const recording = createSessionRecorder({
    sessionId: 'arrival',
    projectHash: 'arrival',
    chatsDir: directory,
    workspaceDirs: [],
    provider: 'openai-responses',
    model: 'gpt-5.6',
  });
  let arrival: ResponseArrival | undefined;
  try {
    await history.attachJournal(recording);
    arrival = await history.openResponseArrival({
      id: 'attempt',
      submissionId: 'prompt',
    });
    const source = factory(async (index) => {
      await Bun.sleep(100);
      const path = recording.getFilePath();
      if (path === null) throw new Error('Missing recording');
      const bytes = await recordedParameters(path);
      const prefix = pieces.slice(0, index + 1).join('');
      if (!bytes.includes(`"parameters":${prefix}`))
        throw new Error('Argument disk-progress gate failed');
    });
    for await (const content of source) {
      if (retain && content.blocks.length === 0) continue;
      await appendContent(arrival, content);
    }
    await arrival.seal({});
    const rows = await Array.fromAsync(history.streamRawHistory());
    return rows.flatMap((row) => row.blocks);
  } finally {
    await arrival?.interrupt('cancelled');
    await history.dispose();
    await recording.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}

async function blockText(
  blocks: AsyncIterable<DirectoryBlock>,
): Promise<string> {
  let text = '';
  for await (const block of blocks)
    for await (const part of block.parts())
      text += new TextDecoder().decode(part);
  return text;
}

async function appendContent(
  arrival: ResponseArrival,
  content: IContent,
): Promise<void> {
  if (content.toolArgumentDelta !== undefined) {
    await arrival.appendToolArguments(content.toolArgumentDelta);
    return;
  }
  for (const block of content.blocks) await arrival.append(block);
}
