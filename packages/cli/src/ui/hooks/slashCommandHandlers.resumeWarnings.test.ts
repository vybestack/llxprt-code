/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withRecordingLifetimeFixture } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { commandDeps } from '../../__tests__/native-command-fixture.js';
import { readJournalItems } from '../stores/turn/journal-turn-test-helpers.js';
import type { Message } from '../types.js';
import { processSlashCommand } from './slashCommandHandlers.js';

describe('continue skipped-recording warning', () => {
  it('keeps the unreadable-recording warning visible beside restored conversation rows', async () => {
    await withRecordingLifetimeFixture(async ({ agent, chatsDir, borrow }) => {
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'restored conversation' }],
        },
      ]);
      await agent.session.setRecording({ enabled: true });
      const id = agent.session.getSessionId();
      await agent.session.setRecording({ enabled: false });
      const corruptPath = join(
        chatsDir,
        'session-2026-10-08T21-18-08-corrupt.llxj',
      );
      await writeFile(corruptPath, 'LLXJRNL\0');
      const next = await borrow();
      const errors: Message[] = [];
      const context = createMockCommandContext({
        recordingOwner: 'agent',
        services: { agent: next },
        ui: {
          addItem: () => {
            throw new Error('UI ledger forbidden');
          },
        },
      });
      await processSlashCommand(
        commandDeps(context, errors),
        `/continue ${id}`,
      );
      expect(errors).toStrictEqual([]);
      const visible = (await readJournalItems(next)).map((item) => item.text);
      expect(visible[0]).toBe('restored conversation');
      expect(visible.at(-1)).toContain(corruptPath);
      expect(visible.at(-1)).toContain('Skipped unreadable session recording');
    });
  });
});
