/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withRecordingLifetimeFixture } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { NativeJournalCursor } from '../stores/turn/native-journal-cursor.js';
import { writeSlashOutput } from './slash-journal-output.js';
import type { CommandOwnerFixture } from '../../__tests__/mockCommandContext.js';

describe('owner slash output', () => {
  it('persists output before completion without adding a ledger item or model row', async () => {
    await withRecordingLifetimeFixture(async ({ agent, clientFor }) => {
      await agent.session.setRecording({ enabled: true });
      const base = createMockCommandContext();
      const context: CommandOwnerFixture = {
        ...base,
        recordingOwner: 'agent',
        services: { ...base.services, agent },
      };
      const before = await agent.session.getHistory();
      await writeSlashOutput(
        clientFor(agent).getHistoryService(),
        context.services.agent?.session,
        context.recordingOwner,
        'user',
        '/command sanitized-input',
        () => {
          throw new Error('Ledger input is forbidden');
        },
      );
      await writeSlashOutput(
        clientFor(agent).getHistoryService(),
        context.services.agent?.session,
        context.recordingOwner,
        'info',
        'slash persisted output',
        () => {
          throw new Error('Ledger output is forbidden');
        },
      );
      await writeSlashOutput(
        clientFor(agent).getHistoryService(),
        context.services.agent?.session,
        context.recordingOwner,
        'error',
        'slash persisted error',
        () => {
          throw new Error('Ledger output is forbidden');
        },
      );
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('Missing materialized journal');
      const cursor = await NativeJournalCursor.open(path, {}, 16);
      try {
        const entries = (await cursor.pageBack(16)).entries;
        expect(
          entries.flatMap((entry) =>
            entry.kind === 'projected'
              ? [[entry.item.type, entry.item.text]]
              : [],
          ),
        ).toStrictEqual([
          ['error', 'slash persisted error'],
          ['info', 'slash persisted output'],
          ['user', '/command sanitized-input'],
        ]);
        expect(await agent.session.getHistory()).toStrictEqual(before);
      } finally {
        await cursor.close();
      }
    });
  }, 30000);

  it('keeps output after existing model history and retracts only the selected display handle', async () => {
    await withRecordingLifetimeFixture(async ({ agent, clientFor }) => {
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'model prompt' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      const history = clientFor(agent).getHistoryService();
      if (!history) throw new Error('Missing history owner');
      const transient = await history.appendDisplay(
        { type: 'warning' },
        'temporary warning',
        agent.session,
      );
      await history.appendDisplay(
        { type: 'slash' },
        'durable command output',
        agent.session,
      );
      await history.retractDisplay(transient);
      history.add(
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'later model output' }],
        },
        undefined,
        agent.session,
      );
      await history.waitForPendingOperations();
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('Missing recording path');
      await agent.session.setRecording({ enabled: false });
      const cursor = await NativeJournalCursor.open(path, {}, 16);
      try {
        const entries = (await cursor.pageBack(16)).entries;
        expect(
          entries.flatMap((entry) =>
            entry.kind === 'projected' ? [entry.item.text] : [],
          ),
        ).toStrictEqual([
          'later model output',
          'durable command output',
          'model prompt',
        ]);
      } finally {
        await cursor.close();
      }
    });
  }, 30000);
});
