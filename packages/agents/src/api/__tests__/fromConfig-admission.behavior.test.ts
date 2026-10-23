import { captureAgentAdoption as fromConfig } from './helpers/agent-resource-capture.js';
import { CallerAgentRuntimeFactories } from './helpers/fixture-data.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';

import { readdir } from 'node:fs/promises';

import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { beforeAll, afterAll, describe, expect, it, afterEach } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';

describe('fromConfig admission before resource effects', () => {
  useOwnedCredentials();

  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  const credentials = useOwnedCredentials();

  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function rejectWithoutAcquisition(
    workspaceDirectory: string,
    adopt: () => ReturnType<typeof fromConfig>,
  ): Promise<unknown> {
    const home = process.env.LLXPRT_CONFIG_HOME;
    if (home === undefined) throw new Error('Missing fixture config home');
    const before = (await readdir(home, { recursive: true })).sort();
    const workspaceBefore = (
      await readdir(workspaceDirectory, { recursive: true })
    ).sort();
    const transports = credentials().snapshot();
    const outcome = await adopt().then(
      async (agent) => {
        await agent.dispose();
        return undefined;
      },
      (error: unknown) => error,
    );
    const after = await readdir(home, { recursive: true });
    const workspaceAfter = await readdir(workspaceDirectory, {
      recursive: true,
    });
    expect([
      ...after.filter((entry) => !before.includes(entry)),
      ...before.filter((entry) => !after.includes(entry)),
    ]).toStrictEqual([]);
    expect([
      ...workspaceAfter.filter((entry) => !workspaceBefore.includes(entry)),
      ...workspaceBefore.filter((entry) => !workspaceAfter.includes(entry)),
    ]).toStrictEqual([]);
    expect(credentials().snapshot().length - transports.length).toBe(0);
    return outcome;
  }

  it('rejects a borrowed settings owner from another store before workspace or media creation', async () => {
    const builtDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'from-config-admission-')),
    );
    cleanups.push(() => rm(builtDirectory, { recursive: true, force: true }));
    const builtOverrides = {
      workingDir: builtDirectory,
      folderTrust: true,
      mcpEnabled: false,
      skillsSupport: false,
      recording: { enabled: false },
      telemetry: { enabled: false },
      settings: { jitContextEnabled: false },
    };
    const builtFactorylessPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('fixtures/' + 'plain-text.jsonl', import.meta.url),
    );
    const builtFactorylessDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'factoryless-caller-')),
    );
    const builtFactorylessSupplied: CallerAgentRuntimeFactories = {};
    const builtFactorylessConfig = new Config(
      toConfigParameters({
        ...{
          provider: 'fake',
          model: 'fake-model',
          workingDir: builtFactorylessDirectory,
        },
        ...builtOverrides,
      }),
    );
    const builtFactorylessSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      builtFactorylessConfig.getInitialSettings(),
    ))
      builtFactorylessSettings.set(key, value);
    const builtFactorylessSettingsOwner = new SessionSettingsOwner(
      builtFactorylessSettings,
    );
    builtFactorylessSettingsOwner.bindTelemetry(builtFactorylessConfig);
    builtFactorylessSettingsOwner.initializeProviderSelection(
      builtFactorylessConfig.getProvider(),
      builtFactorylessConfig.getModel(),
    );
    const builtFactorylessPolicy = new RuntimePolicyOwner(
      builtFactorylessConfig,
    );
    const builtFactorylessTask = builtFactorylessSupplied.taskToolRegistration;
    const builtFactorylessFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...(builtFactorylessSupplied.agentClientFactory
        ? { agentClientFactory: builtFactorylessSupplied.agentClientFactory }
        : {}),
      ...(builtFactorylessTask
        ? { taskToolRegistration: () => builtFactorylessTask }
        : {}),
    };

    const builtFactorylessClose = settleFactorylessRelease.bind(
      undefined,
      [
        () => builtFactorylessSettingsOwner.dispose(),
        () => builtFactorylessPolicy.dispose(),
        () => builtFactorylessConfig.dispose(),
        () => rm(builtFactorylessDirectory, { recursive: true, force: true }),
      ],
      builtFactorylessPreviousReplay,
    );
    cleanups.push(builtFactorylessClose);
    await expect(
      rejectWithoutAcquisition(builtFactorylessConfig.getTargetDir(), () =>
        fromConfig(
          builtFactorylessConfig,
          new SettingsService(),
          {},
          builtFactorylessSettingsOwner,
          undefined,
          undefined,
          builtFactorylessPolicy.session.messageBus,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          builtFactorylessFactories,
          undefined,
          credentials().authority,
          builtFactorylessPolicy,
        ),
      ),
    ).resolves.toMatchObject({ message: expect.stringMatching(/settings/i) });
  });
});
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
