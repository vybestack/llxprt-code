/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  withCheckpoint,
  checkpointTool,
} from '../hooks/agentStream/checkpoint-disk-test-helpers.js';
import { restoreCommand } from './restoreCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
const row: IContent = {
  speaker: 'human',
  blocks: [
    { type: 'media', encoding: 'base64', mimeType: 'image/png', data: png },
  ],
};
const contentId =
  'sha256:' +
  createHash('sha256').update(Buffer.from(png, 'base64')).digest('hex');

async function lifecycle(active: boolean): Promise<boolean> {
  return withCheckpoint(1, active, async (fixture, dir) => {
    await writeFile(
      join(dir, 'restore.json'),
      JSON.stringify({
        clientHistory: [row],
        toolCall: checkpointTool.request,
      }),
    );
    vi.spyOn(
      fixture.config.storage,
      'getProjectTempCheckpointsDir',
    ).mockReturnValue(dir);
    vi.spyOn(fixture.config, 'getCheckpointingEnabled').mockReturnValue(true);
    const context = createMockCommandContext();
    context.services.config = fixture.config;
    const client = fixture.config.getAgentClient();
    const store = fixture.config.getLocalMediaStore();
    try {
      expect(
        await restoreCommand(fixture.config)?.action?.(context, 'restore'),
      ).toMatchObject({ type: 'tool' });
      expect(await store.hasReservations(contentId)).toBe(true);
      if (!active) await client.startChat([]);
      expect(await store.hasReservations(contentId)).toBe(true);
      await client.dispose();
      expect(
        await readdir(join(store.rootDirectory, 'temporary')),
      ).toStrictEqual([]);
      return await store.hasReservations(contentId);
    } finally {
      vi.restoreAllMocks();
    }
  });
}

describe('invoked CLI restored media disposal', () => {
  it.each([false, true])(
    'releases restored media after startup and disposal, active=%s',
    async (active) => {
      expect(await lifecycle(active)).toBe(false);
    },
    180000,
  );
});
