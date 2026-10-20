/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { generateAutoPrompt } from '../utils/autoPromptGenerator.js';

describe('automatic subagent prompt registration', () => {
  const makeOwner = useCommandOwners();

  it('generates through captured operations after an attached peer retires', async () => {
    const owner = await makeOwner('prompt-owner');
    const peer = await makeOwner('prompt-peer');
    const operation = Object.assign(owner.generate.bind(owner), {
      generate: peer.generate.bind(peer),
    });
    const generate = (description: string): Promise<string> =>
      generateAutoPrompt(description, operation);
    await peer.dispose();

    expect(await generate('Review the current change')).toBe('turn one reply');
    await owner.dispose();
    await expect(generate('Review a retired session')).rejects.toThrow(
      'Agent is closed',
    );
    const survivor = await makeOwner('prompt-survivor');
    const survivorOperation = survivor.generate.bind(survivor);
    const generateSurvivor = (description: string): Promise<string> =>
      generateAutoPrompt(description, survivorOperation);
    expect(await generateSurvivor('Review another change')).toBe(
      'turn one reply',
    );
  });
});
