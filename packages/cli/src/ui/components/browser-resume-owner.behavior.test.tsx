/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useOwnerSessionAgents } from '../hooks/__tests__/owner-session-agents.js';
import { readJournalItems } from '../stores/turn/read-journal-items.js';
import { createTurnStore } from '../stores/turn/turnStore.js';
import { bindOwnerBrowserResume } from './browserResumeHost.js';
import { resumeOwnerSession } from '../utils/resumeOwnerSession.js';

describe('session browser owned resume', () => {
  const openAgent = useOwnerSessionAgents();
  it('restores its application session and UI despite a closed invocation decoy', async () => {
    const { agent } = await openAgent();
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
    const { agent: owner } = await openAgent();
    await owner.setHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'owner live history' }],
      },
    ]);
    const { agent: decoy } = await openAgent();
    await decoy.dispose();
    const ui = createTurnStore();
    const resume = bindOwnerBrowserResume(
      (item) =>
        resumeOwnerSession(
          owner.session.resume.bind(owner.session),
          item.kind === 'session' ? item.session.sessionId : item.checkpointId,
          owner.session.listBrowserTargetsDetailed.bind(owner.session),
        ),
      ui.commands.refreshStatic,
      ui.commands.addItem,
      () => {},
    );
    await resume(target);
    expect(
      (await readJournalItems(owner)).map((item) =>
        'text' in item ? item.text : item.type,
      ),
    ).toStrictEqual(['browser saved history']);
    expect(await owner.session.getHistory()).toMatchObject([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'browser saved history' }],
      },
    ]);
  }, 30000);
});
