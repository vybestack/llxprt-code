/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useRuntimeTestOwners } from './__tests__/runtime-owner-test-helpers.js';
import {
  activateIsolatedRuntimeContext,
  beginCliRuntimeRegistration,
  createIsolatedRuntimeContext,
  createRuntimeActivationBindings,
} from './index.js';

describe('explicit runtime lifecycle', () => {
  const owners = useRuntimeTestOwners();

  it('adopts infrastructure onto the supplied Config without cross-owner replacement', async () => {
    const first = owners.isolated({ runtimeId: 'same-label' });
    const second = owners.isolated({ runtimeId: 'same-label' });
    await Promise.all([first.activate(), second.activate()]);
    expect('providerManager' in first.config).toBe(false);
    expect('providerManager' in second.config).toBe(false);
    expect(first.providerFileLifecycle).not.toBe(second.providerFileLifecycle);
  });

  it('carries merged activation metadata and an explicit override label through prepare and cleanup', async () => {
    const observations: Array<{
      phase: string;
      runtimeId: string;
      metadata: Record<string, unknown>;
    }> = [];
    const handle = owners.isolated({
      runtimeId: 'constructed-label',
      metadata: { base: 'retained', override: 'before' },
      prepare: ({ runtimeId, metadata }) => {
        observations.push({ phase: 'prepare', runtimeId, metadata });
      },
      onCleanup: ({ runtimeId, metadata }) => {
        observations.push({ phase: 'cleanup', runtimeId, metadata });
      },
    });
    await activateIsolatedRuntimeContext(handle, {
      runtimeId: 'activated-label',
      metadata: { override: 'after', added: true },
    });
    await handle.cleanup();
    expect(
      observations.map(({ phase, runtimeId, metadata }) => ({
        phase,
        runtimeId,
        base: metadata.base,
        override: metadata.override,
        added: metadata.added,
      })),
    ).toStrictEqual([
      {
        phase: 'prepare',
        runtimeId: 'activated-label',
        base: 'retained',
        override: 'after',
        added: true,
      },
      {
        phase: 'cleanup',
        runtimeId: 'activated-label',
        base: 'retained',
        override: 'after',
        added: true,
      },
    ]);
    expect(
      handle.providerFileLifecycle.retainsScope('session', handle.runtimeId),
    ).toBe(false);
  });

  it.each(['agent', 'subagent'] as const)(
    'preserves explicit %s runtime kind through owner activation and later metadata updates',
    async (runtimeKind) => {
      const base = createRuntimeActivationBindings();
      const contexts: Array<{
        runtimeKind: string | undefined;
        runtimeId: string | undefined;
        config: unknown;
      }> = [];
      const handle = owners.isolated({
        runtimeKind,
        activationBindings: {
          ...base,
          setRuntimeContext: (settings, config, options) => {
            contexts.push({
              runtimeKind: options.runtimeKind,
              runtimeId: options.runtimeId,
              config,
            });
            return base.setRuntimeContext(settings, config, options);
          },
        },
      });
      await handle.activate({
        runtimeId: 'typed-owner',
        metadata: { step: 1 },
      });
      await handle.activate({ metadata: { step: 2 } });
      expect(contexts.map((context) => context.runtimeKind)).toStrictEqual([
        runtimeKind,
        runtimeKind,
      ]);
      expect(
        contexts.every((context) => context.config === handle.config),
      ).toBe(true);
      expect('providerManager' in handle.config).toBe(false);
      expect(handle.oauthManager.runtimeMessageBus).toBeDefined();
    },
  );

  it('releasing a foreground handle removes its authority and rejects subsequent adoption', () => {
    const foreground = owners.foreground();
    foreground.registration.dispose();
    expect(foreground.registration.config).toBeUndefined();
    expect(foreground.registration.providerManager).toBeUndefined();
    expect(() => foreground.registration.adopt(owners.config().config)).toThrow(
      'disposed',
    );
    expect(() =>
      foreground.registration.expectManager(foreground.providerManager),
    ).toThrow('disposed');
    expect(() => foreground.registration.dispose()).not.toThrow();
  });

  it('refuses a different Config without overwriting the original owner', () => {
    const foreground = owners.foreground();
    const { config: other } = owners.config();
    expect(() => foreground.registration.adopt(other)).toThrow(
      'another Config',
    );
    expect(foreground.registration.config).toBe(foreground.config);
    expect('providerFileLifecycle' in other).toBe(false);
  });

  it('rollback restores a newly attached file lifecycle on exactly its owner', () => {
    const { config, settingsService } = owners.config();
    const registration = beginCliRuntimeRegistration(settingsService, config, {
      runtimeId: 'rollback',
    });
    expect(registration.config).toBe(config);
    registration.rollback();
    expect('providerFileLifecycle' in config).toBe(false);
    expect(registration.config).toBeUndefined();
  });

  it('rejects invalid creation and activation labels before modifying owner infrastructure', async () => {
    const { config, settingsService } = owners.config();
    for (const runtimeId of ['', '  ']) {
      expect(() =>
        createIsolatedRuntimeContext(
          {
            config,
            runtimeId,
          },
          settingsService,
        ),
      ).toThrow('Invalid runtimeId');
      expect(() =>
        beginCliRuntimeRegistration(settingsService, config, {
          runtimeId,
        }),
      ).toThrow('Invalid runtimeId');
    }
    expect('providerFileLifecycle' in config).toBe(false);
    const handle = owners.isolated();
    await expect(handle.activate({ runtimeId: '' })).rejects.toThrow(
      'Invalid runtimeId',
    );
    expect('providerManager' in handle.config).toBe(false);
    expect(
      handle.providerFileLifecycle.retainsScope('session', handle.runtimeId),
    ).toBe(false);
  });
});
