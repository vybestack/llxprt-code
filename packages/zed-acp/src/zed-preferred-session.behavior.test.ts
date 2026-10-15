/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import * as acp from '@agentclientprotocol/sdk';
import {
  buildZedSessionAgent,
  captureZedHostInputs,
} from './zed-session-agent.js';
import { useOwnedCredentials } from '../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { runCleanupSteps } from '../../agents/src/core/subagent-cleanup.js';

describe('ACP preferred privately owned session construction', () => {
  const credentials = useOwnedCredentials();
  const cleanup: Array<() => void | Promise<void>> = [];
  let directory: string;
  beforeEach(async () => {
    directory = await realpath(
      await mkdtemp(join(tmpdir(), 'acp-preferred-session-')),
    );
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
  });
  afterEach(async () => runCleanupSteps(cleanup.splice(0).reverse()));
  it('restores separate persisted selection, borrows live overrides and host trust updates, and retains physical workspace and peer after disposal', async () => {
    const host = new Config({
      sessionId: 'host',
      targetDir: directory,
      cwd: directory,
      model: 'host-model',
      provider: 'openai',
      debugMode: false,
      coreTools: ['read_file'],
    });
    cleanup.push(() => host.dispose());
    const parent = new WorkspaceTrustLifecycle({ localTrust: true });
    cleanup.push(() => parent.dispose());
    const source = new SettingsService();
    source.set('activeProvider', 'openai');
    source.setProviderSetting('openai', 'model', 'selected-session-model');
    const connection = createConnection();
    const agent = await buildZedSessionAgent(
      host,
      captureZedHostInputs(host),
      connection,
      undefined,
      'child-one',
      directory,
      source,
      parent,
      { credentialAuthority: credentials().authority },
    );
    cleanup.push(() => agent.dispose());
    source.setProviderSetting('openai', 'model', 'later-host-model');
    const peer = await buildZedSessionAgent(
      host,
      captureZedHostInputs(host),
      connection,
      undefined,
      'child-two',
      directory,
      source,
      parent,
      { credentialAuthority: credentials().authority },
    );
    cleanup.push(() => peer.dispose());
    expect(agent.getModel()).toBe('selected-session-model');
    expect(peer.getModel()).toBe('later-host-model');
    source.setSessionScoped('dumpcontext', 'on');
    expect(agent.getEphemeralSetting('dumpcontext')).toBe('on');
    expect(() =>
      agent.settings.setSessionSetting('dumpcontext', 'off'),
    ).toThrow('read-only');
    const file = join(directory, 'owned-workspace.txt');
    await writeFile(file, 'physical owner data');
    expect(await agent.workspace.readTextFile(file)).toBe(
      'physical owner data',
    );
    await agent.ide.setTrustedFolderLive(false);
    expect(parent.isTrustedFolder()).toBe(true);
    expect(peer.ide.isTrustedFolder()).toBe(true);
    await agent.dispose();
    await parent.setTrustedFolderLive(false);
    expect(peer.ide.isTrustedFolder()).toBe(false);
    expect(await peer.workspace.readTextFile(file)).toBe('physical owner data');
    expect(source.getProviderSettings('openai').model).toBe('later-host-model');
  });
  it('creates an unconfigured session for selection without admitting model work', async () => {
    const host = new Config({
      sessionId: 'unconfigured-host',
      targetDir: directory,
      cwd: directory,
      model: 'declaration-model',
      debugMode: false,
      telemetry: { enabled: false },
    });
    cleanup.push(() => host.dispose());
    const parent = new WorkspaceTrustLifecycle({ localTrust: true });
    cleanup.push(() => parent.dispose());
    const source = new SettingsService();
    const agent = await buildZedSessionAgent(
      host,
      captureZedHostInputs(host),
      createConnection(),
      undefined,
      'unconfigured-child',
      directory,
      source,
      parent,
      { credentialAuthority: credentials().authority },
    );
    cleanup.push(() => agent.dispose());
    expect(agent.listProviders().map((item) => item.name)).toContain('openai');
    const result = await agent.chat('must not issue a provider request');
    expect(result.finishReason).toBe('error');
    expect(result.error?.message).toContain('/setup');
    expect(source.get('activeProvider')).toBeUndefined();
    await agent.setProvider('openai', 'selected-after-startup');
    expect(agent.getProvider()).toBe('openai');
    expect(agent.getModel()).toBe('selected-after-startup');
  });
});

function createConnection(): acp.AgentSideConnection {
  const unusedRpc = (): never => {
    throw new Error('Unexpected ACP RPC');
  };
  return new acp.AgentSideConnection(
    () => ({
      initialize: unusedRpc,
      newSession: unusedRpc,
      authenticate: unusedRpc,
      prompt: unusedRpc,
      cancel: unusedRpc,
    }),
    acp.ndJsonStream(
      new WritableStream<Uint8Array>(),
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      }),
    ),
  );
}
