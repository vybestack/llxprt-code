import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  activateIsolatedRuntimeContext,
  createIsolatedRuntimeContext,
  listProviders,
} from './index.js';

function sameLabelOwner() {
  const settingsService = new SettingsService();
  const settingsOwner = new SessionSettingsOwner(settingsService);
  const config = new Config({
    sessionId: 'shared-owner-label',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: 'test-model',
  });
  return { config, settingsService, settingsOwner };
}

describe('isolated runtime owner activation', () => {
  it('requires the explicit SDK owner even when an isolated owner is active', async () => {
    const handle = (() => {
      const capturedConfig17 = sameLabelOwner();
      return createIsolatedRuntimeContext(
        {
          config: capturedConfig17.config,
          settingsOwner: capturedConfig17.settingsOwner,
          runtimeId: 'sdk-owner',
        },
        capturedConfig17.settingsService,
      );
    })();
    try {
      await handle.activate();
      expect(() => Reflect.apply(listProviders, undefined, [])).toThrow(
        'Provider listing requires an explicit owner',
      );
      expect('providerManager' in handle.config).toBe(false);
    } finally {
      await handle.cleanup();
      await handle.config.dispose();
    }
  });

  it('keeps two concurrent owners with the same label independent', async () => {
    const first = (() => {
      const capturedConfig18 = sameLabelOwner();
      return createIsolatedRuntimeContext(
        {
          config: capturedConfig18.config,
          settingsOwner: capturedConfig18.settingsOwner,
          runtimeId: 'shared-label',
          metadata: { credential: 'first' },
        },
        capturedConfig18.settingsService,
      );
    })();
    const second = (() => {
      const capturedConfig19 = sameLabelOwner();
      return createIsolatedRuntimeContext(
        {
          config: capturedConfig19.config,
          settingsOwner: capturedConfig19.settingsOwner,
          runtimeId: 'shared-label',
          metadata: { credential: 'second' },
        },
        capturedConfig19.settingsService,
      );
    })();

    try {
      await Promise.all([
        activateIsolatedRuntimeContext(first),
        activateIsolatedRuntimeContext(second),
      ]);
      expect('providerManager' in first.config).toBe(false);
      expect(first.providerManager).not.toBe(second.providerManager);
      await first.cleanup();
      expect('providerManager' in second.config).toBe(false);
    } finally {
      await Promise.all([first.cleanup(), second.cleanup()]);
      await Promise.all([first.config.dispose(), second.config.dispose()]);
    }
  });

  it('assigns independent UUID identities to equal-label Config owners without caller IDs', async () => {
    const first = (() => {
      const capturedConfig20 = sameLabelOwner();
      return createIsolatedRuntimeContext(
        {
          config: capturedConfig20.config,
          settingsOwner: capturedConfig20.settingsOwner,
        },
        capturedConfig20.settingsService,
      );
    })();
    const second = (() => {
      const capturedConfig21 = sameLabelOwner();
      return createIsolatedRuntimeContext(
        {
          config: capturedConfig21.config,
          settingsOwner: capturedConfig21.settingsOwner,
        },
        capturedConfig21.settingsService,
      );
    })();
    try {
      expect(first.config.getSessionId()).toBe(second.config.getSessionId());
      expect(first.runtimeId).toMatch(
        /^cli-isolated-[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i,
      );
      expect(second.runtimeId).not.toBe(first.runtimeId);
      await Promise.all([first.activate(), second.activate()]);
      expect('providerManager' in first.config).toBe(false);
      await first.cleanup();
      expect('providerManager' in second.config).toBe(false);
    } finally {
      await Promise.all([first.cleanup(), second.cleanup()]);
      await Promise.all([first.config.dispose(), second.config.dispose()]);
    }
  });

  it('an aborted same-label activation leaves the other owner usable', async () => {
    const sibling = (() => {
      const capturedConfig22 = sameLabelOwner();
      return createIsolatedRuntimeContext(
        {
          config: capturedConfig22.config,
          settingsOwner: capturedConfig22.settingsOwner,
          runtimeId: 'same-label-abort',
          metadata: { profile: 'sibling' },
        },
        capturedConfig22.settingsService,
      );
    })();
    const aborted = (() => {
      const capturedConfig23 = sameLabelOwner();
      return createIsolatedRuntimeContext(
        {
          config: capturedConfig23.config,
          settingsOwner: capturedConfig23.settingsOwner,
          runtimeId: 'same-label-abort',
          metadata: { profile: 'aborted' },
          prepare: () => {
            const error = new Error('activation aborted');
            error.name = 'AbortError';
            throw error;
          },
        },
        capturedConfig23.settingsService,
      );
    })();
    try {
      await sibling.activate();
      sibling.settingsOwner.writeUserParameter(
        'auth-key',
        'sibling-credential',
      );
      await expect(aborted.activate()).rejects.toThrow('activation aborted');
      await aborted.cleanup();
      expect(sibling.settingsOwner.readNamedParameter('auth-key')).toBe(
        'sibling-credential',
      );
      expect('providerManager' in sibling.config).toBe(false);
    } finally {
      await Promise.all([sibling.cleanup(), aborted.cleanup()]);
      await Promise.all([sibling.config.dispose(), aborted.config.dispose()]);
    }
  });

  it('passes the exact owner Config and runtime ID to activation callbacks', async () => {
    const observed: string[] = [];
    const owner = sameLabelOwner();
    const handle = createIsolatedRuntimeContext(
      {
        config: owner.config,
        settingsOwner: owner.settingsOwner,
        runtimeId: 'callback-owner',
        prepare: ({ config, runtimeId }) => {
          expect(config).toBe(owner.config);
          observed.push(runtimeId);
        },
        onCleanup: ({ config, runtimeId }) => {
          expect(config).toBe(handle.config);
          observed.push(runtimeId);
        },
      },
      owner.settingsService,
    );
    try {
      await handle.activate();
    } finally {
      await handle.cleanup();
      await handle.config.dispose();
    }
    expect(observed).toStrictEqual(['callback-owner', 'callback-owner']);
  });
});
