/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { CommandService } from '../../services/CommandService.js';
import { createBaseurlCommand } from './baseurlCommand.js';
import { createLogoutCommand } from './logoutCommand.js';
import {
  bindBaseurlCommandOperations,
  bindLogoutCommandOperations,
} from './credentialCommandHost.js';

async function commandAction(
  name: string,
  command: ReturnType<typeof createBaseurlCommand>,
) {
  const registry = await CommandService.create(
    [
      new BuiltinCommandLoader(
        { ...createUnconfiguredBuiltinOwners(), [name + 'Command']: command },
        null,
      ),
    ],
    new AbortController().signal,
  );
  const action = registry
    .getCommands()
    .find((item) => item.name === name)?.action;
  if (!action) throw new Error(`Missing ${name} command`);
  return action;
}

describe('credential registration callbacks', () => {
  const makeOwner = useCommandOwners();
  it('updates the captured endpoint with a retired session attached to the writer', async () => {
    const owner = await makeOwner('endpoint-registration-owner');
    const peer = await makeOwner('endpoint-registration-peer');
    await peer.dispose();
    const action = await commandAction(
      'baseurl',
      createBaseurlCommand(
        bindBaseurlCommandOperations(
          () => owner.getProvider(),
          Object.assign((url: string | null) => owner.auth.setBaseUrl(url), {
            getProvider: () => peer.getProvider(),
            auth: peer.auth,
          }),
        ),
      ),
    );
    expect(
      await action(
        createMockCommandContext(),
        ' https://owned.example.test/v1 ',
      ),
    ).toMatchObject({
      messageType: 'info',
      content: expect.stringContaining('fake'),
    });
    expect(owner.getProviderStatus().baseUrl).toBe(
      'https://owned.example.test/v1',
    );
    await action(createMockCommandContext(), '');
    expect(owner.getProviderStatus().baseUrl).toBeUndefined();
  });
  it('validates logout with the captured provider catalog rather than attached methods', async () => {
    const owner = await makeOwner('logout-registration-owner');
    const action = await commandAction(
      'logout',
      createLogoutCommand(
        bindLogoutCommandOperations(
          Object.assign(
            () => owner.listProviders().map((provider) => provider.name),
            { listProviders: () => [] },
          ),
          (provider: string) => owner.auth.status(provider) === 'authenticated',
          (provider: string) => owner.auth.logout(provider),
          'Supported',
        ),
      ),
    );
    expect(
      await action(createMockCommandContext(), owner.getProvider()),
    ).toMatchObject({ messageType: 'info' });
    expect(
      await action(createMockCommandContext(), 'not-a-provider'),
    ).toMatchObject({
      messageType: 'error',
      content: expect.stringContaining('Supported: fake'),
    });
  });
});
