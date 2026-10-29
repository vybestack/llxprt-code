/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { basename } from 'node:path';
import { withRecordingLifetimeFixture } from './helpers/recording-owner-lifetime-fixture.js';
import { recordedRows } from './support/recorded-rows.js';
import { SessionDiscovery } from '@vybestack/llxprt-code-core/recording/SessionDiscovery.js';

for (const backend of ['journal']) {
  describe(`session control on ${backend}`, () => {
    it('seeds the first human preview when recording starts over deferred history', async () => {
      await withRecordingLifetimeFixture(async ({ agent }) => {
        await agent.setHistory([
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'earlier assistant message' }],
          },
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'first human preview' }],
          },
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'later human message' }],
          },
        ]);
        await agent.session.setRecording({ enabled: true });
        const path = agent.session.getRecording().path;
        if (path === undefined) throw new Error('Missing recording');
        await agent.session.setRecording({ enabled: false });
        expect(await SessionDiscovery.readFirstUserMessage(path)).toBe(
          'first human preview',
        );
      });
    }, 30000);

    it('does not seed a preview from a rejected deferred replacement', async () => {
      await withRecordingLifetimeFixture(async ({ agent, clientFor }) => {
        const history = clientFor(agent).getHistoryService();
        if (history === null) throw new Error('Missing history');
        await expect(
          history.detachedValues.replace(
            [
              {
                speaker: 'human',
                blocks: [{ type: 'text', text: 'rejected human preview' }],
              },
            ],
            undefined,
            {
              afterPublication: () => {
                throw new Error('reject replacement');
              },
            },
          ),
        ).rejects.toThrow('reject replacement');
        await agent.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'accepted human preview' }],
          },
        ]);
        await agent.session.setRecording({ enabled: true });
        const path = agent.session.getRecording().path;
        if (path === undefined) throw new Error('Missing recording');
        await agent.session.setRecording({ enabled: false });
        expect(await SessionDiscovery.readFirstUserMessage(path)).toBe(
          'accepted human preview',
        );
      });
    }, 30000);

    it('keeps retained replacement previews owned by their original session', async () => {
      await withRecordingLifetimeFixture(
        async ({ agent, borrow, clientFor, shareHistory }) => {
          const sibling = await borrow();
          await shareHistory(agent, sibling);
          const history = clientFor(agent).getHistoryService();
          if (history === null) throw new Error('Missing history');
          await history.detachedValues.replace(
            [
              {
                speaker: 'human',
                blocks: [{ type: 'text', text: 'first owner preview' }],
              },
            ],
            undefined,
            { origin: agent.session },
          );
          const retained = await Array.fromAsync(agent.streamHistory());
          await history.detachedValues.replace(retained, undefined, {
            origin: sibling.session,
          });
          await sibling.session.setRecording({ enabled: true });
          await sibling.session.recordRecordingTitle('Sibling recording');
          const siblingPath = sibling.session.getRecording().path;
          if (siblingPath === undefined) throw new Error('Missing recording');
          expect(
            await SessionDiscovery.readFirstUserMessage(siblingPath),
          ).toBeNull();
          await agent.session.setRecording({ enabled: true });
          const ownerPath = agent.session.getRecording().path;
          if (ownerPath === undefined) throw new Error('Missing recording');
          expect(await SessionDiscovery.readFirstUserMessage(ownerPath)).toBe(
            'first owner preview',
          );
        },
      );
    }, 30000);

    it('can record again after attachment succeeds but the subscription fails', async () => {
      await withRecordingLifetimeFixture(
        async ({ agent, config, clientFor }) => {
          await agent.setHistory([
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'before attachment failure' }],
            },
          ]);
          const history = clientFor(agent).getHistoryService();
          if (history === null) throw new Error('Missing history');
          const attach = history.attachJournal.bind(history);
          const fault = spyOn(history, 'attachJournal').mockImplementationOnce(
            async (...args) => {
              await attach(...args);
              throw new Error('subscription interrupted after attachment');
            },
          );
          try {
            await expect(
              agent.session.setRecording({ enabled: true }),
            ).rejects.toThrow('subscription interrupted after attachment');
          } finally {
            fault.mockRestore();
          }
          await agent.session.setRecording({ enabled: true });
          await agent.setHistory([
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'replacement recorder works' }],
            },
          ]);
          await agent.session.flushRecording();
          const path = agent.session.getRecording().path;
          if (path === undefined) throw new Error('Missing recording');
          const persisted = await recordedRows(
            path,
            basename(config.projectTempDir),
          );
          expect(persisted).toHaveLength(1);
          expect(JSON.stringify(persisted)).toContain(
            'replacement recorder works',
          );
          expect(await agent.session.getHistory()).toHaveLength(1);
          await agent.session.setRecording({ enabled: false });
        },
      );
    }, 30000);

    it('keeps mid-session recording, resume metadata and restart on one file', async () => {
      await withRecordingLifetimeFixture(async ({ agent, borrow, config }) => {
        await agent.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'before recording' }],
          },
        ]);
        await agent.session.setRecording({ enabled: true });
        const path = agent.session.getRecording().path;
        if (path === undefined) throw new Error('Missing recording');
        expect(agent.session.getRecording().format).toBe(
          backend === 'old' ? 'jsonl' : 'journal',
        );
        await agent.session.recordRecordingTitle('saved title');
        await agent.session.nameCurrentSession('named-recording');
        const checkpoint = await agent.session.createCheckpoint('saved-point');
        expect(
          (await agent.session.listCheckpoints()).map(
            (item) => item.checkpointId,
          ),
        ).toContain(checkpoint.checkpointId);
        const listed = await agent.session.listSessions();
        expect(listed[0].title).toBe('saved title');
        expect(listed[0].name).toBe('named-recording');
        await agent.session.setRecording({ enabled: false });
        const second = await borrow();
        const rows = await second.session.resume(listed[0].id);
        expect(JSON.stringify(await Array.fromAsync(rows))).toContain(
          'before recording',
        );
        await second.session.setRecording({ enabled: false });
        await second.setHistory([
          { speaker: 'human', blocks: [{ type: 'text', text: 'after stop' }] },
        ]);
        await second.session.setRecording({ enabled: true });
        expect(second.session.getRecording().path).toBe(path);
        await second.session.setRecording({ enabled: false });
        expect((await second.session.listSessions())[0].title).toBe(
          'saved title',
        );
        const persisted = await recordedRows(
          path,
          basename(config.projectTempDir),
        );
        expect(persisted).toHaveLength(1);
        expect(JSON.stringify(persisted)).toContain('after stop');
        expect(JSON.stringify(persisted)).not.toContain('before recording');
        await second.dispose();
        expect(await agent.session.getHistory()).toHaveLength(1);
      });
    }, 30000);
  });
}
