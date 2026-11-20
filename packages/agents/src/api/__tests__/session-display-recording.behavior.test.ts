/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { NativeJournalPageReader } from '@vybestack/llxprt-code-core/journal/native-journal-page-reader.js';
import { withRecordingLifetimeFixture } from './helpers/recording-owner-lifetime-fixture.js';

async function displayTexts(path: string): Promise<string[]> {
  const reader = await NativeJournalPageReader.open(path);
  const texts: string[] = [];
  try {
    for await (const row of reader.entries()) {
      if ((await reader.presentation(row)) === undefined) continue;
      texts.push(
        ...(await reader.readContent(row)).blocks
          .filter((block) => block.type === 'text')
          .map((block) => block.text),
      );
    }
    return texts;
  } finally {
    await reader.close();
  }
}

describe('session display recording', () => {
  it('logs an already displayed event without appending a second presentation row', async () => {
    await withRecordingLifetimeFixture(async ({ agent }) => {
      await agent.session.setRecording({ enabled: true });
      await agent.session.appendDisplay({ type: 'warning' }, 'single warning');
      await agent.session.recordRecordingEvent({
        type: 'session_event',
        severity: 'warning',
        message: 'single warning',
        presentation: 'already-appended',
      });
      const path = agent.session.getRecording().path;
      if (path === undefined) throw new Error('Missing recording path');
      expect(await displayTexts(path)).toStrictEqual(['single warning']);
      expect(await Array.fromAsync(agent.streamHistory())).toStrictEqual([]);
    });
  });

  it('materializes an operational event before the first conversational row', async () => {
    await withRecordingLifetimeFixture(async ({ agent }) => {
      await agent.session.setRecording({ enabled: true });
      expect(agent.session.getRecording().path).toBeUndefined();
      await agent.session.recordRecordingEvent({
        type: 'session_event',
        severity: 'error',
        message: 'bootstrap authentication failed',
      });
      const path = agent.session.getRecording().path;
      if (path === undefined)
        throw new Error('Operational event was not durable');
      expect(await displayTexts(path)).toStrictEqual([
        'bootstrap authentication failed',
      ]);
      expect(await Array.fromAsync(agent.streamHistory())).toStrictEqual([]);
    });
  });

  it('records operational events without an accompanying display append', async () => {
    await withRecordingLifetimeFixture(async ({ agent, borrow }) => {
      const sibling = await borrow();
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'event context' }] },
      ]);
      await sibling.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'sibling context' }],
        },
      ]);
      await agent.session.setRecording({ enabled: true });
      await sibling.session.setRecording({ enabled: true });
      const path = agent.session.getRecording().path;
      const siblingPath = sibling.session.getRecording().path;
      if (path === undefined || siblingPath === undefined)
        throw new Error('Missing recorder paths');
      const recordEvent = agent.session.recordRecordingEvent.bind(
        agent.session,
      );
      await recordEvent({
        type: 'session_event',
        severity: 'warning',
        message: 'bootstrap operational warning',
      });
      await agent.session.flushRecording();
      await sibling.session.flushRecording();
      expect(await displayTexts(path)).toStrictEqual([
        'bootstrap operational warning',
      ]);
      expect(await displayTexts(siblingPath)).toStrictEqual([]);
      const reader = await NativeJournalPageReader.open(path);
      try {
        const severities: string[] = [];
        for await (const row of reader.entries()) {
          const presentation = await reader.presentation(row);
          if (presentation !== undefined)
            severities.push(presentation.descriptor.type);
        }
        expect(severities).toStrictEqual(['warning']);
      } finally {
        await reader.close();
      }
      expect(
        (await Array.fromAsync(agent.streamHistory())).map(
          ({ speaker, blocks }) => ({ speaker, blocks }),
        ),
      ).toStrictEqual([
        { speaker: 'human', blocks: [{ type: 'text', text: 'event context' }] },
      ]);
    });
  });

  it('persists facade display output through event recording and explicit flush', async () => {
    await withRecordingLifetimeFixture(async ({ agent, borrow }) => {
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'initial turn' }] },
      ]);
      const sibling = await borrow();
      await sibling.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'sibling turn' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      await sibling.session.setRecording({ enabled: true });
      const path = agent.session.getRecording().path;
      const siblingPath = sibling.session.getRecording().path;
      if (path === undefined || siblingPath === undefined)
        throw new Error('Missing recorder paths');
      await agent.session.appendDisplay({ type: 'warning' }, 'owner feedback');
      await agent.session.recordRecordingEvent({
        type: 'session_event',
        severity: 'warning',
        message: 'owner operation',
      });
      await agent.session.flushRecording();
      await sibling.session.flushRecording();
      expect(await displayTexts(path)).toStrictEqual([
        'owner feedback',
        'owner operation',
      ]);
      expect(await displayTexts(siblingPath)).toStrictEqual([]);
      expect(
        JSON.stringify(await Array.fromAsync(agent.streamHistory())),
      ).toContain('initial turn');
      expect(
        JSON.stringify(await Array.fromAsync(agent.streamHistory())),
      ).not.toContain('owner feedback');
    });
  });
});
