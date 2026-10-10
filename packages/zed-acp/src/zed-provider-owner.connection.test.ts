/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import * as acp from '@agentclientprotocol/sdk';
import {
  createAgent,
  assembleProfileApplication,
  assembleProviderSwitch,
} from '@vybestack/llxprt-code-agents';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCliStyleConfig } from '../../agents/src/api/__tests__/helpers/buildCliStyleConfig.js';
import { serveZedConnection } from './runZedIntegration.js';

const roots: string[] = [];

async function openZed(label: string) {
  const root = await mkdtemp(join(tmpdir(), 'zed-owner-'));
  roots.push(root);
  const built = await buildCliStyleConfig('multi-turn-text.jsonl', {
    workingDir: root,
    sessionId: label,
    settings: { profileDirectory: join(root, 'profiles') },
  });
  const config = built.config;
  const profiles = new ProfileManager(join(root, 'profiles'));
  for (const name of ['alpha', 'beta']) {
    await profiles.saveProfile(name, {
      version: 1,
      provider: 'fake',
      model: `${name}-model`,
      modelParams: {},
      ephemeralSettings: {},
    });
  }
  const manager = built.providerManager;

  const application = assembleProfileApplication(
    config,
    built.settingsService,
    manager,
    null,
    assembleProviderSwitch(
      config,
      built.settingsService,
      manager,
      null,
      () => undefined,
      () => built.sessionClient.refreshAuth(),
      built.settingsOwner,
    ),
    built.settingsOwner,
    profiles,
  );
  const fromClient = new TransformStream<Uint8Array, Uint8Array>();
  const fromAgent = new TransformStream<Uint8Array, Uint8Array>();
  const updates: acp.SessionUpdate[] = [];
  const client = new acp.ClientSideConnection(
    () => ({
      requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
      sessionUpdate: async ({ update }) => {
        updates.push(update);
      },
    }),
    acp.ndJsonStream(fromClient.writable, fromAgent.readable),
  );
  const serving = serveZedConnection(
    {
      config,
      trustPort: built.mcpRuntime.trust,
      createSessionSettings: () => built.settingsOwner.createChildStore(),
      providerManager: manager,
      profileApplication: application,
      profileDefinitions: built.mcpRuntime.profileDefinitions,
    },
    acp.ndJsonStream(fromAgent.writable, fromClient.readable),
  );
  await client.initialize({
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: {},
  });
  return {
    config,
    client,
    built,
    serving,
    root,
    updates,
    close: async () => {
      await fromClient.writable.close();
      await serving;
      await built.cleanup();
    },
  };
}

