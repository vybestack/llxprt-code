/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { act } from 'react';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { renderHook } from '../../../../__tests__/render.js';
import { useCommandOwners } from '../../../../__tests__/command-owner-fixture.js';
import { useSessionInitialization } from './useSessionInitialization.js';

async function startSession(owner: Agent, decoy: Agent): Promise<void> {
  let finishWriting = (): void => {};
  const written = new Promise<void>((resolve) => {
    finishWriting = resolve;
  });
  const options = {
    ...{
      agent: decoy,
      uiRuntime: {
        memory: {
          getLlxprtMdFileCount: () => 0,
          getCoreMemoryFileCount: () => 0,
        },
        ephemeral: { getEphemeralSetting: () => undefined },
        agentClientSource: { getAgentClient: () => decoy.agentClient },
      },
    },
    triggerSessionStart: async () => ({
      additionalContext: `Loaded model ${owner.getModel()}`,
    }),
    appendHookContext: async (text: string) => {
      await owner.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text }],
      });
      finishWriting();
    },
    readEmojiFilterMode: () => 'auto' as const,
    readLlxprtMdFileCount: () => owner.memory.getFileCount(),
    readCoreMemoryFileCount: () => owner.memory.getCoreFileCount(),
    addItem: () => 0,
    loadHistory: () => {},
  };
  const hook = renderHook(() => useSessionInitialization(options));
  try {
    await act(async () => {
      await written;
    });
  } finally {
    hook.unmount();
  }
}

describe('session initialization operation ownership', () => {
  const makeOwner = useCommandOwners();
  it('appends hook context to its captured session and keeps the sibling usable after retirement', async () => {
    const owner = await makeOwner('initialize-owner');
    const sibling = await makeOwner('initialize-sibling');
    await startSession(owner, sibling);
    expect(
      (await owner.getHistory())
        .flatMap((entry) => entry.blocks)
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n'),
    ).toContain(`Loaded model ${owner.getModel()}`);
    expect(await sibling.getHistory()).toHaveLength(0);
    await owner.dispose();
    await startSession(sibling, owner);
    expect(await sibling.getHistory()).toHaveLength(1);
  });
});
