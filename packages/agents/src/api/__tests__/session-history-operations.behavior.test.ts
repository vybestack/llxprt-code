/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  useRecordingPrompts,
  withRecordingLifetimeFixture,
} from './helpers/recording-owner-lifetime-fixture.js';

describe('native session history operation lifetimes', () => {
  useRecordingPrompts();

  it('detaches observers without disposing the actual borrowed history or media owner', async () => {
    await withRecordingLifetimeFixture(
      async (
        agent,
        _config,
        _settingsOwner,
        _settings,
        _oauth,
        borrow,
        _chats,
        _history,
        resources,
      ) => {
        const peer = await borrow();
        await agent.session.replaceHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'borrowed history' }],
          },
        ]);
        const history = resources.client.getHistoryService();
        if (!history) throw new Error('Borrowed client has no history');
        history.syncTotalTokens(1000);
        await history.waitForTokenUpdates();
        const counts: number[] = [];
        const peerCounts: number[] = [];
        const deliveries: Array<{
          owner: 'owner' | 'peer';
          tokens: number;
        }> = [];
        const stop = agent.session.subscribeHistoryTokens((count) => {
          counts.push(count);
          deliveries.push({ owner: 'owner', tokens: count });
        });
        const stopPeer = peer.session.subscribeHistoryTokens((count) => {
          peerCounts.push(count);
          deliveries.push({ owner: 'peer', tokens: count });
        });
        await sleep(150);
        expect(counts).toStrictEqual([1000]);
        expect(peerCounts).toStrictEqual([1000]);
        stop();
        history.syncTotalTokens(2000);
        await history.waitForTokenUpdates();
        await sleep(150);
        expect(history.getTotalTokens()).toBe(2000);
        expect(deliveries).toStrictEqual([
          { owner: 'owner', tokens: 1000 },
          { owner: 'peer', tokens: 1000 },
          { owner: 'peer', tokens: 2000 },
        ]);
        expect(peerCounts).toStrictEqual([1000, 2000]);
        await agent.dispose();
        await peer.session.replaceHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'peer after owner disposal' }],
          },
        ]);
        history.syncTotalTokens(3000);
        await history.waitForTokenUpdates();
        await sleep(150);
        expect(history.getTotalTokens()).toBe(3000);
        expect(deliveries).toStrictEqual([
          { owner: 'owner', tokens: 1000 },
          { owner: 'peer', tokens: 1000 },
          { owner: 'peer', tokens: 2000 },
          { owner: 'peer', tokens: 2002 },
          { owner: 'peer', tokens: 3000 },
        ]);
        expect(peerCounts[peerCounts.length - 1]).toBe(3000);
        expect(
          peer.session.readHistorySnapshot()?.messages[0].blocks,
        ).toStrictEqual([{ type: 'text', text: 'peer after owner disposal' }]);
        stopPeer();
        await resources.client.addHistory({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'still borrowed' }],
        });
        expect(
          history.getAll()[history.getAll().length - 1]?.blocks,
        ).toContainEqual({
          type: 'text',
          text: 'still borrowed',
        });
        const reference = await resources.media.admit({
          bytes: new Uint8Array([1, 2, 3]),
          mimeType: 'image/png',
          semanticMetadata: {},
        });
        expect(await resources.media.readVerified(reference)).toStrictEqual(
          new Uint8Array([1, 2, 3]),
        );
      },
    );
  });

  it('retains and releases native media references through the actual client history lease', async () => {
    await withRecordingLifetimeFixture(
      async (
        agent,
        _config,
        _settingsOwner,
        _settings,
        _oauth,
        _borrow,
        _chats,
        _history,
        resources,
      ) => {
        const reference = await resources.media.admit({
          bytes: new Uint8Array([4, 5, 6]),
          mimeType: 'image/png',
          semanticMetadata: { caption: 'attachment' },
        });
        await agent.session.replaceHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'inspect attachment' }, reference],
          },
        ]);
        expect(
          agent.session.readHistorySnapshot()?.messages[0].blocks,
        ).toContainEqual(reference);
        expect(
          await resources.media.hasReservations(
            reference.selectedObject.contentId,
          ),
        ).toBe(true);
        await agent.session.replaceHistory([]);
        expect(
          await resources.media.hasReservations(
            reference.selectedObject.contentId,
          ),
        ).toBe(false);
        expect(await resources.media.readVerified(reference)).toStrictEqual(
          new Uint8Array([4, 5, 6]),
        );
      },
    );
  });

  it('attributes replacement to the initiating recorder when facades share a borrowed client', async () => {
    await withRecordingLifetimeFixture(
      async (agent, _config, _settingsOwner, _settings, _oauth, borrow) => {
        const peer = await borrow();
        await agent.session.replaceHistory([
          { speaker: 'human', blocks: [{ type: 'text', text: 'shared seed' }] },
        ]);
        await agent.session.setRecording({ enabled: true });
        await peer.session.replaceHistory([
          { speaker: 'human', blocks: [{ type: 'text', text: 'peer seed' }] },
        ]);
        await peer.session.setRecording({ enabled: true });
        await agent.session.replaceHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'owner-attributed replacement' }],
          },
        ]);
        await agent.session.flushRecording();
        await peer.session.flushRecording();
        const ownerPath = agent.session.getRecording().path;
        const peerPath = peer.session.getRecording().path;
        if (!ownerPath || !peerPath) throw new Error('Recordings missing');
        expect(await readFile(ownerPath, 'utf8')).toContain(
          'owner-attributed replacement',
        );
        expect(await readFile(peerPath, 'utf8')).not.toContain(
          'owner-attributed replacement',
        );
      },
    );
  });
});
