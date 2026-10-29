import { fromConfig } from '../fromConfig.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { toConfigParameters } from '../agentConfig.adapter.js';

import { readdir } from 'node:fs/promises';

import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { beforeAll, afterAll, describe, expect, it, afterEach } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';

describe('fromConfig admission before resource effects', () => {
  useOwnedCredentials();
  useFakeResponsesReplay('plain-text.jsonl');

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

  it('rejects an empty intent.sessionId before workspace, media or credential effects', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'from-config-admission-')),
    );
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const config = new Config(
      toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: directory,
        folderTrust: true,
        mcpEnabled: false,
        skillsSupport: false,
        recording: { enabled: false },
        telemetry: { enabled: false },
        settings: { jitContextEnabled: false },
      }),
    );
    cleanups.push(() => config.dispose());
    const settings = new SettingsService();
    for (const [key, value] of Object.entries(config.getInitialSettings()))
      settings.set(key, value);
    await expect(
      rejectWithoutAcquisition(config.getTargetDir(), () =>
        fromConfig(
          config,
          settings,
          { sessionId: ' ' },
          credentials().authority,
        ),
      ),
    ).resolves.toMatchObject({ message: expect.stringMatching(/runtimeId/i) });
  });
});
