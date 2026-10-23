/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { SessionDiscovery } from './SessionDiscovery.js';

describe('first user message preview', () => {
  const directory = useTempDir('first-user-preview-');

  async function record(
    sessionId: string,
    contents: readonly IContent[],
    kind: 'main' | 'subagent' = 'main',
  ): Promise<string> {
    const recording = JournalRecordingService.create({
      sessionId,
      chatsDir: directory(),
      projectHash: 'hash',
      workspaceDirs: ['/w'],
      provider: 'anthropic',
      model: 'claude',
      kind,
    });
    const history = new HistoryService({ recording });
    try {
      await recording.session();
      for (const content of contents) history.add(content);
      await history.waitForCommit();
      await recording.flush();
      const filePath = recording.getFilePath();
      if (filePath === null) throw new Error('Missing fixture journal');
      return filePath;
    } finally {
      await history.dispose();
      await recording.dispose();
    }
  }

  function user(text: string): IContent {
    return { speaker: 'human', blocks: [{ type: 'text', text }] };
  }

  it('keeps only the capped title of a large first message', async () => {
    const filePath = await record('large-title', [user('T'.repeat(3_000_000))]);
    expect(await SessionDiscovery.readFirstUserMessage(filePath, 120)).toBe(
      'T'.repeat(120),
    );
  });

  it('cuts a multi-byte title at the character cap', async () => {
    const filePath = await record('cut-title', [user('漢'.repeat(500))]);
    expect(await SessionDiscovery.readFirstUserMessage(filePath, 10)).toBe(
      '漢'.repeat(10),
    );
  });

  it('returns null for empty and header-only journals', async () => {
    const empty = path.join(directory(), 'empty.llxj');
    await writeFile(empty, '');
    expect(await SessionDiscovery.readFirstUserMessage(empty)).toBeNull();
    const header = await record('header', []);
    expect(await SessionDiscovery.readFirstUserMessage(header)).toBeNull();
  });

  it('returns null for a missing file', async () => {
    expect(
      await SessionDiscovery.readFirstUserMessage(
        path.join(directory(), 'missing.llxj'),
      ),
    ).toBeNull();
  });

  it('never lists child sessions, so their titles are not scanned', async () => {
    await record('main-1', [user('main question')]);
    await record('child-1', [user('child prompt')], 'subagent');
    const { sessions } = await SessionDiscovery.listSessionsDetailed(
      directory(),
      'hash',
    );
    expect(sessions.map((session) => session.sessionId)).toStrictEqual([
      'main-1',
    ]);
    expect(
      await SessionDiscovery.readFirstUserMessage(sessions[0].filePath),
    ).toBe('main question');
  });
});
