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
import { RuntimeContextProvider } from '../../__tests__/runtime-context-fixture.js';
import type { SlashCommand } from '../commands/types.js';
import { useProviderCommand } from './useProviderCommand.js';

async function invoke(command: SlashCommand, name: string): Promise<unknown> {
  const registry = await CommandService.create(
    [
      new BuiltinCommandLoader(
        { ...createUnconfiguredBuiltinOwners(), providerCommand: command },
        null,
      ),
    ],
    new AbortController().signal,
  );
  const action = registry
    .getCommands()
    .find((entry) => entry.name === 'provider')?.action;
  if (!action) throw new Error('Provider command was not registered');
  return action(createMockCommandContext(), name);
}

function unavailableAlias(): never {
  throw new Error('Alias persistence is unavailable in this provider fixture');
}

describe('provider registration ownership', () => {
  const makeOwner = useCommandOwners();
  it('uses captured provider operations and replaces them without consulting context authority', async () => {
    const owner = await makeOwner('provider-hook-owner');
    const peer = await makeOwner('provider-hook-peer');
    await peer.setProvider('openai');
    const context = createMockCommandContext();
    const hook = renderHook(
      ({ current }) =>
        useProviderCommand(
          Object.assign(current.getProvider.bind(current), {
            setProvider: peer.setProvider.bind(peer),
          }),
          () => ({ providerName: current.getProvider() }),
          current.getModel.bind(current),
          (name, options) => current.setProvider(name, undefined, options),
          unavailableAlias,
          async () => {},
          async (provider, model) =>
            current.session.recordRecordingEvent({
              type: 'provider_switch',
              provider,
              model,
            }),
        ),
      {
        initialProps: { current: owner },
        wrapper: ({ children }) => (
          <RuntimeContextProvider
            agent={peer}
            owner={context.runtimeApi}
            requestFetch={context.runtimeApi.fetch}
          >
            {children}
          </RuntimeContextProvider>
        ),
      },
    );
    try {
      expect(await invoke(hook.result.current, 'fake')).toMatchObject({
        messageType: 'info',
        content: 'Already using provider: fake',
      });
      await owner.dispose();
      hook.rerender({ current: peer });
      expect(await invoke(hook.result.current, 'openai')).toMatchObject({
        messageType: 'info',
        content: 'Already using provider: openai',
      });
      expect(await invoke(hook.result.current, 'fake')).toMatchObject({
        messageType: 'info',
        content: 'Switched from openai to fake',
      });
      expect(peer.getProvider()).toBe('fake');
    } finally {
      hook.unmount();
    }
  });
});
