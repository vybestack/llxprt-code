/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { Config } from '../config/config.js';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function createRoot(sessionId: string, workspace: string): Config {
  return new Config({
    sessionId,
    targetDir: workspace,
    cwd: workspace,
    model: 'test-model',
    provider: 'openai',
    debugMode: false,
    telemetry: { enabled: true, conversationLogPath: workspace },
  });
}

async function readEntries(directory: string): Promise<string[]> {
  const fileName = (await readdir(directory)).find((file) =>
    file.endsWith('.jsonl'),
  );
  if (fileName === undefined) {
    throw new Error(`No conversation file was written in ${directory}`);
  }
  return (await readFile(join(directory, fileName), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => (JSON.parse(line) as { type: string }).type);
}

describe('ConversationFileWriter root ownership', () => {
  it('writes to each root directory and leaves the second root working after the first closes', async () => {
    const workspaceA = await mkdtemp(join(tmpdir(), 'conversation-root-a-'));
    const workspaceB = await mkdtemp(join(tmpdir(), 'conversation-root-b-'));
    const rootA = createRoot('conversation-owner-a', workspaceA);
    const rootB = createRoot('conversation-owner-b', workspaceB);
    try {
      const writerA = rootA.getConversationFileWriter();
      const writerB = rootB.getConversationFileWriter();
      expect(writerA).not.toBe(writerB);
      expect(rootA.getConversationFileWriter()).toBe(writerA);

      await writerA.writeEntry({ type: 'root-a' });
      await writerB.writeEntry({ type: 'root-b' });
      await rootA.dispose();
      await writerB.writeEntry({ type: 'root-b-after-close' });

      expect(await readEntries(workspaceA)).toStrictEqual(['root-a']);
      expect(await readEntries(workspaceB)).toStrictEqual([
        'root-b',
        'root-b-after-close',
      ]);
    } finally {
      await rootA.dispose();
      await rootB.dispose();
      await rm(workspaceA, { recursive: true, force: true });
      await rm(workspaceB, { recursive: true, force: true });
    }
  });
});
