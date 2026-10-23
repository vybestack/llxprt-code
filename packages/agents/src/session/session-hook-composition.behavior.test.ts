/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionHookComposition } from './session-hook-composition.js';

describe('session hook composition ownership', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  let config: Config;
  let policy: RuntimePolicyOwner;
  let settings: SessionSettingsOwner;
  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hook-composition-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    config = new Config({
      sessionId: 'hook-composition',
      model: 'hook-model',
      cwd: directory,
      targetDir: directory,
      debugMode: false,
      telemetry: { enabled: false },
    });
    cleanup.push(() => config.dispose());
    policy = new RuntimePolicyOwner(config);
    cleanup.push(() => policy.dispose());
    settings = new SessionSettingsOwner(new SettingsService());
    cleanup.push(() => settings.dispose());
    settings.bindTelemetry(config);
  });
  afterEach(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.splice(0).reverse()) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Hook composition cleanup failed');
  });
  function owner(
    bindReload: (reload: () => Promise<void>) => (() => void) | undefined,
  ): SessionHookComposition {
    return new SessionHookComposition(
      config,
      () => settings.telemetry,
      () => policy.session.messageBus,
      () => policy.trust,
      bindReload,
    );
  }
  it('closes and joins an owned fork while preserving the borrowed parent and exact bus authority', async () => {
    const parent = owner(() => undefined);
    cleanup.push(() => parent.dispose());
    parent.bind();
    const child = owner(() => undefined);
    cleanup.push(() => child.dispose());
    child.bind(parent.operations);
    child.operations.assertMessageBus(policy.session.messageBus);
    const pending = child.dispose();
    expect(new Set([pending, child.dispose(), child.dispose()]).size).toBe(1);
    await pending;
    expect(() => child.operations.fork()).toThrow(/disposed/);
    const survivor = parent.operations.fork();
    cleanup.push(() => survivor.dispose());
    expect(() =>
      survivor.assertMessageBus(policy.session.messageBus),
    ).not.toThrow();
  });
  it('retires an acquired hook root even when reload registration fails before binding transfers', async () => {
    const primary = new Error('reload registration failed');
    const hooks = owner(() => {
      throw primary;
    });
    cleanup.push(() => hooks.dispose());
    expect(() => hooks.bind()).toThrow(primary);
    const acquired = hooks.operations;
    await hooks.dispose();
    expect(() => acquired.fork()).toThrow(/disposed/);
    await expect(hooks.operations.reloadDefinitions()).rejects.toThrow(
      /disposed/,
    );
  });
  it('closes hook admission and joins root release when reload unsubscription fails, preserving its exact failure once', async () => {
    const primary = new Error('reload unsubscription failed');
    const hooks = owner(() => () => {
      throw primary;
    });
    hooks.bind();
    const acquired = hooks.operations;
    const closing = hooks.dispose();
    expect(new Set([closing, hooks.dispose(), hooks.dispose()]).size).toBe(1);
    await expect(closing).rejects.toBe(primary);
    expect(() => acquired.fork()).toThrow(/disposed/);
    await expect(acquired.reloadDefinitions()).rejects.toThrow(/disposed/);
  });
});
