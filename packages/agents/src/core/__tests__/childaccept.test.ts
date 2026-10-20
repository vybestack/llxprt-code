/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { readJournalFileFacts } from '@vybestack/llxprt-code-core/recording/journalSessionListing.js';
import { nativeFileRows } from '../../compression/__tests__/support/native-file-rows.js';
import {
  acceptanceDirectory,
  childJournalExtension,
  launchAcceptanceChild,
} from './childaccept-fixture.js';
import { localTransport, sendChildHistory } from './childaccept-transport.js';

async function verifyNativeLaunch(
  path: string,
  directory: string,
  fixture: Awaited<ReturnType<typeof launchAcceptanceChild>>,
): Promise<void> {
  const found = await readJournalFileFacts(path);
  expect(found?.facts).toMatchObject({
    sessionId: fixture.child.runtime.runtimeContext.state.sessionId,
    provider: 'openai-responses',
    model: 'gpt-5.2',
    start: {
      kind: 'subagent',
      parentSessionId: 'childaccept-parent',
      workspaceDirs: [directory],
    },
  });
  expect(await Array.fromAsync(nativeFileRows(path))).toMatchObject([
    { speaker: 'human', blocks: [{ type: 'text', text: 'child-only' }] },
  ]);
  expect(found?.rows).toBe(1);
}

async function verifyLaunchJournal(
  path: string,
  directory: string,
  fixture: Awaited<ReturnType<typeof launchAcceptanceChild>>,
): Promise<void> {
  if (childJournalExtension() === '.llxj') {
    await verifyNativeLaunch(path, directory, fixture);
    return;
  }
  const bytes = await readFile(path, 'utf8');
  expect(bytes).toContain('"kind":"subagent"');
  expect(bytes).toContain('"parentSessionId":"childaccept-parent"');
  expect(bytes).toContain('child-only');
}

describe('child facade real launch', () => {
  it('creates a fixture directory when its parent is absent', async () => {
    const parent = join(tmpdir(), `fixture-parent-${randomUUID()}`);
    try {
      const directory = await acceptanceDirectory('childaccept-probe-', parent);
      expect((await stat(directory)).isDirectory()).toBe(true);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('launches a real scope and runtime over its own mandatory journal', async () => {
    const directory = await acceptanceDirectory('childaccept-path-');
    const fixture = await launchAcceptanceChild(
      directory,
      'http://127.0.0.1:1/v1',
    );
    const chats = fixture.config.projectChatsDir;
    try {
      const history = fixture.child.runtime.history;
      expect(history).toBeInstanceOf(HistoryService);
      expect(fixture.child.scope.runtimeContext.history).toBe(history);
      history.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'child-only' }],
      });
      await history.waitForCommit();
      const files = await readdir(chats);
      expect(files.filter((file) => file.endsWith('.lock'))).toHaveLength(1);
      const journals = files.filter((file) =>
        file.endsWith(childJournalExtension()),
      );
      expect(journals).toHaveLength(1);
      const path = resolve(chats, journals[0]);
      expect(history.journalPath()).toBe(path);
      await verifyLaunchJournal(path, directory, fixture);
    } finally {
      await fixture.close();
    }
    expect(await readdir(chats)).toStrictEqual([]);
  }, 180000);

  it('sends the child curated journal through its real provider to local HTTP', async () => {
    const directory = await acceptanceDirectory('childaccept-wire-');
    const transport = await localTransport(directory);
    const fixture = await launchAcceptanceChild(directory, transport.baseUrl);
    try {
      fixture.child.runtime.history.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'hello' }],
      });
      await fixture.child.runtime.history.waitForCommit();
      await sendChildHistory(fixture.child);
      expect(transport.count()).toBe(1);
      expect(await readFile(resolve(directory, 'request-1.json'), 'utf8')).toBe(
        JSON.stringify({
          model: 'gpt-5.2',
          input: [{ role: 'user', content: 'hello' }],
          stream: true,
          instructions: 'child acceptance',
          store: true,
        }),
      );
    } finally {
      await fixture.close();
      await transport.close();
    }
  }, 180000);
});
