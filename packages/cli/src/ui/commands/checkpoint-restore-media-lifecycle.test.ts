/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { installWorkspaceRuntimeFixture } from '../../__tests__/workspace-runtime-fixture.js';
const composeFixtureRuntime = installWorkspaceRuntimeFixture();

import { describe, expect, it, vi } from 'bun:test';
import { writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  withCheckpoint,
  checkpointTool,
} from '../hooks/agentStream/checkpoint-disk-test-helpers.js';
import { checkpointCommand } from '../../__tests__/checkpoint-command-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { requireMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';

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
    Object.defineProperty(fixture.config, 'projectCheckpointsDir', {
      value: dir,
    });
    vi.spyOn(fixture.config, 'getCheckpointingEnabled').mockReturnValue(true);
    const runtime = composeFixtureRuntime(fixture.config);
    const client = fixture.client;
    const context = createMockCommandContext({
      services: { config: runtime },
    });
    const store = requireMediaStore(client);
    try {
      expect(
        await checkpointCommand(client, runtime)?.action?.(context, 'restore'),
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
