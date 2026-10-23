/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCleanupSteps } from '../../../agents/src/core/subagent-cleanup.js';
import { OAuthManager } from '../auth/oauth-manager.js';
import {
  MemoryTokenStore,
  createTestProvider,
} from '../auth/__tests__/behavioral/test-utils.js';

describe('owner OAuth interactive authentication timeout', () => {
  const retiring: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    await runCleanupSteps(retiring.splice(0).reverse());
  });
  afterEach(async () => {
    vi.restoreAllMocks();
  });

  async function pendingAuth(
    timeout: number | undefined,
    withConfig = true,
  ): Promise<number[]> {
    let config: Config | undefined;
    let settingsOwner: SessionSettingsOwner | undefined;
    if (withConfig) {
      const raw = await mkdtemp(join(tmpdir(), 'oauth-timeout-owner-'));
      retiring.push(() => rm(raw, { recursive: true, force: true }));
      const directory = await realpath(raw);
      const selected = new Config({
        sessionId: 'same-label',
        targetDir: directory,
        cwd: directory,
        model: 'owner-model',
        debugMode: false,
      });
      config = selected;
      retiring.push(() => selected.dispose());
      const settings = new SettingsService();
      const owner = new SessionSettingsOwner(settings);
      settingsOwner = owner;
      retiring.push(() => owner.dispose());
      owner.bindTelemetry(selected);
      owner.writeUserParameter('auth.interactiveTimeoutMs', timeout);
    }
    const manager = new OAuthManager(new MemoryTokenStore(), undefined, {
      config,
      readSessionAuthPolicy: () => ({
        noBrowser: false,
        authOnly: false,
        profileName: null,
        bucketPrompt: undefined,
        bucketDelay: undefined,
        interactiveTimeoutMs: settingsOwner?.readNamedParameter(
          'auth.interactiveTimeoutMs',
        ),
      }),
      readAuthIdentity: () => ({
        runtimeId: 'timeout-owner',
        runtimeKind: 'subagent',
      }),
    });
    retiring.push(() => manager.dispose());
    manager.registerProvider(createTestProvider('timeout-provider'));
    await manager.toggleOAuthEnabled('timeout-provider');
    let started = (): void => {};
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    manager.bindInteractiveAuthHost(async () => {
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
    manager.cancelInteractiveAuth();
    expect(await result).toMatchObject({ outcomeKind: 'cancelled' });
    await manager.dispose();
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
