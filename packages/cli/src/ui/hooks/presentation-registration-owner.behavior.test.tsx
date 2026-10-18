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
import { bindAboutDetails } from '../commands/aboutCommandHost.js';
import type { SlashCommand } from '../commands/types.js';
import { usePresentationCommands } from './usePresentationCommands.js';

async function clear(command: SlashCommand): Promise<void> {
  const registry = await CommandService.create(
    [
      new BuiltinCommandLoader(
        { ...createUnconfiguredBuiltinOwners(), clearCommand: command },
        null,
      ),
    ],
    new AbortController().signal,
  );
  const action = registry
    .getCommands()
    .find((entry) => entry.name === 'clear')?.action;
  if (!action) throw new Error('Clear command was not registered');
  await action(createMockCommandContext(), '');
}

describe('presentation registration ownership', () => {
  const makeOwner = useCommandOwners();
  it('clears the captured session and replaces operations on the same mount after retirement', async () => {
    const owner = await makeOwner('presentation-owner');
    const peer = await makeOwner('presentation-peer');
    const context = createMockCommandContext();
    await owner.setHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'owned conversation' }],
      },
    ]);
    await peer.setHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'surviving conversation' }],
      },
    ]);
    const hook = renderHook(
      ({ current }) =>
        usePresentationCommands(
          Object.assign(
            bindAboutDetails(
              () => context.runtimeApi.getRuntimeDiagnosticsSnapshot(),
              () => context.runtimeApi.getActiveProviderName(),
              () => context.runtimeApi.getActiveProviderDetails(),
              (key) => context.runtimeApi.getEphemeralSetting(key),
              () => undefined,
              () => undefined,
              () => undefined,
              () => '',
              () => context.runtimeApi.providerStatus(),
              (provider) =>
                context.services.settings.getProviderKeyfile(provider),
            ),
            {
              hooks: peer.hooks,
              session: peer.session,
            },
          ),
          undefined,
          current.hooks.triggerSessionEnd.bind(current.hooks),
          current.session.startNewSession.bind(current.session),
          current.hooks.triggerSessionStart.bind(current.hooks),
          context.ui.addItem,
          context.ui.setDebugMessage,
          context.ui.updateHistoryTokenCount,
          () => {},
          () => {},
          true,
          context.ui.toggleVimEnabled,
          context.ui.toggleDebugProfiler,
        ),
      { initialProps: { current: owner } },
    );
    try {
      await clear(hook.result.current.clearCommand);
      expect(await owner.getHistory()).toStrictEqual([]);
      expect(JSON.stringify(await peer.getHistory())).toContain(
        'surviving conversation',
      );
      await owner.dispose();
      hook.rerender({ current: peer });
      await clear(hook.result.current.clearCommand);
      expect(await peer.getHistory()).toStrictEqual([]);
    } finally {
      hook.unmount();
    }
  });
});
