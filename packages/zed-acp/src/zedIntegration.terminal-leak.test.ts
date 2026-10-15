/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'bun:test';
import * as acp from '@agentclientprotocol/sdk';
import { Config } from '@vybestack/llxprt-code-core';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { useOwnedCredentials } from '../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { installZedDefinitionFixture } from './__tests__/definition-fixture.js';
import { RecordingConnection } from './__tests__/zed-test-helpers.js';
import { unusedProfileApplication } from './test-profile-application.js';
import { ZedAgent } from './zedIntegration.js';

const definitions = installZedDefinitionFixture();

describe('ACP terminal-capable session acquisition rollback', () => {
  const credentials = useOwnedCredentials();
  afterEach(() => vi.restoreAllMocks());

  it('releases acquired session subscriptions and keys before token transport failure rejects after terminal setup', async () => {
    const owners: SessionSettingsOwner[] = [];
    const bind = SessionSettingsOwner.prototype.bindTelemetry;
    vi.spyOn(
      SessionSettingsOwner.prototype,
      'bindTelemetry',
    ).mockImplementation(function (this: SessionSettingsOwner, ...args) {
      owners.push(this);
      return bind.apply(this, args);
    });
    const failure = new Error('terminal-session token transport failed');
    vi.spyOn(credentials().authority, 'createTokenStore').mockImplementation(
      () => {
        throw failure;
      },
    );
    const config = new Config({
      sessionId: 'host',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      provider: 'openai',
      model: 'terminal-model',
      debugMode: false,
    });
    const source = new SettingsService();
    const agent = new ZedAgent(
      config,
      new RecordingConnection() as unknown as acp.AgentSideConnection,
      unusedProfileApplication,
      () => new SettingsService({ sessionSource: source }),
      undefined,
      definitions(),
      undefined,
      { credentialAuthority: credentials().authority },
    );
    try {
      await agent.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: { terminal: true },
      });
      await expect(
        agent.newSession({ cwd: process.cwd(), mcpServers: [] }),
      ).rejects.toBe(failure);
      expect(credentials().keySnapshot()).toStrictEqual([1]);
      expect(credentials().snapshot()).toStrictEqual([]);
      const owner = owners.at(0);
      if (!owner) throw new Error('Session settings were not acquired');
      await expect(
        owner.updateTelemetrySettings({ enabled: true }),
      ).rejects.toThrow('Session settings owner is closed');
      source.setSessionScoped('dumpcontext', 'on');
      expect(source.getSessionScoped('dumpcontext')).toBe('on');
    } finally {
      await agent.disposeAll();
      await config.dispose();
    }
  });
});
