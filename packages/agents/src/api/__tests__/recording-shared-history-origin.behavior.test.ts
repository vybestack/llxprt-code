import { useRecordingPrompts } from './helpers/recording-prompts.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, test, expect } from 'bun:test';
import { withRecordingLifetimeFixture } from './helpers/recording-owner-lifetime-fixture.js';
import { drain } from './helpers/agentHarness.js';
import { collectHistoryFixture } from '../../core/__tests__/support/collect-history-test-fixture.js';
import {
  withNativeRecordingFixture,
  nativeRows,
  requireRecordingPath,
  rowTexts,
} from './helpers/native-session-fixture.js';

async function recordingText(path: string): Promise<string> {
  return rowTexts(await nativeRows(path)).join('\n');
}

describe('shared history recording origin', () => {
  useRecordingPrompts();
  test('two recording facades on the same history append only their own turns', async () => {
    await withRecordingLifetimeFixture(async ({ agent, borrow }) => {
      const sibling = await borrow();
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'seed' }] },
      ]);
      await sibling.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'seed' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await sibling.session.setRecording({ enabled: true });
      const pathA = agent.session.getRecording().path;
      const pathB = sibling.session.getRecording().path;
      if (!pathA || !pathB) throw new Error('Missing journal');
      await drain(agent.stream('A-only-content-marker'));
      await drain(sibling.stream('B-only-content-marker'));
      const a = await recordingText(pathA);
      const b = await recordingText(pathB);
      expect(a).toContain('A-only-content-marker');
      expect(a).not.toContain('B-only-content-marker');
      expect(b).toContain('B-only-content-marker');
      expect(b).not.toContain('A-only-content-marker');
    });
  }, 30000);

  test('a facade starting after an owned turn does not seed the other owner turn', async () => {
    await withRecordingLifetimeFixture(
      async ({ agent, borrow, shareHistory }) => {
        const sibling = await borrow();
        await shareHistory(agent, sibling);
        await agent.setHistory([
          { speaker: 'human', blocks: [{ type: 'text', text: 'seed' }] },
        ]);
        await agent.session.setRecording({ enabled: true });
        await drain(agent.stream('A-before-B-start-marker'));
        await new Promise((resolve) => setTimeout(resolve, 1100));
        await sibling.session.setRecording({ enabled: true });
        const bPath = sibling.session.getRecording().path;
        if (!bPath) throw new Error('Missing B journal');
        expect(await recordingText(bPath)).not.toContain(
          'A-before-B-start-marker',
        );
      },
    );
  }, 30000);

  test('profile adoption keeps owner provenance on the same live history for late recording', async () => {
    await withRecordingLifetimeFixture(
      async ({ agent, borrow, clientFor, shareHistory }) => {
        const sibling = await borrow();
        await shareHistory(agent, sibling);
        await agent.setHistory([
          { speaker: 'human', blocks: [{ type: 'text', text: 'seed' }] },
        ]);
        await agent.session.setRecording({ enabled: true });
        const history = clientFor(agent).getHistoryService();
        if (!history) throw new Error('Missing history');
        await drain(agent.stream('A-before-profile-marker'));
        await agent.profiles.applySnapshot({
          version: 1,
          provider: 'fake',
          model: 'fake-model',
          modelParams: {},
          ephemeralSettings: {},
        });
        expect(
          (await collectHistoryFixture(history.streamRawHistory())).some(
            (content) =>
              content.blocks.some(
                (block) =>
                  block.type === 'text' &&
                  block.text === 'A-before-profile-marker',
              ),
          ),
        ).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 1100));
        await sibling.session.setRecording({ enabled: true });
        const bPath = sibling.session.getRecording().path;
        if (!bPath) throw new Error('Missing B journal');
        expect(await recordingText(bPath)).not.toContain(
          'A-before-profile-marker',
        );
      },
    );
  }, 30000);

  test('cleared owner content reintroduced by an unbound producer is seeded by a new recording', async () => {
    await withRecordingLifetimeFixture(
      async ({ agent, borrow, clientFor, shareHistory }) => {
        const sibling = await borrow();
        await shareHistory(agent, sibling);
        await agent.setHistory([
          { speaker: 'human', blocks: [{ type: 'text', text: 'seed' }] },
        ]);
        await agent.session.setRecording({ enabled: true });
        await drain(agent.stream('external-reuse-marker'));
        const history = clientFor(agent).getHistoryService();
        if (!history) throw new Error('Missing history');
        const reused = (
          await collectHistoryFixture(history.streamRawHistory())
        ).find((content) =>
          content.blocks.some(
            (block) =>
              block.type === 'text' && block.text === 'external-reuse-marker',
          ),
        );
        if (!reused) throw new Error('Missing committed content');
        await history.clear();
        history.add(reused);
        await new Promise((resolve) => setTimeout(resolve, 1100));
        await sibling.session.setRecording({ enabled: true });
        const path = sibling.session.getRecording().path;
        if (!path) throw new Error('Missing B journal');
        expect(await recordingText(path)).toContain('external-reuse-marker');
      },
    );
  }, 30000);

  test('external unbound history additions remain visible to both recording facades', async () => {
    await withRecordingLifetimeFixture(
      async ({ agent, borrow, clientFor, shareHistory }) => {
        const sibling = await borrow();
        await shareHistory(agent, sibling);
        await agent.setHistory([
          { speaker: 'human', blocks: [{ type: 'text', text: 'seed' }] },
        ]);
        await agent.session.setRecording({ enabled: true });
        await new Promise((resolve) => setTimeout(resolve, 1100));
        await sibling.session.setRecording({ enabled: true });
        const history = clientFor(agent).getHistoryService();
        if (!history) throw new Error('Missing shared history');
        await history.addBatch([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'external-batch-marker' }],
          },
        ]);
        history.add({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'external-sync-marker' }],
        });
        const aPath = agent.session.getRecording().path;
        const bPath = sibling.session.getRecording().path;
        if (!aPath || !bPath) throw new Error('Missing journal');
        await agent.session.setRecording({ enabled: false });
        await sibling.session.setRecording({ enabled: false });
        const a = await recordingText(aPath);
        const b = await recordingText(bPath);
        expect(a).toContain('external-batch-marker');
        expect(b).toContain('external-batch-marker');
        expect(a).toContain('external-sync-marker');
        expect(b).toContain('external-sync-marker');
      },
    );
  }, 30000);

  test('stopping and restarting A keeps B turns out of A and A turns out of B', async () => {
    await withRecordingLifetimeFixture(async ({ agent, borrow }) => {
      const sibling = await borrow();
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'seed' }] },
      ]);
      await sibling.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'seed' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await sibling.session.setRecording({ enabled: true });
      const aPath = agent.session.getRecording().path;
      const bPath = sibling.session.getRecording().path;
      if (!aPath || !bPath) throw new Error('Missing journal');
      await agent.session.setRecording({ enabled: false });
      await drain(sibling.stream('B-after-A-stop'));
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await agent.session.setRecording({ enabled: true });
      const resumedPath = agent.session.getRecording().path;
      if (!resumedPath) throw new Error('Missing restarted journal');
      await drain(agent.stream('A-after-A-restart'));
      const a = await recordingText(aPath);
      const b = await recordingText(bPath);
      expect(a).not.toContain('B-after-A-stop');
      expect(b).toContain('B-after-A-stop');
      expect(b).not.toContain('A-after-A-restart');
      expect(await recordingText(resumedPath)).toContain('A-after-A-restart');
      expect(await recordingText(resumedPath)).not.toContain('B-after-A-stop');
    });
  }, 30000);

  test('resuming A while B records keeps resumed turns out of B', async () => {
    await withRecordingLifetimeFixture(
      async ({ agent, borrow, shareHistory }) => {
        const sibling = await borrow();
        await shareHistory(agent, sibling);
        await agent.setHistory([
          { speaker: 'human', blocks: [{ type: 'text', text: 'seed' }] },
        ]);
        await agent.session.setRecording({ enabled: true });
        await agent.session.nameCurrentSession('A-origin-resume');
        await new Promise((resolve) => setTimeout(resolve, 1100));
        await sibling.session.setRecording({ enabled: true });
        const bPath = sibling.session.getRecording().path;
        if (!bPath) throw new Error('Missing B journal');
        await agent.session.setRecording({ enabled: false });
        const saved = (await agent.session.listSessions()).find(
          (session) => session.name === 'A-origin-resume',
        );
        if (!saved) throw new Error('Missing A session');
        await agent.session.resume(saved.id);
        await drain(agent.stream('A-resumed-content-marker'));
        const aPath = agent.session.getRecording().path;
        if (!aPath) throw new Error('Missing resumed journal');
        expect(await recordingText(aPath)).toContain(
          'A-resumed-content-marker',
        );
        expect(await recordingText(bPath)).not.toContain(
          'A-resumed-content-marker',
        );
      },
    );
  }, 30000);

  test('disposing A leaves B able to record its next turn', async () => {
    await withRecordingLifetimeFixture(async ({ agent, borrow }) => {
      const sibling = await borrow();
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'seed' }] },
      ]);
      await sibling.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'seed' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await sibling.session.setRecording({ enabled: true });
      const aPath = agent.session.getRecording().path;
      const bPath = sibling.session.getRecording().path;
      if (!aPath || !bPath) throw new Error('Missing journal');
      await agent.dispose();
      await drain(sibling.stream('B-after-A-dispose'));
      expect(await recordingText(bPath)).toContain('B-after-A-dispose');
      expect(await recordingText(aPath)).not.toContain('B-after-A-dispose');
    });
  }, 30000);

  test('failed shared history publication rolls back both prepared recording effects', async () => {
    await withNativeRecordingFixture(
      async ({ agent, borrow, clientFor, shareHistory }) => {
        const sibling = await borrow();
        await shareHistory(agent, sibling);
        await agent.setHistory([
          { speaker: 'human', blocks: [{ type: 'text', text: 'seed' }] },
        ]);
        await agent.session.setRecording({ enabled: true });
        await new Promise((resolve) => setTimeout(resolve, 1100));
        await sibling.session.setRecording({ enabled: true });
        const history = clientFor(agent).getHistoryService();
        if (!history) throw new Error('Missing shared history');
        await expect(
          history.addBatch(
            [
              {
                speaker: 'human',
                blocks: [{ type: 'text', text: 'rolled-back-marker' }],
              },
            ],
            undefined,
            {
              afterPublication: () => {
                throw new Error('reject publication');
              },
            },
          ),
        ).rejects.toThrow('reject publication');
        await expect(
          history.addBatch(
            [
              {
                speaker: 'human',
                blocks: [{ type: 'text', text: 'owned-rollback-marker' }],
              },
            ],
            undefined,
            {
              origin: agent.session,
              afterPublication: () => {
                throw new Error('reject owned publication');
              },
            },
          ),
        ).rejects.toThrow('reject owned publication');
        const aPath = agent.session.getRecording().path;
        const bPath = sibling.session.getRecording().path;
        if (!aPath || !bPath) throw new Error('Missing journal');
        await agent.session.setRecording({ enabled: false });
        await sibling.session.setRecording({ enabled: false });
        expect(await recordingText(aPath)).not.toContain('rolled-back-marker');
        expect(await recordingText(bPath)).not.toContain('rolled-back-marker');
        expect(await recordingText(aPath)).not.toContain(
          'owned-rollback-marker',
        );
        expect(await recordingText(bPath)).not.toContain(
          'owned-rollback-marker',
        );
      },
    );
  }, 30000);
});

