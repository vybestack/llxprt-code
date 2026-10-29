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
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { bindDiagnosticsReads } from '../commands/diagnosticsCommandHost.js';
import { bindCopyCommandHistoryRead } from '../commands/copyCommandHost.js';
import { useHistoryCommandOwners } from './useHistoryCommandOwners.js';

describe('history registration ownership', () => {
  const makeOwner = useCommandOwners();
  it('copies captured conversation output and replaces the mounted owner after retirement', async () => {
    const owner = await makeOwner('history-registration-owner');
    const peer = await makeOwner('history-registration-peer');
    await owner.session.replaceHistory([
      { speaker: 'ai', blocks: [{ type: 'text', text: 'Owned answer' }] },
    ]);
    const context = createMockCommandContext();
    const clipboard: string[] = [];
    const diagnostics = bindDiagnosticsReads(
      null,
      context.services.settings,
      () => [],
      context.runtimeApi.getLoadBalancerStats,
      context.runtimeApi.getLoadBalancerTokenAccounting,
      context.runtimeApi.getRuntimeDiagnosticsSnapshot,
      context.runtimeApi.getSessionTokenUsage,
      context.runtimeApi.providerStatus,
      context.oauthControl,
      () => false,
      () => false,
    );
    const hook = renderHook(
      ({ current }) =>
        useHistoryCommandOwners(
          Object.assign(
            { ...diagnostics },
            {
              getHistory: peer.streamHistory.bind(peer),
            },
          ),
          null,
          undefined,
          () => null,
          bindCopyCommandHistoryRead(
            current.session.isHistoryInitialized.bind(current.session),
            current.streamHistory.bind(current),
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
      await peer.session.replaceHistory([
        { speaker: 'ai', blocks: [{ type: 'text', text: 'Surviving answer' }] },
      ]);
      hook.rerender({ current: peer });
      await copy();
      expect(clipboard).toStrictEqual(['Owned answer', 'Surviving answer']);
    } finally {
      hook.unmount();
    }
  });
});
