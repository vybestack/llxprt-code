/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { withRecordingLifetimeFixture } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { createTurnStore } from '../stores/turn/turnStore.js';
import { bindOwnerBrowserResume } from './browserResumeHost.js';
import { resumeOwnerSession } from '../utils/resumeOwnerSession.js';

describe('session browser owned resume', () => {
  it('restores its application session and UI despite a closed invocation decoy', async () => {
    await withRecordingLifetimeFixture(
      async (
        agent,
        _config,
        _settingsOwner,
        _settingsService,
        _oauthManager,
        borrow,
      ) => {
        await agent.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'browser saved history' }],
          },
        ]);
        await agent.session.setRecording({ enabled: true });
        const target = (await agent.session.listBrowserTargets()).find(
          (item) => item.kind === 'session',
        );
        if (!target) throw new Error('Missing browser target');
        await agent.session.setRecording({ enabled: false });
        const owner = await borrow();
        await owner.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'owner live history' }],
          },
        ]);
        const decoy = await borrow();
        await decoy.dispose();
        const ui = createTurnStore();
        const resume = bindOwnerBrowserResume(
          (item) =>
            resumeOwnerSession(
              owner.session.resume.bind(owner.session),
              item.kind === 'session'
                ? item.session.sessionId
                : item.checkpointId,
              'allowed',
              owner.session.listBrowserTargetsDetailed.bind(owner.session),
            ),
          ui.commands.loadHistory,
          ui.commands.addItem,
          () => {},
        );
        await resume(target);
        expect(
          ui.store
            .getState()
            .history.map((item) => ('text' in item ? item.text : item.type)),
        ).toStrictEqual(['browser saved history']);
        expect(await owner.session.getHistory()).toMatchObject([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'browser saved history' }],
          },
        ]);
      },
    );
  }, 30000);
});
