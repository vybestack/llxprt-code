/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  acceptanceDirectory,
  launchAcceptanceChild,
} from './childaccept-fixture.js';
import { localTransport, sendChildHistory } from './childaccept-transport.js';

describe('child facade real launch', () => {
  it('creates a fixture directory when its evidence parent is absent', async () => {
    const parent = join(
      resolve('tmp/verify854/p05d'),
      `fixture-parent-${randomUUID()}`,
    );
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
    try {
      const history = fixture.child.runtime.history;
      expect(history).toBeInstanceOf(HistoryService);
      expect(fixture.child.scope.runtimeContext.history).toBe(history);
      history.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'child-only' }],
      });
      await history.waitForCommit();
      const chats = fixture.config.storage.getProjectChatsDir();
      const files = await readdir(chats);
      expect(files.filter((file) => file.endsWith('.lock'))).toHaveLength(1);
      const journals = files.filter((file) => file.endsWith('.jsonl'));
      expect(journals).toHaveLength(1);
      const bytes = await readFile(resolve(chats, journals[0]), 'utf8');
      expect(bytes).toContain('"kind":"subagent"');
      expect(bytes).toContain('"parentSessionId":"childaccept-parent"');
      expect(bytes).toContain('child-only');
    } finally {
      await fixture.close();
    }
    expect(await readdir(resolve(directory, 'chats'))).toStrictEqual([]);
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
