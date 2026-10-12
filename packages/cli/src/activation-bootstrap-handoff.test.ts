/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LlxprtExtension } from '@vybestack/llxprt-code-core';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AgentActivationOperation } from '@vybestack/llxprt-code-agents';
import { bootstrapRuntimeAndConfig } from './cliSessionBootstrap.js';
import { activateConfiguredProvider } from './cliProviderInit.js';
import { createForegroundAgent } from './cliAgentBootstrap.js';
import { loadSettings } from './config/settings.js';
import { parseArguments } from './config/cliArgParser.js';
import { loadCliConfig } from './config/config.js';
import { ExtensionEnablementManager } from './config/extensions/extensionEnablement.js';
import {
  runExitCleanup,
  __resetCleanupStateForTesting,
} from './utils/cleanup.js';

describe('CLI activation operation handoff', () => {
  let directory: string;
  let previousArgv: string[];
  let previousEnv: NodeJS.ProcessEnv;
  beforeEach(async () => {
    previousArgv = process.argv;
    previousEnv = { ...process.env };
    directory = await mkdtemp(join(tmpdir(), 'llxprt-handoff-'));
    process.env.LLXPRT_CONFIG_HOME = directory;
    process.env.LLXPRT_FAKE_RESPONSES = resolve(
      import.meta.dirname,
      '../../../packages/agents/src/api/__tests__/fixtures/plain-text.jsonl',
    );
    process.env.LLXPRT_RUNTIME_ID = `handoff-${directory}`;
    process.argv = [
      'bun',
      'llxprt',
      '--provider',
      'fake',
      '--model',
      'fake-model',
      '--prompt',
      'hello',
    ];
    __resetCleanupStateForTesting();
  });
  afterEach(async () => {
    await runExitCleanup();
    __resetCleanupStateForTesting();
    process.argv = previousArgv;
    process.env = previousEnv;
    await rm(directory, { recursive: true, force: true });
  });

  it('uses the config bootstrap operation for auto auth and real foreground adoption', async () => {
    const settings = loadSettings(directory);
    const argv = await parseArguments(settings.merged);
    const boot = await bootstrapRuntimeAndConfig(settings, argv, directory);
    try {
      await writeFile(join(directory, 'discovery.txt'), 'workspace discovery');
      await writeFile(join(directory, '.llxprtignore'), 'discovery.txt\n');
      const root = boot.activationOperation.workspaceFilesystem;
      expect(await root.search.search(directory, '*.txt')).toStrictEqual([]);
      expect(boot.providerManager.getActiveProviderName()).toBe('fake');
      const manager = boot.providerManager;

      const activation = await activateConfiguredProvider(
        boot.config,
        manager,
        argv,
        boot.activationOperation,
      );
      expect(activation.authFailed).toBe(false);
      expect(activation.activationPreflight?.operation).toBe(
        boot.activationOperation,
      );
      const contentConfig = boot.config.getContentGeneratorConfig();
      const agent = await createForegroundAgent({
        policyOwner: boot.policyOwner,
        oauthManager: boot.oauthManager,
        providerFileLifecycle: boot.providerFileLifecycle,
        config: boot.config,
        settingsService: boot.runtimeSettingsService,
        settingsOwner: boot.runtimeSettingsOwner,
        providerManager: boot.providerManager,
        activationPreflight: activation.activationPreflight,
        activationPreflightIntent: activation.intent,
      });
      await writeFile(join(directory, '.llxprtignore'), '');
      expect(await agent.workspace.search(directory, '*.txt')).toStrictEqual([
        'discovery.txt',
      ]);
      await writeFile(join(directory, '.llxprtignore'), 'discovery.txt\n');
      expect(await root.search.search(directory, '*.txt')).toStrictEqual([]);
      expect(agent.getRuntimeId()).toBe(boot.config.getSessionId());
      expect(boot.config.getContentGeneratorConfig()).toBe(contentConfig);
      expect(
        (await boot.activationOperation.preflight({ authMode: 'none' }))
          .authFailed,
      ).toBe(true);
      await agent.dispose();
    } finally {
      await boot.activationOperation.dispose();
      await boot.config.dispose();
    }
  });

  it('adopts preflight filesystem extensions through one root and exposes only restart', async () => {
    process.env.LLXPRT_DATA_HOME = directory;
    const extensionDir = join(directory, 'extensions', 'preflight');
    const skillDir = join(extensionDir, 'skills', 'preflight');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: preflight\ndescription: Preflight filesystem skill\n---\n\nUse the adopted workspace.\n',
    );
    await writeFile(
      join(extensionDir, 'llxprt-extension.json'),
      JSON.stringify({ name: 'preflight', version: '1' }),
    );
    await mkdir(join(directory, '.llxprt'), { recursive: true });
    await writeFile(
      join(directory, '.llxprt', 'settings.json'),
      JSON.stringify({ experimental: { extensionReloading: true } }),
    );
    const settings = loadSettings(directory);
    const argv = await parseArguments(settings.merged);
    const boot = await bootstrapRuntimeAndConfig(settings, argv, directory);
    try {
      const extension = boot.config
        .getExtensions()
        .find((item) => item.name === 'preflight');
      if (!extension)
        throw new Error('Preflight did not load the filesystem extension');
      const activation = await activateConfiguredProvider(
        boot.config,
        boot.providerManager,
        argv,
        boot.activationOperation,
      );
      let restart: ((extension: LlxprtExtension) => Promise<void>) | undefined;
      const agent = await createForegroundAgent({
        policyOwner: boot.policyOwner,
        oauthManager: boot.oauthManager,
        providerFileLifecycle: boot.providerFileLifecycle,
        config: boot.config,
        settingsService: boot.runtimeSettingsService,
        settingsOwner: boot.runtimeSettingsOwner,
        providerManager: boot.providerManager,
        activationPreflight: activation.activationPreflight,
        activationPreflightIntent: activation.intent,
        onExtensionRestart: (operation) => {
          restart = operation;
        },
      });
      try {
        if (!restart) throw new Error('Missing exact restart port');
        expect(boot.config.getExtensions()[0]).toBe(extension);
        expect(agent.skills.list().map((skill) => skill.name)).toContain(
          'preflight',
        );
        await restart(extension);
        expect(agent.skills.list().map((skill) => skill.name)).toContain(
          'preflight',
        );
        expect('getExtensionLoader' in boot.config).toBe(false);
      } finally {
        await agent.dispose();
      }
    } finally {
      await boot.activationOperation.dispose();
      await boot.config.dispose();
    }
  });

  it('invalidates a transferred bootstrap on startup cleanup before Agent creation', async () => {
    const settings = loadSettings(directory);
    const argv = await parseArguments(settings.merged);
    const boot = await bootstrapRuntimeAndConfig(settings, argv, directory);
    try {
      await runExitCleanup();
      expect(
        (await boot.activationOperation.preflight({ authMode: 'none' }))
          .authFailed,
      ).toBe(true);
    } finally {
      await boot.config.dispose();
    }
  });

  it('invalidates the operation when the config handoff callback throws', async () => {
    const settings = loadSettings(directory);
    const argv = await parseArguments(settings.merged);
    let captured: AgentActivationOperation | undefined;
    await expect(
      loadCliConfig(
        settings.merged,
        [],
        new ExtensionEnablementManager(directory, []),
        'handoff-failure',
        argv,
        directory,
        {
          onActivationBootstrapReady: (operation) => {
            captured = operation;
            throw new Error('handoff failed');
          },
        },
      ),
    ).rejects.toThrow('handoff failed');
    if (!captured) throw new Error('Missing handoff');
    expect((await captured.preflight({ authMode: 'none' })).authFailed).toBe(
      true,
    );
  });
});
