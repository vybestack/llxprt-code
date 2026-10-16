/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { bindAutoPromptOperation } from './subagentCommandHost.js';

describe('automatic subagent prompt registration', () => {
  const makeOwner = useCommandOwners();

  it('generates through captured operations after an attached peer retires', async () => {
    const owner = await makeOwner('prompt-owner');
    const peer = await makeOwner('prompt-peer');
    const provider = Object.assign(owner.getProvider.bind(owner), {
      getProvider: peer.getProvider.bind(peer),
      agentClient: peer.agentClient,
      sessionClient: peer.sessionClient,
    });
    const generate = bindAutoPromptOperation(
      provider,
      () => owner.agentClient,
      owner.sessionClient.createDetachedAgentClient.bind(owner.sessionClient),
      () => undefined,
    );
    await peer.dispose();

    expect(await generate('Review the current change')).toBe('turn one reply');
    await owner.dispose();
    await expect(generate('Review a retired session')).rejects.toThrow(
      'Session client owner is disposed',
    );
    const survivor = await makeOwner('prompt-survivor');
    const generateSurvivor = bindAutoPromptOperation(
      survivor.getProvider.bind(survivor),
      () => survivor.agentClient,
      survivor.sessionClient.createDetachedAgentClient.bind(
        survivor.sessionClient,
      ),
      () => undefined,
    );
    expect(await generateSurvivor('Review another change')).toBe(
      'turn one reply',
    );
  });
});
