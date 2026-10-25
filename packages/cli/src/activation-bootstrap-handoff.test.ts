import { AgentResourceCapture } from '../../agents/src/api/__tests__/helpers/agent-resource-capture.js';
import { capturedSessionClient } from '../../agents/src/api/__tests__/helpers/session-client-capture.js';
import {
  captureActivationConstruction,
  capturedActivation,
} from '../../agents/src/api/__tests__/helpers/activation-acquisition-capture.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  parseBootstrapArgs,
  prepareRuntimeForProfile,
} from './config/profileBootstrap.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
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
import { ExtensionEnablementManager } from './config/extensions/extensionEnablement.js';
import {
  runExitCleanup,
  registerCleanup,
  __resetCleanupStateForTesting,
} from './utils/cleanup.js';
import { loadCliConfigWithPreflight } from './__tests__/load-cli-config-fixture.js';

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
    const credentialAuthority = new CredentialAuthority();
    const callerSettings = new SettingsService();
    const parsed = parseBootstrapArgs();
    const preflight = await prepareRuntimeForProfile(
      {
        ...parsed,
        runtimeMetadata: {
          ...parsed.runtimeMetadata,
        },
      },
      credentialAuthority,
      callerSettings,
      undefined,
      undefined,
    );
    const config = await captureActivationConstruction(() =>
      bootstrapRuntimeAndConfig(settings, argv, directory, preflight),
    );
    let transferredActivation: AgentActivationOperation | undefined;
    preflight.transferActivation((operation) => {
      transferredActivation = operation;
    });
    if (transferredActivation === undefined)
      throw new Error('Missing activation operation');
    const activationOperation = transferredActivation;
    registerCleanup(() => activationOperation.dispose());
    try {
      await writeFile(join(directory, 'discovery.txt'), 'workspace discovery');
      await writeFile(join(directory, '.llxprtignore'), 'discovery.txt\n');
      const root = capturedActivation(activationOperation).workspaceFilesystem;
      expect(await root.search.search(directory, '*.txt')).toStrictEqual([]);
      expect(preflight.getActiveProviderName()).toBe('fake');
      const manager = preflight;

      const activation = await activateConfiguredProvider(
        config,
        manager,
        argv,
        activationOperation,
      );
      expect(activation.authFailed).toBe(false);
      const expectedClient = capturedSessionClient(
        capturedActivation(activationOperation).owner,
      );
      const capture = new AgentResourceCapture();
      capture.observe(expectedClient);
      const contentConfig = config.getContentGeneratorConfig();
      const agent = await createForegroundAgent(
        preflight,
        requireForegroundReceipt(activation),
        activation.intent ?? {},
        credentialAuthority,
        {},
      );
      expect(capture.publishedClient(agent)).toBe(expectedClient);
      await writeFile(join(directory, '.llxprtignore'), '');
      expect(await agent.workspace.search(directory, '*.txt')).toStrictEqual([
        'discovery.txt',
      ]);
      await writeFile(join(directory, '.llxprtignore'), 'discovery.txt\n');
      expect(await root.search.search(directory, '*.txt')).toStrictEqual([]);
      expect(agent.getRuntimeId()).toBe(config.getSessionId());
      expect(config.getContentGeneratorConfig()).toBe(contentConfig);
      expect(
        (await activationOperation.preflight({ authMode: 'none' })).authFailed,
      ).toBe(true);
      await agent.dispose();
    } finally {
      await activationOperation.dispose();
      await config.dispose();
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
    const credentialAuthority = new CredentialAuthority();
    const callerSettings = new SettingsService();
    const parsed = parseBootstrapArgs();
    const preflight = await prepareRuntimeForProfile(
      {
        ...parsed,
        runtimeMetadata: {
          ...parsed.runtimeMetadata,
        },
      },
      credentialAuthority,
      callerSettings,
      undefined,
      undefined,
    );
    const config = await captureActivationConstruction(() =>
      bootstrapRuntimeAndConfig(settings, argv, directory, preflight),
    );
    let transferredActivation: AgentActivationOperation | undefined;
    preflight.transferActivation((operation) => {
      transferredActivation = operation;
    });
    if (transferredActivation === undefined)
      throw new Error('Missing activation operation');
    const activationOperation = transferredActivation;
    registerCleanup(() => activationOperation.dispose());
    try {
      const extension = config
        .getExtensions()
        .find((item) => item.name === 'preflight');
      if (!extension)
        throw new Error('Preflight did not load the filesystem extension');
      const activation = await activateConfiguredProvider(
        config,
        preflight,
        argv,
        activationOperation,
      );
      let restart: ((extension: LlxprtExtension) => Promise<void>) | undefined;
      const agent = await createForegroundAgent(
        preflight,
        requireForegroundReceipt(activation),
        activation.intent ?? {},
        credentialAuthority,
        {
          onExtensionRestart: (operation) => {
            restart = operation;
          },
        },
      );
      try {
        if (!restart) throw new Error('Missing exact restart port');
        expect(config.getExtensions()[0]).toBe(extension);
        expect(agent.skills.list().map((skill) => skill.name)).toContain(
          'preflight',
        );
        await restart(extension);
        expect(agent.skills.list().map((skill) => skill.name)).toContain(
          'preflight',
        );
        expect('getExtensionLoader' in config).toBe(false);
      } finally {
        await agent.dispose();
      }
    } finally {
      await activationOperation.dispose();
      await config.dispose();
    }
  });

  it('invalidates a transferred bootstrap on startup cleanup before Agent creation', async () => {
    const settings = loadSettings(directory);
    const argv = await parseArguments(settings.merged);
    const credentialAuthority = new CredentialAuthority();
    const callerSettings = new SettingsService();
    const parsed = parseBootstrapArgs();
    const preflight = await prepareRuntimeForProfile(
      {
        ...parsed,
        runtimeMetadata: {
          ...parsed.runtimeMetadata,
        },
      },
      credentialAuthority,
      callerSettings,
      undefined,
      undefined,
    );
    const config = await captureActivationConstruction(() =>
      bootstrapRuntimeAndConfig(settings, argv, directory, preflight),
    );
    let transferredActivation: AgentActivationOperation | undefined;
    preflight.transferActivation((operation) => {
      transferredActivation = operation;
    });
    if (transferredActivation === undefined)
      throw new Error('Missing activation operation');
    const activationOperation = transferredActivation;
    registerCleanup(() => activationOperation.dispose());
    try {
      await runExitCleanup();
      expect(
        (await activationOperation.preflight({ authMode: 'none' })).authFailed,
      ).toBe(true);
    } finally {
      await config.dispose();
    }
  });

  it('invalidates the operation when the config handoff callback throws', async () => {
    const settings = loadSettings(directory);
    const argv = await parseArguments(settings.merged);
    let captured: AgentActivationOperation | undefined;
    await expect(
      loadCliConfigWithPreflight({
        settings: settings.merged,
        extensions: [],
        extensionEnablementManager: new ExtensionEnablementManager(directory, {
          enabledOverride: [],
        }),
        sessionId: 'handoff-failure',
        argv,
        cwd: directory,
        authority: new CredentialAuthority(),
        onActivationBootstrapReady: (operation) => {
          captured = operation;
          throw new Error('handoff failed');
        },
      }),
    ).rejects.toThrow('handoff failed');
    if (!captured) throw new Error('Missing handoff');
    expect((await captured.preflight({ authMode: 'none' })).authFailed).toBe(
      true,
    );
  });
});

function requireForegroundReceipt(
  activation: Awaited<ReturnType<typeof activateConfiguredProvider>>,
): NonNullable<typeof activation.token> {
  if (activation.token === undefined)
    throw new Error('Missing foreground receipt');
  return activation.token;
}
