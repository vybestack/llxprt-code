/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { describe, expect, it } from 'bun:test';
import { rawClientChatCommand } from '../../__tests__/raw-chat-command.fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import {
  withCleanupHistory,
  cleanupBounds,
} from '../../utils/__tests__/support/cleanup-history-test-helpers.js';
import { requireMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';

for (const size of [65]) {
  describe(`contextual default client history ${size}`, () => {
    it('reports the actual transcript count through the public default without eager history', async () => {
      await withCleanupHistory(size, true, async (fixture) => {
        const chatCommand = rawClientChatCommand(
          fixture.client,
          () => null,
          () => fixture.config.getModel(),
        );
        const debug = chatCommand.subCommands?.find(
          (command) => command.name === 'debug',
        );
        const result = await debug?.action?.(
          createMockCommandContext({
            services: {
              config: { getModel: () => fixture.config.getModel() },
              agent: null,
            },
          }),
          '',
        );
        expect(result).toMatchObject({
          messageType: 'info',
          content: expect.stringContaining(`History entries: ${size}`),
        });
        expect(fixture.history.delivered).toBe(size);
        expect(fixture.history.closed).toBe(1);
        expect(fixture.reader.snapshot().liveRows).toBe(0);
        expect(fixture.reader.within(cleanupBounds)).toBe(true);
      });
    }, 120_000);
  });
}

describe('default clear rollback media lifetime', () => {
  it('keeps removed media reserved until rollback has consumed its disk snapshot', async () => {
    await withCleanupHistory(6, true, async (fixture) => {
      const client = fixture.client;
      const store = requireMediaStore(client);
      const control = fixture.sessionClient.createSessionControl(
        'config',
        () => 'default-clear-media',
        (operation) => operation(),
        () => {},
        () => {
          throw new Error('Clearing history must not start a new session');
        },
        () => 'fake',
        () => fixture.config.getModel(),
      );
      await control.setRecording({ enabled: true });
      const reset = client.resetChat.bind(client);
      client.resetChat = async (source) => {
        await reset(source);
        await client.getHistoryService()?.settleMediaOwnership();
        const reserved = await store.hasReservations(
          fixture.reference.contentId,
        );
        throw new Error(
          reserved
            ? 'clear publication fault'
            : 'rollback media reservation lost',
        );
      };
      try {
        await expect(control.clearHistory()).rejects.toThrow(
          'clear publication fault',
        );
        const rows: IContent[] = [];
        for await (const row of client.getHistory()) rows.push(row);
        expect(rows).toHaveLength(6);
        expect(rows[5].blocks).toStrictEqual([
          { type: 'text', text: `5:${'x'.repeat(2048)}` },
          fixture.reference,
        ]);
        expect(fixture.reader.snapshot().liveRows).toBe(0);
      } finally {
        await control.dispose();
      }
    });
  }, 120_000);
});
