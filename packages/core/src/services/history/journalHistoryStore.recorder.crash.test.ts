/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { JournalRecordingService } from '../../recording/journalRecordingService.js';
import type { IContent } from './IContent.js';

const SESSION = 'session-cccccccc-3333';
const ROWS = 40;
const CHILD = path.join(
  import.meta.dir,
  '__tests__',
  'support',
  'recorderAckChild.ts',
);

function textOf(content: IContent): string {
  return content.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}

/** Reads the child's stdout until its first line, which is the acknowledgement. */
async function firstLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let seen = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done)
      throw new Error(`the child ended before it acknowledged: ${seen}`);
    seen += decoder.decode(value, { stream: true });
    const end = seen.indexOf('\n');
    if (end >= 0) return seen.slice(0, end);
  }
}

describe('journal recorder crash after the acknowledgement', () => {
  const directory = useTempDir('journal-recorder-crash-');
  const children: Array<ReturnType<typeof Bun.spawn>> = [];
  afterEach(async () => {
    for (const child of children.splice(0)) {
      if (child.exitCode === null) child.kill('SIGKILL');
      await child.exited;
    }
  });

  it('keeps every acknowledged row and fact when the process is killed with SIGKILL', async () => {
    const child = Bun.spawn(
      [process.execPath, CHILD, directory(), SESSION, String(ROWS)],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    children.push(child);
    const line = await firstLine(child.stdout);
    expect(line.startsWith('ACKED ')).toBe(true);
    const filePath = line.slice('ACKED '.length);

    child.kill('SIGKILL');
    await child.exited;
    expect(child.signalCode).toBe('SIGKILL');

    const recorder = await JournalRecordingService.open(
      {
        sessionId: SESSION,
        projectHash: 'project',
        chatsDir: path.join(directory(), 'chats'),
        workspaceDirs: ['/work/a'],
        provider: 'anthropic',
        model: 'model-1',
      },
      filePath,
    );
    try {
      const held: string[] = [];
      for await (const { content } of (await recorder.session()).rows()) {
        held.push(textOf(content));
      }
      expect(held).toStrictEqual(
        Array.from({ length: ROWS }, (_, at) => `row ${at}`),
      );
      expect(recorder.getSessionMetadataTitle()).toBe('Acked title');
    } finally {
      await recorder.dispose();
    }
  });
});
