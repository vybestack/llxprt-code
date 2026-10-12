/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Profile } from '@vybestack/llxprt-code-settings';

type StorageMode = 'not-found' | 'error' | 'resolved';

interface KeyStorageController {
  mode: StorageMode;
  resolvedValue: string | null | undefined;
  error: Error | null;
  entries: Map<string, string>;
}

let keyStorage: KeyStorageController = {
  mode: 'not-found',
  resolvedValue: null,
  error: null,
  entries: new Map(),
};

function authKeyNameSetting(
  omit: boolean,
  nameValue: unknown,
): Record<string, unknown> {
  return omit ? {} : { 'auth-key-name': nameValue };
}

let tempDir: string | null = null;

function createProviderKeyStorageDouble() {
  return {
    getKey(name: string): Promise<string | null | undefined> {
      if (keyStorage.mode === 'error') {
        return Promise.reject(
          keyStorage.error ?? new Error('key storage error'),
        );
      }
      if (keyStorage.mode === 'resolved') {
        return Promise.resolve(keyStorage.resolvedValue);
      }
      return Promise.resolve(keyStorage.entries.get(name) ?? null);
    },
  };
}

import { useProfileOwner as installProfileOwner } from './profile-workflow-owner-fixture.js';
import { assembleModelSelection } from '../providerMutations.js';
const root = installProfileOwner();

await mock.module('../../auth/index.js', () => ({
  createProviderKeyStorage: () => createProviderKeyStorageDouble(),
}));
import type { ProviderSwitcher } from '../providerSwitch.js';

const stubSwitchProvider: ProviderSwitcher = async (name) => {
  root().manager.setActiveProvider(name);
  root().settings.set('activeProvider', name);
  return {
    infoMessages: [],
    changed: true,
    previousProvider: null,
    nextProvider: name,
  };
};

const { applyProfileCascade } = await import('../profileApplication.js');

function applyProfileForTest(
  profile: Profile,
  options: Parameters<typeof applyProfileCascade>[1],
  switchProvider: ProviderSwitcher,
): ReturnType<typeof applyProfileCascade> {
  return applyProfileCascade(
    profile,
    options,
    root().config,
    root().settings,
    root().manager,
    root().store,
    switchProvider,
    assembleModelSelection(root().settingsOwner),
    {
      readEndpoint: () => root().settingsOwner.readSelectedEndpoint(),
      applyParameter: (key, value) =>
        root().settingsOwner.writeUserParameter(key, value),
    },
  );
}

function standardProfile(authKeyName: unknown): Profile {
  return {
    version: 1,
    provider: 'openai',
    model: 'gpt-4o',
    modelParams: {},
    ephemeralSettings: { 'auth-key-name': authKeyName },
  };
}

function providerAuthKey(): unknown {
  return root().settings.getProviderSettings('openai')['auth-key'];
}

async function captureRejection(
  promise: Promise<unknown>,
): Promise<{ thrown: unknown; message: string }> {
  return promise.then(
    () => ({ thrown: undefined, message: '' }),
    (error: unknown) => ({
      thrown: error,
      message: error instanceof Error ? error.message : String(error),
    }),
  );
}

function asError(value: unknown): Error | undefined {
  return value instanceof Error ? value : undefined;
}

