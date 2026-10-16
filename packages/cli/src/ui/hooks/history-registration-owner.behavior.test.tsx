/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { renderHook } from '../../__tests__/render.js';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { CommandService } from '../../services/CommandService.js';
import { bindDiagnosticsReads } from '../commands/diagnosticsCommandHost.js';
import { bindCopyCommandHistoryRead } from '../commands/copyCommandHost.js';
import { useHistoryCommandOwners } from './useHistoryCommandOwners.js';

describe('history registration ownership', () => {
  const makeOwner = useCommandOwners();
  it('copies captured conversation output and replaces the mounted owner after retirement', async () => {
    const owner = await makeOwner('history-registration-owner');
    const peer = await makeOwner('history-registration-peer');
    await owner.setHistory([
      { speaker: 'ai', blocks: [{ type: 'text', text: 'Owned answer' }] },
    ]);
    await owner.agentClient.startChat(await owner.agentClient.getHistory());
    const context = createMockCommandContext();
    const clipboard: string[] = [];
    const diagnostics = bindDiagnosticsReads(
      null,
      context.services.settings,
      () => [],
      context.runtimeApi,
      context.oauthControl,
    );
    const hook = renderHook(
      ({ current }) =>
        useHistoryCommandOwners(
          Object.assign(
            { ...diagnostics },
            {
              agentClient: peer.agentClient,
              getHistory: peer.getHistory.bind(peer),
            },
          ),
          null,
          undefined,
          () => null,
          bindCopyCommandHistoryRead(
            current.agentClient.hasChatInitialized.bind(current.agentClient),
            current.getHistory.bind(current),
          ),
          async (text) => {
            clipboard.push(text);
          },
          null,
          {
            dumpDirectory: '',
            readMode: () => 'off',
            writeMode: () => {},
            dumpNow: async () => {
              throw new Error('Unexpected context dump');
            },
          },
          null,
        ),
      { initialProps: { current: owner } },
    );
    async function copy(): Promise<void> {
      const registry = await CommandService.create(
        [
          new BuiltinCommandLoader(
            { ...createUnconfiguredBuiltinOwners(), ...hook.result.current },
            null,
          ),
        ],
        new AbortController().signal,
      );
      const action = registry
        .getCommands()
        .find((entry) => entry.name === 'copy')?.action;
      if (!action) throw new Error('Missing registered copy command');
      await action(context, '');
    }
    try {
      await copy();
      expect(clipboard).toStrictEqual(['Owned answer']);
      await owner.dispose();
      await peer.setHistory([
        { speaker: 'ai', blocks: [{ type: 'text', text: 'Surviving answer' }] },
      ]);
      await peer.agentClient.startChat(await peer.agentClient.getHistory());
      hook.rerender({ current: peer });
      await copy();
      expect(clipboard).toStrictEqual(['Owned answer', 'Surviving answer']);
    } finally {
      hook.unmount();
    }
  });
});
