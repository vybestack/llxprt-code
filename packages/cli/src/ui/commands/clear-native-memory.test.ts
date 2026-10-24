/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { fstatSync, readFileSync, statSync } from 'node:fs';
import * as positional from '../../../../core/src/journal/positionalFile.js';
import { TRAILER_WINDOW_BYTES } from '../../../../core/src/journal/trailerSearch.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import { buildAgent } from '../../../../agents/src/api/__tests__/helpers/agentHarness.js';
import { collectAgentHistory } from '../../../../agents/src/api/__tests__/helpers/collect-agent-history.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { assertDefined } from '../../__tests__/assertions.js';
import { clearCommand } from './clearCommand.js';

const clearAction = clearCommand.action;
assertDefined(clearAction);

describe('clearCommand native allocations', () => {
  const directory = useTempDir('clear-native-memory-');

  it('clears sustained tool output without allocating another journal copy', async () => {
    const read = positional.createFileHandleReader;
    let sourceInode: number | undefined;
    let readBytes = 0;
    let largestRead = 0;
    const probe = spyOn(
      positional,
      'createFileHandleReader',
    ).mockImplementation((handle) => {
      if (!('fd' in handle) || typeof handle.fd !== 'number')
        throw new Error('Expected a real journal file descriptor');
      const fd = handle.fd;
      return read({
        read: async (buffer, offset, length, position) => {
          if (sourceInode !== undefined && fstatSync(fd).ino === sourceInode) {
            readBytes += length;
            largestRead = Math.max(largestRead, length);
          }
          return handle.read(buffer, offset, length, position);
        },
      });
    });
    try {
      const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
        workingDir: directory(),
      });
      try {
        await agent.session.setRecording({ enabled: true });
        await agent.session.startNewSession();
        const history = agent.agentClient.getHistoryService();
        if (history === null) throw new Error('Missing session history');
        const output = 'sustained output\n'.repeat(4096);
        for (let row = 0; row < 64; row++) {
          history.add({
            speaker: 'tool',
            blocks: [{ type: 'text', text: `${row}: ${output}` }],
          });
          await history.waitForCommit();
        }
        await agent.session.flushRecording();
        const oldPath = agent.session.getRecording().path;
        if (oldPath === undefined) throw new Error('Missing recording path');
        const before = readFileSync(oldPath);
        expect(before.byteLength).toBeGreaterThan(4 * 1024 * 1024);

        sourceInode = statSync(oldPath).ino;
        await history.getLastContent();
        expect(readBytes).toBeGreaterThan(0);
        readBytes = 0;
        largestRead = 0;
        try {
          await clearAction(
            createMockCommandContext({ services: { agent } }),
            '',
          );
        } finally {
          sourceInode = undefined;
        }

        expect(readBytes).toBeLessThanOrEqual(TRAILER_WINDOW_BYTES);
        expect(largestRead).toBeLessThanOrEqual(TRAILER_WINDOW_BYTES);
        expect(Buffer.compare(before, readFileSync(oldPath))).toBe(0);
        expect(await collectAgentHistory(agent)).toStrictEqual([]);
        await expect(history.getLastContent()).rejects.toThrow('disposed');
      } finally {
        await cleanup();
      }
    } finally {
      probe.mockRestore();
    }
  });
});
