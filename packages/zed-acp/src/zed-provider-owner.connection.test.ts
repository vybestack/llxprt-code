import { journalFileRows } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { readJournalFileFacts } from '@vybestack/llxprt-code-core/recording/journalSessionListing.js';
import { SESSION_FILE_EXTENSION } from '@vybestack/llxprt-code-core/recording/sessionFileExtension.js';
import {
  SettingsService,
  ProfileManager,
} from '@vybestack/llxprt-code-settings';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
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

async function readRecording(path: string): Promise<string> {
  const facts = await readJournalFileFacts(path);
  const rows: string[] = [JSON.stringify(facts)];
  for await (const row of journalFileRows(path)) rows.push(JSON.stringify(row));
  return rows.join('\n');
}

interface ZedConnection {
  readonly route: RouteBPreflight;
  readonly client: acp.ClientSideConnection;
  readonly close: () => Promise<void>;
  readonly updates: acp.SessionUpdate[];
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
      const updates: acp.SessionUpdate[] = [];
      const client = new acp.ClientSideConnection(
        () => ({
          requestPermission: async () => ({
            outcome: { outcome: 'cancelled' },
          }),
          sessionUpdate: async ({ update }) => {
            updates.push(update);
          },
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
      return { route, client, close, updates };
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
  it('supports successive connections with the same owner label', async () => {
    const first = await openZedConnection(
      'repeat-label',
      firstCredentials().authority,
    );
    await first.client.authenticate({ methodId: 'alpha' });
    await first.close();
    const next = await openZedConnection(
      'repeat-label',
      firstCredentials().authority,
    );
    try {
      await next.client.authenticate({ methodId: 'beta' });
      expect(selectedModel(next.route.settings)).toBe('beta-model');
    } finally {
      await next.close();
    }
  });
  it('closes one session without disposing another session or the connection owner', async () => {
    const owner = await openZedConnection(
      'one-connection',
      firstCredentials().authority,
    );
    try {
      await owner.client.authenticate({ methodId: 'alpha' });
      const first = await owner.client.newSession({
        cwd: owner.route.directory,
        mcpServers: [],
      });
      const second = await owner.client.newSession({
        cwd: owner.route.directory,
        mcpServers: [],
      });
      await owner.client.closeSession({ sessionId: first.sessionId });
      await owner.client.closeSession({ sessionId: first.sessionId });
      expect(owner.route.preflight.getCurrentProfileName()).toBe('alpha');
      expect(
        (
          await owner.client.prompt({
            sessionId: second.sessionId,
            prompt: [{ type: 'text', text: 'surviving-session-marker' }],
          })
        ).stopReason,
      ).toBe('end_turn');
      const journalNames = await readdir(owner.route.config.projectChatsDir);
      const journals = await Promise.all(
        journalNames
          .filter((name) => name.endsWith(SESSION_FILE_EXTENSION))
          .map((name) =>
            readRecording(join(owner.route.config.projectChatsDir, name)),
          ),
      );
      expect(journals.join('\n')).toContain('surviving-session-marker');
    } finally {
      await owner.close();
    }
  });

  it('drives two real ACP sessions and prompts with equal labels while one connection closes', async () => {
    const first = await openZedConnection(
      'same-label',
      firstCredentials().authority,
    );
    const second = await openZedConnection(
      'same-label',
      secondCredentials().authority,
    );
    let firstClosed = false;
    try {
      await first.client.authenticate({ methodId: 'alpha' });
      await second.client.authenticate({ methodId: 'beta' });
      const sessionA = await first.client.newSession({
        cwd: first.route.directory,
        mcpServers: [],
      });
      const sessionB = await second.client.newSession({
        cwd: second.route.directory,
        mcpServers: [],
      });
      const promptA = await first.client.prompt({
        sessionId: sessionA.sessionId,
        prompt: [{ type: 'text', text: 'first-owner-marker' }],
      });
      const promptB = await second.client.prompt({
        sessionId: sessionB.sessionId,
        prompt: [{ type: 'text', text: 'second-owner-marker' }],
      });
      expect(promptA.stopReason).toBe('end_turn');
      expect(promptB.stopReason).toBe('end_turn');
      expect(first.updates.length).toBeGreaterThan(1);
      expect(second.updates.length).toBeGreaterThan(1);
      const firstJournals = await readdir(first.route.config.projectChatsDir);
      const secondJournals = await readdir(second.route.config.projectChatsDir);
      expect(
        firstJournals.some((name) => name.endsWith(SESSION_FILE_EXTENSION)),
      ).toBe(true);
      expect(
        secondJournals.some((name) => name.endsWith(SESSION_FILE_EXTENSION)),
      ).toBe(true);
      const firstRecording = await Promise.all(
        firstJournals
          .filter((name) => name.endsWith(SESSION_FILE_EXTENSION))
          .map((name) =>
            readRecording(join(first.route.config.projectChatsDir, name)),
          ),
      );
      expect(firstRecording.join('\n')).toContain(sessionA.sessionId);
      expect(firstRecording.join('\n')).toContain('first-owner-marker');
      expect(firstRecording.join('\n')).not.toContain('second-owner-marker');
      await first.close();
      firstClosed = true;
      await second.route.trust.setTrustedFolderLive(false);
      expect(second.route.trust.isTrustedFolder()).toBe(false);
      expect(first.route.trust.isTrustedFolder()).toBe(true);
      await expect(
        second.client.setSessionMode({
          sessionId: sessionB.sessionId,
          modeId: 'yolo',
        }),
      ).rejects.toThrow('Internal error');
      await second.route.trust.setTrustedFolderLive(true);
      expect(second.route.trust.isTrustedFolder()).toBe(true);
      await second.client.authenticate({ methodId: 'alpha' });
      await second.client.prompt({
        sessionId: sessionB.sessionId,
        prompt: [{ type: 'text', text: 'surviving-owner-marker' }],
      });
      const secondRecording = await Promise.all(
        secondJournals
          .filter((name) => name.endsWith(SESSION_FILE_EXTENSION))
          .map((name) =>
            readRecording(join(second.route.config.projectChatsDir, name)),
          ),
      );
      expect(secondRecording.join('\n')).toContain(sessionB.sessionId);
      expect(secondRecording.join('\n')).toContain('surviving-owner-marker');
      expect(secondRecording.join('\n')).not.toContain('first-owner-marker');
      expect(first.route.preflight).not.toBe(second.route.preflight);
      await second.client.closeSession({ sessionId: sessionB.sessionId });
      await second.client.closeSession({ sessionId: sessionB.sessionId });
      expect(second.route.preflight.getCurrentProfileName()).toBe('alpha');
      await expect(
        second.client.prompt({
          sessionId: sessionB.sessionId,
          prompt: [{ type: 'text', text: 'closed-owner-marker' }],
        }),
      ).rejects.toThrow('Internal error');
    } finally {
      if (!firstClosed) await first.close();
      await second.close();
    }
  });
});
