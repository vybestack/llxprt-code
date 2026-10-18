/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createContinueRegistration } from './useContinueCommand.js';

describe('registered continuation discovery', () => {
  const makeOwner = useCommandOwners();
  it('completes the captured session after another session retires', async () => {
    const owner = await makeOwner('continue-discovery-owner');
    const sibling = await makeOwner('continue-discovery-sibling');
    await owner.setHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'captured continuation' }],
      },
    ]);
    await owner.session.setRecording({ enabled: true });
    await owner.session.nameCurrentSession('captured-discovery');
    const session = owner.session;
    const command = createContinueRegistration(
      session.exportSession.bind(session),
      () => true,
      session.listBrowserTargets.bind(session),
      () => owner.workspace.getWorkingDirectory(),
      () => 'same-label',
      owner.agentClient.mediaStore,
      'agent',
    );
    await sibling.dispose();
    const target = command.schema?.[0];
    if (target?.kind !== 'value' || !target.completer)
      throw new Error('Missing continuation completion');
    const options = await target.completer(createMockCommandContext(), '', {
      tokens: [],
      partialToken: '',
      hasTrailingSpace: false,
      position: 0,
    });
    const completions = options.map((option) => option.value);
    expect(completions).toContain('captured-discovery');
    expect(completions).not.toContain('continue-discovery-sibling');
  });
});
