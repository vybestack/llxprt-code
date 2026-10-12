/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'bun:test';
import { useRuntimeTestOwners } from './__tests__/runtime-owner-test-helpers.js';
import { OAuthManager } from '../auth/oauth-manager.js';
import {
  MemoryTokenStore,
  createTestProvider,
} from '../auth/__tests__/behavioral/test-utils.js';
import { interactiveAuthCoordinator } from '../auth/interactive-auth-coordinator.js';

describe('owner OAuth interactive authentication timeout', () => {
  const owners = useRuntimeTestOwners();
  afterEach(async () => {
    await interactiveAuthCoordinator.dispose();
    interactiveAuthCoordinator.unbindHost();
    vi.restoreAllMocks();
  });

  async function pendingAuth(
    timeout: number | undefined,
    withConfig = true,
  ): Promise<number[]> {
    const root = withConfig ? owners.config() : undefined;
    const config = root?.config;
    root?.settingsOwner.writeUserParameter(
      'auth.interactiveTimeoutMs',
      timeout,
    );
    const manager = new OAuthManager(new MemoryTokenStore(), undefined, {
      config,
      readSessionAuthPolicy: () => ({
        noBrowser: false,
        authOnly: false,
        profileName: null,
        bucketPrompt: undefined,
        bucketDelay: undefined,
        interactiveTimeoutMs: root?.settingsOwner.readNamedParameter(
          'auth.interactiveTimeoutMs',
        ),
      }),
      readAuthIdentity: () => ({
        runtimeId: 'timeout-owner',
        runtimeKind: 'subagent',
      }),
    });
    manager.registerProvider(createTestProvider('timeout-provider'));
    await manager.toggleOAuthEnabled('timeout-provider');
    let started = (): void => {};
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    interactiveAuthCoordinator.bindHost(async () => {
      started();
      await new Promise<void>(() => {});
    });
    const delays: number[] = [];
    const setTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(
      new Proxy(setTimeout, {
        apply(
          target,
          receiver: unknown,
          args: Parameters<typeof setTimeout>,
        ): ReturnType<typeof setTimeout> {
          if (typeof args[1] === 'number') delays.push(args[1]);
          return Reflect.apply(target, receiver, args);
        },
      }),
    );
    const result = manager
      .getToken('timeout-provider', 'work')
      .catch((error: unknown) => error);
    await ready;
    interactiveAuthCoordinator.cancelActiveSessions();
    expect(await result).toMatchObject({ outcomeKind: 'cancelled' });
    return delays;
  }

  it('schedules the timeout from the supplied owner settings', async () => {
    expect(await pendingAuth(45000)).toContain(45000);
  });

  it('uses the interactive default when the owner has no timeout setting', async () => {
    expect(await pendingAuth(undefined)).toContain(1200000);
  });

  it('uses the interactive default when no Config was supplied to the OAuth manager', async () => {
    expect(await pendingAuth(undefined, false)).toContain(1200000);
  });
});