describe('native shared history recording rollback', () => {
  useRecordingPrompts();
  test('restores both committed recording views after shared and owned rejection, then records continued owned appends', async () => {
    await withNativeRecordingFixture(
      async ({ agent, borrow, clientFor, shareHistory }) => {
        const sibling = await borrow();
        await shareHistory(agent, sibling);
        await agent.setHistory([
          { speaker: 'human', blocks: [{ type: 'text', text: 'native-seed' }] },
        ]);
        await agent.session.setRecording({ enabled: true });
        await sibling.session.setRecording({ enabled: true });
        const history = clientFor(agent).getHistoryService();
        if (!history) throw new Error('Missing shared history');
        const pathA = requireRecordingPath(agent.session.getRecording().path);
        const pathB = requireRecordingPath(sibling.session.getRecording().path);
        await agent.session.flushRecording();
        await sibling.session.flushRecording();
        const before = await Array.fromAsync(agent.streamHistory());
        expect(rowTexts(before)).toStrictEqual(['native-seed']);
        expect(await nativeRows(pathA)).toStrictEqual(before);
        expect(await nativeRows(pathB)).toStrictEqual(before);

        for (const origin of [undefined, agent.session]) {
          const failure = new Error('reject native publication');
          await expect(
            history.addBatch(
              [
                {
                  speaker: 'human',
                  blocks: [{ type: 'text', text: 'native-rejected-marker' }],
                },
              ],
              undefined,
              {
                origin,
                afterPublication: () => {
                  throw failure;
                },
              },
            ),
          ).rejects.toBe(failure);
          await agent.session.flushRecording();
          await sibling.session.flushRecording();
          expect(await Array.fromAsync(agent.streamHistory())).toStrictEqual(
            before,
          );
          expect(await nativeRows(pathA)).toStrictEqual(before);
          expect(await nativeRows(pathB)).toStrictEqual(before);
        }

        await history.addBatch([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'native-shared-after-rollback' }],
          },
        ]);
        for (const [origin, text] of [
          [agent.session, 'native-A-after-rollback'],
          [sibling.session, 'native-B-after-rollback'],
        ] satisfies ReadonlyArray<readonly [object, string]>) {
          await history.addBatch(
            [
              { speaker: 'human', blocks: [{ type: 'text', text }] },
              {
                speaker: 'ai',
                blocks: [{ type: 'text', text: 'continued owner reply' }],
              },
            ],
            undefined,
            { origin },
          );
        }
        await agent.session.flushRecording();
        await sibling.session.flushRecording();
        const a = await nativeRows(pathA);
        const b = await nativeRows(pathB);
        expect(a).toHaveLength(4);
        expect(b).toHaveLength(4);
        expect(a[0]).toStrictEqual(before[0]);
        expect(b[0]).toStrictEqual(before[0]);
        expect(rowTexts(a)).toContain('native-shared-after-rollback');
        expect(rowTexts(b)).toContain('native-shared-after-rollback');
        expect(rowTexts(a)).toContain('native-A-after-rollback');
        expect(rowTexts(b)).toContain('native-B-after-rollback');
        expect(rowTexts(a)).not.toContain('native-B-after-rollback');
        expect(rowTexts(b)).not.toContain('native-A-after-rollback');
        await agent.session.setRecording({ enabled: false });
        await sibling.session.setRecording({ enabled: false });
        expect(await nativeRows(pathA)).toStrictEqual(a);
        expect(await nativeRows(pathB)).toStrictEqual(b);
      },
    );
  }, 30000);
});