describe('Zed ACP provider ownership', () => {
  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it('keeps two same-label Agent/Zed connections independent across auth, model and recording, and cleanup', async () => {
    const label = 'equal-zed-agent-label';
    const first = await openZed(label);
    const second = await openZed(label);
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
        first.built.settingsOwner.readSelectedModel(),
        second.built.settingsOwner.readSelectedModel(),
        sibling.captureProfile().model,
      ]).toStrictEqual(['alpha-model', 'beta-model', 'agent-own-model']);
      expect(first.built.settingsService.getCurrentProfileName()).toBe('alpha');
      expect(second.built.settingsService.getCurrentProfileName()).toBe('beta');
      expect(first.built.providerManager).not.toBe(
        second.built.providerManager,
      );
      expect(first.built.runtime.oauthManager).not.toBe(
        second.built.runtime.oauthManager,
      );
      await first.close();
      await second.client.authenticate({ methodId: 'alpha' });
      await sibling.setModel('agent-after-first-close');
      expect([
        second.built.settingsOwner.readSelectedModel(),
        sibling.captureProfile().model,
      ]).toStrictEqual(['alpha-model', 'agent-after-first-close']);
      expect(sibling.session.getRecording().enabled).toBe(true);
    } finally {
      await second.close();
      await sibling.dispose();
    }
  });

  it('supports successive connections with the same owner label', async () => {
    const first = await openZed('repeat-label');
    await first.client.authenticate({ methodId: 'alpha' });
    await first.close();
    const next = await openZed('repeat-label');
    try {
      await next.client.authenticate({ methodId: 'beta' });
      expect(next.built.settingsOwner.readSelectedModel()).toBe('beta-model');
    } finally {
      await next.close();
    }
  });
  it('closes one session without disposing another session or the connection owner', async () => {
    const owner = await openZed('one-connection');
    try {
      await owner.client.authenticate({ methodId: 'alpha' });
      const first = await owner.client.newSession({
        cwd: owner.root,
        mcpServers: [],
      });
      const second = await owner.client.newSession({
        cwd: owner.root,
        mcpServers: [],
      });
      await owner.client.closeSession({ sessionId: first.sessionId });
      await owner.client.closeSession({ sessionId: first.sessionId });
      expect(owner.built.mcpRuntime.isStopped()).toBe(false);
      expect(
        (
          await owner.client.prompt({
            sessionId: second.sessionId,
            prompt: [{ type: 'text', text: 'surviving-session-marker' }],
          })
        ).stopReason,
      ).toBe('end_turn');
      const journalNames = await readdir(owner.config.projectChatsDir);
      const journals = await Promise.all(
        journalNames
          .filter((name) => name.endsWith('.jsonl'))
          .map((name) =>
            readFile(join(owner.config.projectChatsDir, name), 'utf8'),
          ),
      );
      expect(journals.join('\n')).toContain('surviving-session-marker');
    } finally {
      await owner.close();
    }
  });

  it('drives two real ACP sessions and prompts with equal labels while one connection closes', async () => {
    const first = await openZed('same-label');
    const second = await openZed('same-label');
    let firstClosed = false;
    try {
      await first.client.authenticate({ methodId: 'alpha' });
      await second.client.authenticate({ methodId: 'beta' });
      const sessionA = await first.client.newSession({
        cwd: first.root,
        mcpServers: [],
      });
      const sessionB = await second.client.newSession({
        cwd: second.root,
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
      const firstJournals = await readdir(first.config.projectChatsDir);
      const secondJournals = await readdir(second.config.projectChatsDir);
      expect(firstJournals.some((name) => name.endsWith('.jsonl'))).toBe(true);
      expect(secondJournals.some((name) => name.endsWith('.jsonl'))).toBe(true);
      const firstRecording = await Promise.all(
        firstJournals
          .filter((name) => name.endsWith('.jsonl'))
          .map((name) =>
            readFile(join(first.config.projectChatsDir, name), 'utf8'),
          ),
      );
      expect(firstRecording.join('\n')).toContain(sessionA.sessionId);
      expect(firstRecording.join('\n')).toContain('first-owner-marker');
      expect(firstRecording.join('\n')).not.toContain('second-owner-marker');
      await first.close();
      firstClosed = true;
      await second.built.mcpRuntime.trust.setTrustedFolderLive(false);
      expect(second.built.mcpRuntime.trust.isTrustedFolder()).toBe(false);
      expect(first.built.mcpRuntime.trust.isTrustedFolder()).toBe(true);
      await expect(
        second.client.setSessionMode({
          sessionId: sessionB.sessionId,
          modeId: 'yolo',
        }),
      ).rejects.toThrow('Internal error');
      await second.built.mcpRuntime.trust.setTrustedFolderLive(true);
      expect(second.built.mcpRuntime.trust.isTrustedFolder()).toBe(true);
      await second.built.mcpRuntime.awaitDiscovery();
      await second.client.authenticate({ methodId: 'alpha' });
      await second.client.prompt({
        sessionId: sessionB.sessionId,
        prompt: [{ type: 'text', text: 'surviving-owner-marker' }],
      });
      const secondRecording = await Promise.all(
        secondJournals
          .filter((name) => name.endsWith('.jsonl'))
          .map((name) =>
            readFile(join(second.config.projectChatsDir, name), 'utf8'),
          ),
      );
      expect(secondRecording.join('\n')).toContain(sessionB.sessionId);
      expect(secondRecording.join('\n')).toContain('surviving-owner-marker');
      expect(secondRecording.join('\n')).not.toContain('first-owner-marker');
      expect(first.built.providerManager).not.toBe(
        second.built.providerManager,
      );
      await second.client.closeSession({ sessionId: sessionB.sessionId });
      await second.client.closeSession({ sessionId: sessionB.sessionId });
      expect(second.built.mcpRuntime.isStopped()).toBe(false);
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
