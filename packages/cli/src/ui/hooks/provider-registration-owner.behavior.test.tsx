/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgent, type Agent } from '@vybestack/llxprt-code-agents';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/types.js';
import { renderHook } from '../../__tests__/render.js';
import { useFakeResponsesReplay } from '../../../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import { useOwnedCredentials } from '../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { createRecordingProvider } from '../../../../agents/src/api/__tests__/helpers/recording-provider.js';
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
  useFakeResponsesReplay('multi-turn-text.jsonl');
  const credentials = useOwnedCredentials();
  const directories: string[] = [];
  const agents: Agent[] = [];

  afterEach(async () => {
    try {
      await Promise.all(agents.splice(0).map((agent) => agent.dispose()));
    } finally {
      await Promise.all(
        directories
          .splice(0)
          .map((directory) => rm(directory, { recursive: true, force: true })),
      );
    }
  });

  async function makeOwner(
    label: string,
    providerContributions?: ProviderContributionRegistry,
    provider = 'fake',
    model = `${label}-initial`,
  ): Promise<Agent> {
    const workingDir = await realpath(
      await mkdtemp(join(tmpdir(), 'provider-registration-owner-')),
    );
    directories.push(workingDir);
    const agent = await createAgent({
      credentialAuthority: credentials().authority,
      provider,
      model,
      workingDir,
      sessionId: 'same-command-owner-label',
      providerContributions,
      harness: {
        forceInteractive: false,
        forceConfirmations: false,
        includeProcessCwd: false,
      },
      lsp: false,
    });
    agents.push(agent);
    return agent;
  }

  it('uses captured provider operations and replaces them without consulting context authority', async () => {
    const contributed = createRecordingProvider({
      alias: 'provider-hook-contributed',
    });
    const owner = await makeOwner('provider-hook-owner');
    const peer = await makeOwner(
      'provider-hook-peer',
      contributed.contributions,
      contributed.alias,
      'recording-default',
    );
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
      expect(
        await invoke(hook.result.current, contributed.alias),
      ).toMatchObject({
        messageType: 'info',
        content: `Already using provider: ${contributed.alias}`,
      });
      expect(await invoke(hook.result.current, 'fake')).toMatchObject({
        messageType: 'info',
        content: `Switched from ${contributed.alias} to fake`,
      });
      expect(peer.getProvider()).toBe('fake');
    } finally {
      hook.unmount();
    }
  });
});
