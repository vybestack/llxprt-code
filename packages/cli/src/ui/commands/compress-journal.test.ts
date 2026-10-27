/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withRecordingLifetimeFixture } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { NativeJournalCursor } from '../stores/turn/native-journal-cursor.js';
import { compressCommand } from './compressCommand.js';
import type { CommandContext } from './types.js';

function contextFor(
  agent: NonNullable<CommandContext['services']['agent']>,
): CommandContext {
  const base = createMockCommandContext();
  return {
    ...base,
    recordingOwner: 'agent',
    services: { ...base.services, agent },
    ui: {
      ...base.ui,
      addItem: () => {
        throw new Error('Ledger write forbidden');
      },
    },
  };
}

describe('compression journal presentation', () => {
  it('persists the completed compression notice without admitting it to model history', async () => {
    await withRecordingLifetimeFixture(async ({ agent }) => {
      await agent.session.setRecording({ enabled: true });
      if (!compressCommand.action)
        throw new Error('Missing compression action');
      await compressCommand.action(contextFor(agent), '');
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('Missing journal path');
      const cursor = await NativeJournalCursor.open(path, {}, 10);
      try {
        const entries = (await cursor.pageBack(10)).entries;
        expect(
          entries.flatMap((entry) =>
            entry.kind === 'projected' ? [entry.item.type] : [],
          ),
        ).toStrictEqual(['compression']);
        const items = entries.flatMap((entry) =>
          entry.kind === 'projected' && entry.item.type === 'compression'
            ? [entry.item.compression]
            : [],
        );
        expect(items).toHaveLength(1);
        expect(items[0].isPending).toBe(false);
        expect(await agent.session.getHistory()).toStrictEqual([]);
      } finally {
        await cursor.close();
      }
    });
  }, 30000);
});
