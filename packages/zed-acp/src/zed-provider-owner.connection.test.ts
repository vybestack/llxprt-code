import {
  SettingsService,
  ProfileManager,
} from '@vybestack/llxprt-code-settings';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { runCleanupSteps } from '../../agents/src/core/subagent-cleanup.js';
import { beforeAll, afterAll, describe, expect, it, afterEach } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { createAgent } from '../../agents/src/api/createAgent.js';
import { useFakeResponsesReplay } from '../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import { useOwnedCredentials } from '../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  openRouteBPreflight,
  type RouteBPreflight,
} from '../../agents/src/api/__tests__/helpers/route-b-preflight.js';
import { serveZedConnection } from './runZedIntegration.js';
import * as acp from '@agentclientprotocol/sdk';

interface ZedConnection {
  readonly route: RouteBPreflight;
  readonly client: acp.ClientSideConnection;
  readonly close: () => Promise<void>;
}

function selectedModel(settings: SettingsService): unknown {
  const provider = settings.get('activeProvider');
  if (typeof provider !== 'string') return undefined;
  return settings.getProviderSettings(provider).model;
}

describe('Zed ACP provider ownership', () => {
  let promptDirectory: string;

  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;

  useFakeResponsesReplay('multi-turn-text.jsonl');

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

  const roots: string[] = [];

  const firstCredentials = useOwnedCredentials();

  const secondCredentials = useOwnedCredentials();

  /**
   * One Zed connection served the way the CLI serves it
   * (`handleActivatedZedIntegration`): the foreground preflight is both the
   * profile application and the trust port, profile definitions come from the
   * preflight, and each session's settings are restored from the preflight's
   * settings snapshot.
   */
  async function openZedConnection(
    label: string,
    authority: CredentialAuthority,
  ): Promise<ZedConnection> {
    const root = await mkdtemp(join(tmpdir(), 'zed-owner-'));
    roots.push(root);
    const route = await openRouteBPreflight({
      authority,
      config: {
        workingDir: root,
        sessionId: label,
        settings: { profileDirectory: join(root, 'profiles') },
      },
    });
    const fromClient = new TransformStream<Uint8Array, Uint8Array>();
    const fromAgent = new TransformStream<Uint8Array, Uint8Array>();
    let serving: Promise<void> | undefined;
    const close = (): Promise<void> =>
      runCleanupSteps([
        () => fromClient.writable.close(),
        () => serving,
        () => route.close(),
      ]);
    try {
      await route.prepare();
      const profiles = new ProfileManager(join(root, 'profiles'));
      for (const name of ['alpha', 'beta'])
        await profiles.saveProfile(name, {
          version: 1,
          provider: 'fake',
          model: name + '-model',
          modelParams: {},
          ephemeralSettings: {},
        });
      const client = new acp.ClientSideConnection(
        () => ({
          requestPermission: async () => ({
            outcome: { outcome: 'cancelled' },
          }),
          sessionUpdate: async () => {},
        }),
        acp.ndJsonStream(fromClient.writable, fromAgent.readable),
      );
      serving = serveZedConnection(
        {
          config: route.config,
          trustPort: route.preflight,
          createSessionSettings: () => {
            const session = new SettingsService();
            session.restoreFromStateSnapshot(
              route.preflight.captureSettingsSnapshot(),
            );
            return session;
          },
          profileApplication: route.preflight,
          profileDefinitions: {
            listProfiles: () => route.preflight.listProfiles(),
          },
          providerInputs: { credentialAuthority: authority },
        },
        acp.ndJsonStream(fromAgent.writable, fromClient.readable),
      );
      await client.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      return { route, client, close };
    } catch (primary) {
      await close();
      throw primary;
    }
  }

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it('keeps two same-label Agent/Zed connections independent across auth, model and recording, and cleanup', async () => {
    const label = 'equal-zed-agent-label';
    const first = await openZedConnection(label, firstCredentials().authority);
    const second = await openZedConnection(
      label,
      secondCredentials().authority,
    );
    const sibling = await createAgent({
      provider: 'openai',
      model: 'gpt-4o-mini',
      workingDir: process.cwd(),
      sessionId: label,
      auth: { apiKey: 'agent-key', baseUrl: 'http://127.0.0.1:1/v1' },
    });
    try {
      await first.client.authenticate({ methodId: 'alpha' });
      await second.client.authenticate({ methodId: 'beta' });
      await sibling.session.setRecording({ enabled: true });
      await sibling.setModel('agent-own-model');
      expect([
        selectedModel(first.route.settings),
        selectedModel(second.route.settings),
        sibling.captureProfile().model,
      ]).toStrictEqual(['alpha-model', 'beta-model', 'agent-own-model']);
      expect(first.route.preflight.getCurrentProfileName()).toBe('alpha');
      expect(second.route.preflight.getCurrentProfileName()).toBe('beta');
      await first.close();
      await second.client.authenticate({ methodId: 'alpha' });
      await sibling.setModel('agent-after-first-close');
      expect([
        selectedModel(second.route.settings),
        sibling.captureProfile().model,
      ]).toStrictEqual(['alpha-model', 'agent-after-first-close']);
      expect(sibling.session.getRecording().enabled).toBe(true);
    } finally {
      await second.close();
      await sibling.dispose();
    }
  });
});
