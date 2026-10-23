/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { renderHook } from '../../__tests__/render.js';
import { StreamingState } from '../types.js';
import { useSteer } from '../containers/AppContainer/hooks/useSteer.js';

async function runWithSteering(
  agent: Agent,
  steer: (text: string) => boolean,
): Promise<void> {
  let submitted = false;
  for await (const event of agent.stream('Start the admitted turn')) {
    if (event.type === 'error') throw new Error(event.error.message);
    if (event.type === 'text' && !submitted) {
      submitted = true;
      if (!steer('Include the owned follow-up'))
        throw new Error('Steering was not consumed');
    }
  }
}

async function historyText(agent: Agent): Promise<string> {
  return (await agent.getHistory())
    .flatMap((item) =>
      item.blocks.flatMap((block) =>
        block.type === 'text' ? [block.text] : [],
      ),
    )
    .join('\n');
}

describe('input steering operation ownership', () => {
  const makeOwner = useCommandOwners();
  it('steers the captured admission and replaces the callback after owner retirement', async () => {
    const owner = await makeOwner('input-steering-owner');
    const peer = await makeOwner('input-steering-peer');
    const callback = (agent: Agent, decoy: Agent) =>
      Object.assign(agent.injectSteer.bind(agent), {
        injectSteer: decoy.injectSteer.bind(decoy),
      });
    const rendered = renderHook(
      ({ injectSteer }) =>
        useSteer(injectSteer, StreamingState.Responding, (text) => ({
          text: text.toUpperCase(),
          blocked: false,
        })),
      { initialProps: { injectSteer: callback(owner, peer) } },
    );
    try {
      await runWithSteering(owner, rendered.result.current);
      expect(await historyText(owner)).toContain('INCLUDE THE OWNED FOLLOW-UP');
      expect(await historyText(peer)).not.toContain(
        'INCLUDE THE OWNED FOLLOW-UP',
      );
      await owner.dispose();
      rendered.rerender({ injectSteer: callback(peer, owner) });
      await runWithSteering(peer, rendered.result.current);
      expect(await historyText(peer)).toContain('INCLUDE THE OWNED FOLLOW-UP');
    } finally {
      rendered.unmount();
    }
  });
});
