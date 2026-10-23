/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { useTempDir } from './helpers/journal-fixture-support.js';
import { operationFileCreates } from '../../compression/__tests__/support/operation-file-creates.js';
import {
  buildAgent,
  drain,
  internalAgentClient,
} from './helpers/agentHarness.js';
import { collectAgentHistory } from './helpers/collect-agent-history.js';

describe('native public chat semantic purge trigger', () => {
  const directory = useTempDir('native-purge-chat-');
  it('purges through the next model call and durable recording without operation files', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      workingDir: directory(),
    });
    try {
      await drain(agent.stream('initialize session'));
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [
            { type: 'text', text: 'image prompt' },
            {
              type: 'media',
              mimeType: 'image/png',
              encoding: 'base64',
              data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=',
            },
          ],
        },
        { speaker: 'ai', blocks: [{ type: 'text', text: 'prior response' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      agent.setEphemeralSetting('media.semantic-purge', 'remove');
      const history = internalAgentClient(agent).getHistoryService();
      if (history === null) throw new Error('Missing native public history');
      const receipt = await operationFileCreates(async () => {
        await drain(agent.stream('describe without the image'));
        await history.waitForCommit();
      }, true);
      expect(receipt).toStrictEqual({ directories: [], files: [] });
      const rows = await collectAgentHistory(agent);
      expect(rows[0].blocks).toStrictEqual([
        { type: 'text', text: 'image prompt' },
      ]);
      expect(rows[0].metadata?.semanticMediaPurgeFrontier).toStrictEqual({
        contentIndex: 0,
        blockIndex: 0,
      });
      expect(
        rows.some(
          (row) =>
            row.speaker === 'ai' &&
            row.blocks.some(
              (block) => block.type === 'text' && block.text.length > 0,
            ),
        ),
      ).toBe(true);
    } finally {
      await cleanup();
    }
  });
});
