/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { useTempDir } from '../../packages/core/src/journal/__tests__/support/useTempDir.js';
import { createSessionRecorder } from '../../packages/core/src/recording/sessionRecorderFactory.js';
import { requireJournalRecorder } from '../../packages/core/src/services/history/recorderBackend.js';
import { NativeRecordingProbe } from '../../packages/core/src/storage/native-recording-probe.test-support.js';

describe('native recording probe write bytes', () => {
  const directory = useTempDir('native-recording-probe-');

  it('measures real in-flight native write buffers and releases them after commit', async () => {
    const probe = new NativeRecordingProbe();
    const recording = createSessionRecorder({
      sessionId: 'probe',
      projectHash: 'probe',
      chatsDir: join(directory(), 'chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      journal: probe.options,
    });
    try {
      const session = await requireJournalRecorder(recording).session();
      let observed = 0;
      await probe.measureWrite(
        () =>
          session
            .append([
              {
                speaker: 'human',
                blocks: [{ type: 'text', text: 'native probe row' }],
              },
            ])
            .then(() => undefined),
        async () => {
          observed = probe.getPendingByteCount();
        },
      );
      expect(observed).toBeGreaterThan(0);
      expect(probe.getPendingByteCount()).toBe(0);
      const path = recording.getFilePath();
      if (path === null) throw new Error('Missing recording path');
      expect((await readFile(path)).subarray(0, 8).toString()).toBe(
        'LLXJRNL\0',
      );
      const texts: string[] = [];
      for await (const row of session.rows()) {
        texts.push(
          ...row.content.blocks.flatMap((block) =>
            block.type === 'text' ? [block.text] : [],
          ),
        );
      }
      expect(texts).toEqual(['native probe row']);
    } finally {
      await recording.dispose();
    }
  });

  it('releases measured bytes when the observation rejects', async () => {
    const probe = new NativeRecordingProbe();
    const recording = createSessionRecorder({
      sessionId: 'failed-probe',
      projectHash: 'probe',
      chatsDir: join(directory(), 'chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      journal: probe.options,
    });
    try {
      const session = await requireJournalRecorder(recording).session();
      await expect(
        probe.measureWrite(
          () =>
            session
              .append([
                {
                  speaker: 'human',
                  blocks: [{ type: 'text', text: 'failed' }],
                },
              ])
              .then(() => undefined),
          async () => {
            throw new Error('observation failed');
          },
        ),
      ).rejects.toThrow('observation failed');
      expect(probe.getPendingByteCount()).toBe(0);
    } finally {
      await recording.dispose().catch(() => undefined);
    }
  });
});
