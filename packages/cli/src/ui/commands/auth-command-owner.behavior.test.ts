/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import {
  createUnconfiguredBuiltinOwners,
  unavailableAuthControl,
} from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { CommandService } from '../../services/CommandService.js';
import type { AuthCommandOperations } from './authCommand.js';
import { createAuthCommand } from './authCommand.js';
import { createCompletionHandler } from './schema/index.js';
import type { SlashCommand } from './types.js';

interface OAuthOwnerState {
  readonly enabled: Map<string, boolean>;
  readonly clearedProviders: string[];
  readonly loggedOut: string[];
}

/**
 * One session's OAuth owner: enablement state and bucket listings live in the
 * owner, and the control exposes only the operations /auth uses.
 */
function oauthOwner(buckets: readonly string[]): {
  readonly control: AuthCommandOperations;
  readonly state: OAuthOwnerState;
} {
  const state: OAuthOwnerState = {
    enabled: new Map([['codex', false]]),
    clearedProviders: [],
    loggedOut: [],
  };
  const control: AuthCommandOperations = {
    ...unavailableAuthControl(),
    getSupportedProviders: () => [...state.enabled.keys()],
    isOAuthEnabled: (provider) => state.enabled.get(provider) === true,
    toggleOAuthEnabled: async (provider) => {
      const next = state.enabled.get(provider) !== true;
      state.enabled.set(provider, next);
      return next;
    },
    isAuthenticated: async () => false,
    getHigherPriorityAuth: async () => null,
    listBuckets: async () => [...buckets],
    logout: async (provider, bucket) => {
      state.loggedOut.push(`${provider}:${bucket ?? ''}`);
    },
    clearSessionBucket: () => undefined,
    clearProviderClientCache: (provider) => {
      state.clearedProviders.push(provider);
    },
  };
  return { control, state };
}

async function registeredAuth(control: AuthCommandOperations) {
  const registry = await CommandService.create(
    [
      new BuiltinCommandLoader(
        {
          ...createUnconfiguredBuiltinOwners(),
          authCommand: createAuthCommand(control, () => true),
        },
        null,
      ),
    ],
    new AbortController().signal,
  );
  const command: SlashCommand | undefined = registry
    .getCommands()
    .find((item) => item.name === 'auth');
  if (!command?.action) throw new Error('/auth is unavailable');
  return command;
}

/** An invocation whose own OAuth control must never be consulted. */
function decoyInvocation() {
  return createMockCommandContext({
    oauthControl: {
      ...unavailableAuthControl(),
      isAvailable: () => true,
    },
  });
}

describe('auth command owner', () => {
  it('applies /auth to the owner it was registered with, not the invocation', async () => {
    const left = oauthOwner(['work']);
    const right = oauthOwner(['personal']);
    const leftAuth = await registeredAuth(left.control);
    const rightAuth = await registeredAuth(right.control);
    const decoy = decoyInvocation();

    expect(await leftAuth.action!(decoy, 'codex enable')).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'OAuth enabled for codex',
    });
    expect(left.state.enabled.get('codex')).toBe(true);
    expect(right.state.enabled.get('codex')).toBe(false);

    expect(await rightAuth.action!(decoy, 'codex')).toMatchObject({
      messageType: 'info',
      content: expect.stringContaining('DISABLED'),
    });
    expect(await leftAuth.action!(decoy, 'codex')).toMatchObject({
      content: expect.stringContaining('ENABLED'),
    });
  });

  it('completes buckets from the registered owner', async () => {
    const left = oauthOwner(['work']);
    const right = oauthOwner(['personal', 'team']);
    const decoy = decoyInvocation();
    const suggest = async (control: AuthCommandOperations) => {
      const schema = createAuthCommand(control, () => true).schema;
      if (schema === undefined) throw new Error('/auth has no schema');
      const result = await createCompletionHandler(schema, true)(
        decoy,
        {
          args: '',
          completedArgs: ['codex', 'login'],
          partialArg: '',
          commandPathLength: 1,
        },
        '/auth codex login ',
      );
      return result.suggestions.map((item) => item.value);
    };

    expect(await suggest(left.control)).toStrictEqual(['work']);
    expect(await suggest(right.control)).toStrictEqual(['personal', 'team']);
  });

  it('logs out and clears the cache of the registered owner only', async () => {
    const left = oauthOwner(['work']);
    const right = oauthOwner(['work']);
    const auth = await registeredAuth(left.control);

    expect(
      await auth.action!(decoyInvocation(), 'codex logout work'),
    ).toMatchObject({
      messageType: 'info',
      content: expect.stringContaining('logged out of codex'),
    });
    expect(left.state.loggedOut).toStrictEqual(['codex:work']);
    expect(left.state.clearedProviders).toStrictEqual(['codex']);
    expect(right.state.loggedOut).toStrictEqual([]);
    expect(right.state.clearedProviders).toStrictEqual([]);
  });
});
