import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService, Storage } from '@vybestack/llxprt-code-settings';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { mkdtemp, realpath, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { afterEach, describe, expect, it } from 'bun:test';
import { WorkspaceMemoryOwner } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { fromConfig } from '../fromConfig.js';
import {
  ProviderManager,
  FakeProvider,
} from '@vybestack/llxprt-code-providers';
import { assembleAgentActivationBootstrap } from '../providerSwitchAssembly.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const cleanups: Array<() => Promise<void>> = [];

async function physicalMemory(): Promise<{
  directory: string;
  file: string;
  memory: WorkspaceMemoryOwner;
}> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'borrowed-memory-')),
  );
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, '.git'));
  const file = join(directory, 'LLXPRT.md');
  await writeFile(file, 'Initial caller instructions.');
  const filesystem = new WorkspaceFilesystemOwner({
    targetDir: directory,
    isTrusted: () => true,
  });
  cleanups.push(() => filesystem.dispose());
  const memory = new WorkspaceMemoryOwner({
    globalMemoryDir: Storage.getGlobalMemoryDir(),
    workingDirectory: directory,
    jitEnabled: false,
    debugMode: false,
    loadIncludes: false,
    filtering: { respectGitIgnore: true, respectLlxprtIgnore: true },
    maxDirectories: 100,
    filenames: ['LLXPRT.md'],
    importFormat: 'tree',
    paths: filesystem.paths,
    ignore: filesystem.ignore,
    scans: filesystem.scans,
    isTrusted: () => true,
    extensions: () => [],
  });
  cleanups.push(() => memory.dispose());
  expect((await memory.operations.refresh()).memoryContent).toContain(
    'Initial caller instructions.',
  );
  return { directory, file, memory };
}

async function settleFactorylessRelease(
  steps: ReadonlyArray<() => void | Promise<void>>,
  previous: string | undefined,
): Promise<void> {
  try {
    await runCleanupSteps(steps);
  } finally {
    if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previous;
  }
}
describe('supplied workspace memory lifetime through public adoption', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('retains the explicit preflight memory transfer through physical refresh and facade retirement', async () => {
    const { directory, file } = await physicalMemory();
    const built_directory = directory;
    const built_builtFactorylessPreviousReplay =
      process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('fixtures/' + 'plain-text.jsonl', import.meta.url),
    );
    const built_builtFactorylessDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'factoryless-caller-')),
    );
    const built_builtFactorylessConfig = new Config(
      toConfigParameters({
        ...{
          provider: 'fake',
          model: 'fake-model',
          workingDir: built_builtFactorylessDirectory,
        },
        ...{
          workingDir: built_directory,
          sessionId: 'same-memory-label',
          folderTrust: true,
          mcpEnabled: false,
          skillsSupport: false,
          recording: { enabled: false },
          telemetry: { enabled: false },
          settings: { jitContextEnabled: false },
        },
      }),
    );
    const built_builtFactorylessSettings = new SettingsService();
    for (const [built_key, built_value] of Object.entries(
      built_builtFactorylessConfig.getInitialSettings(),
    ))
      built_builtFactorylessSettings.set(built_key, built_value);
    const built_builtFactorylessSettingsOwner = new SessionSettingsOwner(
      built_builtFactorylessSettings,
    );
    built_builtFactorylessSettingsOwner.bindTelemetry(
      built_builtFactorylessConfig,
    );
    built_builtFactorylessSettingsOwner.initializeProviderSelection(
      built_builtFactorylessConfig.getProvider(),
      built_builtFactorylessConfig.getModel(),
    );
    const built_builtFactorylessPolicy = new RuntimePolicyOwner(
      built_builtFactorylessConfig,
    );
    const built_builtFactorylessClose = settleFactorylessRelease.bind(
      undefined,
      [
        () => built_builtFactorylessSettingsOwner.dispose(),
        () => built_builtFactorylessPolicy.dispose(),
        () => built_builtFactorylessConfig.dispose(),
        () =>
          rm(built_builtFactorylessDirectory, { recursive: true, force: true }),
      ],
      built_builtFactorylessPreviousReplay,
    );
    cleanups.push(built_builtFactorylessClose);
    const manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      built_builtFactorylessSettings,
      undefined,
      undefined,
      new CredentialAuthority(),
    );
    manager.registerProvider(
      new FakeProvider(join(import.meta.dir, 'fixtures/plain-text.jsonl')),
    );
    const operation = await assembleAgentActivationBootstrap(
      built_builtFactorylessConfig,
      built_builtFactorylessSettings,
      manager,
      null,
      () => undefined,
      'borrowed',
      undefined,
      undefined,
      undefined,
      undefined,
      built_builtFactorylessSettingsOwner,
      'borrowed',
      built_builtFactorylessPolicy.trust,
    );
    cleanups.push(async () => {
      await operation.dispose();
    });
    const intent = { provider: 'fake', model: 'fake-model' };
    const result = await operation.preflight(intent);
    expect(result.authFailed).toBe(false);
    if (!result.token) throw new Error('Missing actual preflight token');
    const facade = await fromConfig({
      config: built_builtFactorylessConfig,
      settingsService: built_builtFactorylessSettings,
      settingsOwner: built_builtFactorylessSettingsOwner,
      messageBus: built_builtFactorylessPolicy.session.messageBus,
      policyOwner: built_builtFactorylessPolicy,
      providerManager: manager,
      activation: intent,
      activationPreflight: { operation, token: result.token },
    });
    cleanups.push(() => facade.dispose());
    await writeFile(file, 'Transferred preflight instructions.');
    await facade.memory.refresh();
    expect(facade.memory.getMemory()).toContain(
      'Transferred preflight instructions.',
    );
    await facade.dispose();
    expect(() => operation.workspaceMemory.operations.refresh()).toThrow(
      'disposed',
    );
    expect(() => operation.workspaceMemory.operations.snapshot()).toThrow(
      'disposed',
    );
  });
});
