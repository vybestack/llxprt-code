/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import {
  mkdtemp,
  mkdir,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { bootstrapRuntimeAndConfig } from './cliSessionBootstrap.js';
import { loadSettings } from './config/settings.js';
import { parseArguments } from './config/cliArgParser.js';
import {
  parseBootstrapArgs,
  prepareRuntimeForProfile,
} from './config/profileBootstrap.js';
import { createExtension } from './__tests__/createExtension.js';
import { transferActivation } from './__tests__/startup-activation-fixture.js';
import {
  runExitCleanup,
  __resetCleanupStateForTesting,
} from './utils/cleanup.js';

const baseArgv = [
  'bun',
  'llxprt',
  '--provider',
  'fake',
  '--model',
  'fake-model',
  '--prompt',
  'hello',
];

describe('extension selection at CLI bootstrap', () => {
  let directory: string;
  let originalEnv: NodeJS.ProcessEnv;
  let previousArgv: string[];
  let previousEnv: NodeJS.ProcessEnv;
  let previousCwd: string;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    directory = await realpath(
      await mkdtemp(join(tmpdir(), 'llxprt-extension-selection-')),
    );
    process.env.HOME = directory;
    process.env.USERPROFILE = directory;
  });

  afterAll(async () => {
    process.env = originalEnv;
    await rm(directory, { recursive: true, force: true });
  });

  beforeEach(async () => {
    previousArgv = process.argv;
    previousEnv = { ...process.env };
    previousCwd = process.cwd();
    const workspace = join(directory, 'workspace');
    await mkdir(workspace, { recursive: true });
    const configHome = join(directory, 'config');
    process.env.LLXPRT_CONFIG_HOME = configHome;
    process.env.LLXPRT_DATA_HOME = configHome;
    process.env.LLXPRT_FAKE_RESPONSES = resolve(
      import.meta.dirname,
      '../../agents/src/api/__tests__/fixtures/plain-text.jsonl',
    );
    process.env.LLXPRT_RUNTIME_ID = `extension-selection-${directory}`;
    process.env.LLXPRT_CODE_SKIP_TERMINAL_CAPABILITY_DETECTION = 'true';
    delete process.env.LLXPRT_SANDBOX;
    delete process.env.SANDBOX;
    process.chdir(workspace);
    __resetCleanupStateForTesting();

    const extensionsDir = join(configHome, 'extensions');
    createExtension({ extensionsDir, name: 'alpha' });
    createExtension({ extensionsDir, name: 'beta' });
  });

  afterEach(async () => {
    await runExitCleanup();
    __resetCleanupStateForTesting();
    process.chdir(previousCwd);
    process.argv = previousArgv;
    process.env = previousEnv;
    for (const entry of await readdir(directory)) {
      await rm(join(directory, entry), { recursive: true, force: true });
    }
  });

  async function activeExtensionNames(
    extraArgv: string[],
    workspaceSettings: object = {},
  ): Promise<string[]> {
    const workspace = process.cwd();
    await mkdir(join(workspace, '.llxprt'), { recursive: true });
    await writeFile(
      join(workspace, '.llxprt', 'settings.json'),
      JSON.stringify(workspaceSettings),
    );
    process.argv = [...baseArgv, ...extraArgv];
    const settings = loadSettings(workspace);
    const argv = await parseArguments(settings.merged);
    const credentialAuthority = new CredentialAuthority();
    const parsed = parseBootstrapArgs();
    const preflight = await prepareRuntimeForProfile(
      { ...parsed, runtimeMetadata: { ...parsed.runtimeMetadata } },
      credentialAuthority,
      new SettingsService(),
      undefined,
      undefined,
    );
    const config = await bootstrapRuntimeAndConfig(
      settings,
      argv,
      workspace,
      preflight,
    );
    const operation = transferActivation(preflight);
    try {
      return config
        .getExtensions()
        .map((extension) => extension.name)
        .sort();
    } finally {
      await operation.dispose();
      await config.dispose();
    }
  }

  it('leaves every extension inactive for -e none', async () => {
    expect(await activeExtensionNames(['-e', 'none'])).toStrictEqual([]);
  });

  it('activates only the extensions named by -e', async () => {
    expect(await activeExtensionNames(['-e', 'alpha'])).toStrictEqual([
      'alpha',
    ]);
  });

  it('applies extensions.disabled as a disable list when -e is absent', async () => {
    expect(
      await activeExtensionNames([], { extensions: { disabled: ['alpha'] } }),
    ).toStrictEqual(['beta']);
  });
});
