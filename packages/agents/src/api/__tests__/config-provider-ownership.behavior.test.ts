import {
  ApprovalMode,
  Config,
} from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { fromConfig } from '../fromConfig.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { makeToken } from './helpers/provider-auth-fixtures.js';
import { drain } from './helpers/agentHarness.js';

interface CallerConfig {
  readonly config: Config;
  readonly settings: SettingsService;
  readonly close: () => Promise<void>;
}

async function openCallerConfig(): Promise<CallerConfig> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'config-provider-ownership-')),
  );
  const config = new Config(
    toConfigParameters({
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      workingDir: directory,
    }),
  );
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
  return {
    config,
    settings,
    close: () =>
      runCleanupSteps([
        () => config.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ]),
  };
}

describe('explicit provider owner construction', () => {
  useFakeResponsesReplay('multi-turn-text.jsonl');
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

  it('constructs a public Agent without storing manager authority on Config', async () => {
    const built = await openRouteAAgent({
      authority: credentials().authority,
    });
    try {
      const events = await drain(
        built.agent.stream('Construct without a Config service locator'),
      );
      expect(events.some((event) => event.type === 'text')).toBe(true);
      expect('providerManager' in built.config).toBe(false);
      expect('getProviderManager' in built.config).toBe(false);
      expect('setProviderManager' in built.config).toBe(false);
    } finally {
      await built.close();
    }
  });

  it('adopts an initialized Config without Config manager discovery', async () => {
    const caller = await openCallerConfig();
    Object.defineProperty(caller.config, 'getProviderManager', {
      configurable: true,
      value: () => {
        throw new Error('Forbidden Config provider manager discovery');
      },
    });
    const agent = await fromConfig(
      caller.config,
      caller.settings,
      {},
      credentials().authority,
    ).catch((primary: unknown) =>
      caller.close().then(() => {
        throw primary;
      }),
    );
    try {
      caller.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
      expect(agent.getApprovalMode()).toBe(ApprovalMode.AUTO_EDIT);
      const events = await drain(agent.stream('Adopt the explicit owner'));
      expect(events.some((event) => event.type === 'text')).toBe(true);
      await expect(agent.dispose()).resolves.toBeUndefined();
    } finally {
      await runCleanupSteps([() => agent.dispose(), () => caller.close()]);
    }
  });

  it('rolls back adopt-owned resources and leaves the Config unchanged when activation fails', async () => {
    const caller = await openCallerConfig();
    try {
      await expect(
        fromConfig(
          caller.config,
          caller.settings,
          { activation: { provider: 'missing-provider', authMode: 'auto' } },
          credentials().authority,
        ),
      ).rejects.toThrow('activation failed');
      expect(caller.config.getProvider()).toBe('fake');
      expect(credentials().snapshot()).toStrictEqual([1]);
    } finally {
      await caller.close();
    }
  });

  it('publishes telemetry changes to an explicit lifecycle subscriber without manager ownership', async () => {
    const caller = await openCallerConfig();
    const settings = new SessionSettingsOwner(caller.settings);
    settings.bindTelemetry(caller.config);
    const observed: boolean[] = [];
    const unsubscribe = settings.onTelemetrySettingsChange(() =>
      observed.push(settings.readTelemetrySettings().enabled === true),
    );
    try {
      await settings.updateTelemetrySettings({ enabled: true });
      expect(observed.length).toBe(1);
      unsubscribe();
      await settings.updateTelemetrySettings({ enabled: false });
      expect(observed).toHaveLength(1);
    } finally {
      await runCleanupSteps([() => settings.dispose(), () => caller.close()]);
    }
  });

  it("reports token status from the supplied authority's token store and keeps stored tokens after dispose", async () => {
    const store = credentials().authority.createTokenStore();
    const built = await openRouteAAgent({
      authority: credentials().authority,
    });
    try {
      expect(
        (await built.agent.auth.detailedStatus('codex')).authenticated,
      ).toBe(false);
      await store.saveToken('codex', makeToken('supplied-authority'));
      expect(
        (await built.agent.auth.detailedStatus('codex')).authenticated,
      ).toBe(true);
      await built.agent.dispose();
      expect(await store.getToken('codex')).not.toBeNull();
      expect(credentials().snapshot()).toStrictEqual([0, 1]);
      await store.removeToken('codex');
      expect(await store.getToken('codex')).toBeNull();
    } finally {
      await built.close();
    }
  });
});
