/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import { act } from 'react';
import { HookEventName } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { renderHook } from '../../__tests__/render.js';
import {
  useExitHandling,
  type UseExitHandlingResult,
} from '../containers/AppContainer/hooks/useExitHandling.js';

void vi.mock('../utils/terminalProtocolCleanup.js', () => ({
  restoreTerminalProtocolsSync: () => {},
}));

async function quit(input: UseExitHandlingResult): Promise<number> {
  let finish: (code: number) => void = () => {
    throw new Error('Exit observer was not initialized');
  };
  const completed = new Promise<number>((resolve) => {
    finish = resolve;
  });
  const exit = vi.fn<typeof process.exit>();
  const observer = vi.spyOn(process, 'exit').mockImplementation((code) => {
    finish(Number(code));
    return exit(code);
  });
  try {
    act(() =>
      input.setQuittingMessages([{ id: 1, type: 'info', text: 'bye' }]),
    );
    return await completed;
  } finally {
    observer.mockRestore();
    act(() => input.setQuittingMessages(null));
  }
}

describe('input exit lifecycle ownership', () => {
  const makeOwner = useCommandOwners();
  it('ends the captured session and replaces the mounted callback after retirement', async () => {
    const owner = await makeOwner('input-exit-owner');
    const peer = await makeOwner('input-exit-peer');
    const ended: string[] = [];
    const observe = (agent: Agent, label: string) =>
      agent.hooks.onHookExecution((request) => {
        if (request.event === HookEventName.SessionEnd) ended.push(label);
      });
    const stopOwner = observe(owner, 'owner');
    const stopPeer = observe(peer, 'peer');
    const rendered = renderHook(
      ({ current, decoy }) =>
        useExitHandling(
          Object.assign(
            {
              handleSlashCommand: async (): Promise<false> => false,
              config: {
                endHookSession: decoy.hooks.triggerSessionEnd.bind(decoy.hooks),
                getEnableHooks: () => false,
                getDisabledHooks: () => [],
                setDisabledHooks: () => {},
                isSkillsSupportEnabled: () => false,
                getEnableHooksUI: () => false,
                isAdminSkillsEnabled: () => false,
              },
            },
            {
              endHookSession: current.hooks.triggerSessionEnd.bind(
                current.hooks,
              ),
            },
          ),
        ),
      { initialProps: { current: owner, decoy: peer } },
    );
    try {
      expect(await quit(rendered.result.current)).toBe(0);
      expect(ended).toStrictEqual(['owner']);
      stopOwner();
      await owner.dispose();
      act(() => rendered.rerender({ current: peer, decoy: owner }));
      expect(await quit(rendered.result.current)).toBe(0);
      expect(ended).toStrictEqual(['owner', 'peer']);
    } finally {
      rendered.unmount();
      stopOwner();
      stopPeer();
    }
  });
});
