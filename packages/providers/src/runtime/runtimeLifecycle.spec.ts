/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderManager } from '../ProviderManager.js';
import { ProviderFileLifecycle } from '../providerFilePolicy.js';
import { FakeProvider } from '../fake/FakeProvider.js';

describe('explicit provider and preflight lifecycle owners', () => {
  let directory: string;
  let config: Config;
  let settings: SettingsService;
  let settingsOwner: SessionSettingsOwner;
  let manager: ProviderManager;
  let files: ProviderFileLifecycle;
  const cleanup: Array<() => void | Promise<void>> = [];
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'provider-lifecycle-'));
    config = new Config({
      cwd: directory,
      targetDir: directory,
      sessionId: 'supplied-config',
      provider: 'openai',
      model: 'owner-model',
      debugMode: false,
      mcpEnabled: false,
      telemetry: { enabled: false },
    });
    settings = new SettingsService();
    settingsOwner = new SessionSettingsOwner(settings);
    files = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      files,
      settings,
      config,
    );
    const responses = join(directory, 'responses.jsonl');
    await writeFile(
      responses,
      JSON.stringify({
        chunks: [
          { speaker: 'ai', blocks: [{ type: 'text', text: 'owner response' }] },
        ],
      }) + '\n',
    );
    manager.registerProvider(new FakeProvider(responses));
    manager.setActiveProvider('fake');
    settings.set('activeProvider', 'openai');
    cleanup.push(
      () => rm(directory, { recursive: true, force: true }),
      () => config.dispose(),
      () => settingsOwner.dispose(),
      () => manager.dispose(),
    );
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
      throw new AggregateError(failures, 'Lifecycle fixture cleanup failed');
  });

  it('captures updated owner metadata at invocation admission without rewriting already admitted data', () => {
    manager.setRuntimeContext(
      {
        runtimeId: 'activated-label',
        metadata: { base: 'retained', override: 'after', added: true },
      },
      settingsOwner,
      settings,
      config,
    );
    const admitted = manager.normalizeRuntimeInputs({ contents: [] }, 'fake');
    manager.setRuntimeContext(
      {
        runtimeId: 'later-label',
        metadata: { base: 'later', override: 'later', added: false },
      },
      settingsOwner,
      settings,
      config,
    );
    const later = manager.normalizeRuntimeInputs({ contents: [] }, 'fake');
    expect([
      admitted.invocation?.runtimeId,
      admitted.invocation?.metadata,
    ]).toStrictEqual([
      'activated-label',
      { base: 'retained', override: 'after', added: true },
    ]);
    expect([
      later.invocation?.runtimeId,
      later.invocation?.metadata,
    ]).toStrictEqual([
      'later-label',
      { base: 'later', override: 'later', added: false },
    ]);
  });
  it.each(['agent', 'subagent'] as const)(
    'preserves explicit %s kind through subsequent owner context updates',
    (runtimeKind) => {
      manager.setRuntimeContext(
        { runtimeId: 'typed-owner', runtimeKind, metadata: { step: 1 } },
        settingsOwner,
        settings,
        config,
      );
      const first = manager.normalizeRuntimeInputs({ contents: [] }, 'fake');
      manager.setRuntimeContext(
        { runtimeId: 'typed-owner', runtimeKind, metadata: { step: 2 } },
        settingsOwner,
        settings,
        config,
      );
      const second = manager.normalizeRuntimeInputs({ contents: [] }, 'fake');
      expect([first.runtimeKind, second.runtimeKind]).toStrictEqual([
        runtimeKind,
        runtimeKind,
      ]);
      expect(() => manager.prepareStatelessProviderInvocation()).not.toThrow();
      expect('providerManager' in config).toBe(false);
      expect(manager.getAuthIdentity()).toStrictEqual({
        runtimeId: 'typed-owner',
        runtimeKind,
      });
    },
  );
});
