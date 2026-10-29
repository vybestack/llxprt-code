/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import type { SessionControl } from '../control/sessionControl.js';
import { createAgent } from '../createAgent.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import {
  openClientOwner,
  type OpenedClientOwner,
} from './helpers/client-owner-session.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { useRecordingPrompts } from './helpers/recording-prompts.js';

interface SharedHistorySessions {
  readonly opened: OpenedClientOwner;
  readonly owner: SessionControl;
  readonly peer: SessionControl;
}

/**
 * Two session controls the production `SessionClientOwner` builds over one
 * real client and history, so both observe and record the same history.
 */
async function withSharedHistorySessions(
  authority: Parameters<typeof openClientOwner>[0],
  scenario: (sessions: SharedHistorySessions) => Promise<void>,
): Promise<void> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'session-history-operations-')),
  );
  const opened = await openClientOwner(
    authority,
    {
      provider: 'fake',
      model: 'fake-model',
      workingDir: directory,
      interactive: true,
      harness: { includeProcessCwd: false },
    },
    { provider: 'fake', model: 'fake-model' },
  );
  const open = (runtimeId: string): SessionControl =>
    opened.owner.createSessionControl(
      'facade',
      () => runtimeId,
      (operation) => operation(),
      () => {},
      () => {},
      () => 'fake',
      () => 'fake-model',
    );
  const owner = open('history-operations-owner');
  const peer = open('history-operations-peer');
  try {
    await scenario({ opened, owner, peer });
  } finally {
    await runCleanupSteps([
      () => peer.dispose(),
      () => owner.dispose(),
      () => opened.close(),
      () => rm(directory, { recursive: true, force: true }),
    ]);
  }
}

describe('native session history operation lifetimes', () => {
  useRecordingPrompts();
  useFakeResponsesReplay('multi-turn-text.jsonl');
  const credentials = useOwnedCredentials();

  it('detaches observers without disposing the actual borrowed history or media owner', async () => {
    await withSharedHistorySessions(
      credentials().authority,
      async ({ opened, owner, peer }) => {
        await owner.replaceHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'borrowed history' }],
          },
        ]);
        const history = opened.client.getHistoryService();
        if (!history) throw new Error('Borrowed client has no history');
        history.syncTotalTokens(1000);
        await history.waitForTokenUpdates();
        const counts: number[] = [];
        const peerCounts: number[] = [];
        const deliveries: Array<{
          owner: 'owner' | 'peer';
          tokens: number;
        }> = [];
        const stop = owner.subscribeHistoryTokens((count) => {
          counts.push(count);
          deliveries.push({ owner: 'owner', tokens: count });
        });
        const stopPeer = peer.subscribeHistoryTokens((count) => {
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
        await owner.dispose();
        await peer.replaceHistory([
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
          (await Array.fromAsync(peer.readHistorySnapshot()?.messages ?? []))[0]
            .blocks,
        ).toStrictEqual([{ type: 'text', text: 'peer after owner disposal' }]);
        stopPeer();
        await opened.client.addHistory({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'still borrowed' }],
        });
        expect(
          (await Array.fromAsync(history.streamRawHistory())).slice(-1)[0]
            ?.blocks,
        ).toContainEqual({
          type: 'text',
          text: 'still borrowed',
        });
      },
    );
  });

  it('retains and releases native media references through the actual client history lease', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'session-history-media-')),
    );
    const mediaDirectory = join(directory, 'media');
    const media = new SessionMediaOwner(mediaDirectory, 1024 * 1024 * 1024);
    let agent: Awaited<ReturnType<typeof createAgent>> | undefined;
    try {
      agent = await createAgent({
        provider: 'fake',
        model: 'fake-model',
        credentialAuthority: credentials().authority,
        workingDir: directory,
        mediaOwner: media,
      });
      const reference = await media.store.admit({
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
        (
          await Array.fromAsync(
            agent.session.readHistorySnapshot()?.messages ?? [],
          )
        )[0].blocks,
      ).toContainEqual(reference);
      expect(
        await media.store.hasReservations(reference.selectedObject.contentId),
      ).toBe(true);
      await agent.session.replaceHistory([]);
      expect(
        await media.store.hasReservations(reference.selectedObject.contentId),
      ).toBe(false);
      expect(await media.store.readVerified(reference)).toStrictEqual(
        new Uint8Array([4, 5, 6]),
      );
    } finally {
      await runCleanupSteps([
        () => agent?.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    }
  });

  it('attributes replacement to the initiating recorder when facades share a borrowed client', async () => {
    await withSharedHistorySessions(
      credentials().authority,
      async ({ owner, peer }) => {
        await owner.replaceHistory([
          { speaker: 'human', blocks: [{ type: 'text', text: 'shared seed' }] },
        ]);
        await owner.setRecording({ enabled: true });
        await peer.replaceHistory([
          { speaker: 'human', blocks: [{ type: 'text', text: 'peer seed' }] },
        ]);
        await peer.setRecording({ enabled: true });
        await owner.replaceHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'owner-attributed replacement' }],
          },
        ]);
        await owner.flushRecording();
        await peer.flushRecording();
        const ownerPath = owner.getRecording().path;
        const peerPath = peer.getRecording().path;
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
