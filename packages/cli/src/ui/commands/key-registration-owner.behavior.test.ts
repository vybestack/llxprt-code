/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ProviderKeyStorage,
  SecureStore,
} from '@vybestack/llxprt-code-storage';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { CommandService } from '../../services/CommandService.js';
import { createKeyCommand } from './keyCommand.js';
import { bindKeyCommandOperations } from './credentialCommandHost.js';

describe('key registration operations', () => {
  const makeOwner = useCommandOwners();
  it('saves and loads through captured storage and session operations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'key-registration-'));
    try {
      const owner = await makeOwner('key-registration-owner');
      const peer = await makeOwner('key-registration-peer');
      const storage = (label: string) =>
        new ProviderKeyStorage({
          secureStore: new SecureStore('key-registration', {
            keyringLoader: async () => null,
            fallbackDir: join(root, label),
            fallbackPolicy: 'allow',
          }),
        });
      const keys = storage('owner');
      const otherKeys = storage('peer');
      const names = Object.assign(() => keys.listKeys(), {
        getProviderKeys: () => otherKeys,
        listKeyCompletionNames: () => otherKeys.listKeys(),
        invalidateKeyCompletion: () => {},
        isInteractive: () => false,
        setEphemeralSetting: peer.setEphemeralSetting.bind(peer),
      });
      const registry = await CommandService.create(
        [
          new BuiltinCommandLoader(
            {
              ...createUnconfiguredBuiltinOwners(),
              keyCommand: createKeyCommand(
                bindKeyCommandOperations(
                  () => keys,
                  names,
                  () => {},
                  () => false,
                  owner.getProvider.bind(owner),
                  owner.auth.keys.setRaw.bind(owner.auth.keys),
                  owner.setEphemeralSetting.bind(owner),
                ),
              ),
            },
            null,
          ),
        ],
        new AbortController().signal,
      );
      const action = registry
        .getCommands()
        .find((command) => command.name === 'key')?.action;
      if (!action) throw new Error('Missing key command');
      expect(
        await action(createMockCommandContext(), 'save selected sk-captured'),
      ).toMatchObject({ messageType: 'info' });
      expect(await keys.listKeys()).toStrictEqual(['selected']);
      expect(await otherKeys.listKeys()).toStrictEqual([]);
      expect(
        await action(createMockCommandContext(), 'load selected'),
      ).toMatchObject({ messageType: 'info' });
      expect(owner.getEphemeralSetting('auth-key-name')).toBe('selected');
      expect(peer.getEphemeralSetting('auth-key-name')).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