describe('issue #2916: unresolved auth-key-name rejects profile application', () => {
  beforeEach(() => {
    root().manager.setActiveProvider('openai');
    root().settingsOwner.initializeProviderSelection('openai', 'gpt-4o');
    keyStorage = {
      mode: 'not-found',
      resolvedValue: null,
      error: null,
      entries: new Map(),
    };
    tempDir = null;
  });

  afterEach(() => {
    if (tempDir !== null) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects when provider key storage returns no secret for a named key', async () => {
    keyStorage.mode = 'not-found';

    const { thrown, message } = await captureRejection(
      applyProfileForTest(standardProfile('work-key'), {}, stubSwitchProvider),
    );

    expect(thrown).toBeDefined();
    expect(message).toContain("Named key 'work-key' not found");
    expect(message).toContain('/key save work-key');
  });

  it('rejects with the original storage error as cause', async () => {
    const storageError = new Error('keyring backend unavailable');
    keyStorage.mode = 'error';
    keyStorage.error = storageError;

    const { thrown, message } = await captureRejection(
      applyProfileForTest(standardProfile('prod-key'), {}, stubSwitchProvider),
    );

    const thrownError = asError(thrown);
    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError?.cause).toBe(storageError);
    expect(thrownError?.cause).toBeInstanceOf(Error);
    expect(message).toContain("'prod-key'");
    expect(message).toContain('keyring backend unavailable');
    // A retrieval fault must not advertise the '/key save' remedy: the key may
    // already be stored and re-saving would overwrite it while leaving the
    // real fault (locked or unreadable keychain) in place.
    expect(message).not.toContain('/key save');
  });

  it('does not apply an inline auth-key when the named key is unresolved', async () => {
    keyStorage.mode = 'not-found';
    const profileWithFallback: Profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {
        'auth-key-name': 'ghost-key',
        'auth-key': 'inline-fallback-secret',
      },
    };

    const { thrown, message } = await captureRejection(
      applyProfileForTest(profileWithFallback, {}, stubSwitchProvider),
    );

    expect(thrown).toBeDefined();
    expect(message).toContain("Named key 'ghost-key' not found");
    expect(providerAuthKey()).not.toBe('inline-fallback-secret');
  });

  it('does not apply a keyfile credential when the named key is unresolved', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-2916-keyfile-'));
    const keyfilePath = join(tempDir, 'key');
    writeFileSync(keyfilePath, 'keyfile-fallback-secret');

    keyStorage.mode = 'not-found';
    const profileWithKeyfile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {
        'auth-key-name': 'ghost-key',
        'auth-keyfile': keyfilePath,
      },
    };

    const { thrown, message } = await captureRejection(
      applyProfileForTest(profileWithKeyfile, {}, stubSwitchProvider),
    );

    expect(thrown).toBeDefined();
    expect(message).toContain("Named key 'ghost-key' not found");
    expect(providerAuthKey()).not.toBe('keyfile-fallback-secret');
    expect(
      root().settings.getProviderSettings('openai')['auth-keyfile'],
    ).toBeUndefined();
  });

  it('does not replace a previously configured provider credential when the named key is unresolved', async () => {
    root().settings.setProviderSetting(
      'openai',
      'auth-key',
      'prior-configured-secret',
    );
    keyStorage.mode = 'not-found';

    const { thrown, message } = await captureRejection(
      applyProfileForTest(standardProfile('ghost-key'), {}, stubSwitchProvider),
    );

    expect(thrown).toBeDefined();
    expect(message).toContain("Named key 'ghost-key' not found");
    expect(providerAuthKey()).toBe('prior-configured-secret');
  });

  it('does not leave the unresolved name in ephemerals after a failed resolution', async () => {
    keyStorage.mode = 'not-found';

    const { thrown } = await captureRejection(
      applyProfileForTest(standardProfile('ghost-key'), {}, stubSwitchProvider),
    );

    expect(thrown).toBeDefined();
    expect(
      root().settingsOwner.readNamedParameter('auth-key-name'),
    ).toBeUndefined();
  });

  it('preserves prior application state when named-key resolution fails', async () => {
    root().settingsOwner.writeUserParameter('context-limit', 50000);
    root().settingsOwner.writeUserParameter('auth-key', 'prior-applied-secret');
    root().settings.setProviderSetting(
      'openai',
      'auth-key',
      'prior-provider-secret',
    );
    keyStorage.mode = 'not-found';

    const { thrown, message } = await captureRejection(
      applyProfileForTest(standardProfile('ghost-key'), {}, stubSwitchProvider),
    );

    expect(thrown).toBeDefined();
    expect(message).toContain("Named key 'ghost-key' not found");
    // Prior non-auth ephemeral must survive a failed apply.
    expect(root().settingsOwner.readNamedParameter('context-limit')).toBe(
      50000,
    );
    // Prior auth ephemeral must survive a failed apply.
    expect(root().settingsOwner.readNamedParameter('auth-key')).toBe(
      'prior-applied-secret',
    );
    // Prior provider auth must survive a failed apply.
    expect(providerAuthKey()).toBe('prior-provider-secret');
    // The unresolved new name must never be installed.
    expect(
      root().settingsOwner.readNamedParameter('auth-key-name'),
    ).toBeUndefined();
  });

  const unresolvedStoredResults: ReadonlyArray<{
    label: string;
    storedValue: string | null | undefined;
  }> = [
    { label: 'null', storedValue: null },
    { label: 'undefined', storedValue: undefined },
    { label: 'empty string', storedValue: '' },
    { label: 'whitespace', storedValue: '   ' },
  ];

  for (const { label, storedValue } of unresolvedStoredResults) {
    it(`fails as unresolved when storage returns ${label} for a named key`, async () => {
      keyStorage.mode = 'resolved';
      keyStorage.resolvedValue = storedValue;

      const { thrown, message } = await captureRejection(
        applyProfileForTest(
          standardProfile('work-key'),
          {},
          stubSwitchProvider,
        ),
      );

      expect(thrown).toBeDefined();
      expect(message).toContain("Named key 'work-key' not found");
      expect(providerAuthKey()).toBeUndefined();
      expect(
        root().settingsOwner.readNamedParameter('auth-key-name'),
      ).toBeUndefined();
    });
  }

  it('applies a resolved named key and preserves the name reference', async () => {
    keyStorage.mode = 'resolved';
    keyStorage.resolvedValue = 'resolved-secret-value';

    const result = await applyProfileForTest(
      standardProfile('work-key'),
      {},
      stubSwitchProvider,
    );

    expect(result.providerName).toBe('openai');
    expect(root().settingsOwner.readNamedParameter('auth-key-name')).toBe(
      'work-key',
    );
    expect(providerAuthKey()).toBe('resolved-secret-value');
  });

  const nonNamedNameInputs: ReadonlyArray<{
    label: string;
    nameValue: unknown;
    omit: boolean;
  }> = [
    { label: 'absent', nameValue: undefined, omit: true },
    { label: 'null', nameValue: null, omit: false },
    { label: 'a non-string number', nameValue: 123, omit: false },
    { label: 'empty string', nameValue: '', omit: false },
    { label: 'whitespace', nameValue: '   ', omit: false },
  ];

  for (const { label, nameValue, omit } of nonNamedNameInputs) {
    it(`does not treat ${label} auth-key-name as a named credential and keeps lower-precedence auth`, async () => {
      // Storage errors prove the named-key lookup never ran: had the name been
      // treated as a credential, storage would be queried and throw, failing
      // the apply. Instead the lower-precedence inline key must be applied.
      keyStorage.mode = 'error';
      keyStorage.error = new Error('storage must not be reached');
      const profileWithInline: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4o',
        modelParams: {},
        ephemeralSettings: {
          ...authKeyNameSetting(omit, nameValue),
          'auth-key': 'inline-direct-key',
        },
      };

      await applyProfileForTest(profileWithInline, {}, stubSwitchProvider);

      expect(
        root().settingsOwner.readNamedParameter('auth-key-name'),
      ).toBeUndefined();
      expect(providerAuthKey()).toBe('inline-direct-key');
    });
  }
});
