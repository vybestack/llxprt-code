/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { beginCliRuntimeRegistration } from '@vybestack/llxprt-code-providers/runtime/cliForegroundRuntime.js';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  Config,
  WorkspaceTrustLifecycle,
  WorkspaceFilesystemOwner,
  assembleWorkspaceMemory,
  type RuntimePolicyOwner,
  type RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import {
  MessageBusType,
  type ToolConfirmationRequest,
} from '@vybestack/llxprt-code-policy/confirmation-bus/types.js';
import {
  ProfileManager,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core';
import {
  prepareAgentPreflight,
  type AgentProfilePreflight,
} from '../profile-preflight.js';
import type { AgentActivationOperation } from '../activationPreflightState.js';
import { fromConfig } from '../fromConfig.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

import { assembleCliProviderRuntime } from '@vybestack/llxprt-code-providers/runtime/assembleCliProviderRuntime.js';

function transferred(
  operation: AgentProfilePreflight,
): AgentActivationOperation {
  let activation: AgentActivationOperation | undefined;
  operation.transferActivation((value) => {
    activation = value;
  });
  if (activation === undefined) throw new Error('Missing activation');
  return activation;
}

describe('preflight acquired lifetime', () => {
  const credentials = useOwnedCredentials();
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'preflight-release-'));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const settings = new SettingsService();
    const operation = await prepareAgentPreflight(
      { runtimeId: 'retained-root' },
      credentials().authority,
      settings,
    );
    cleanups.push(async () => {
      await operation.dispose().catch(() => undefined);
    });
    const config = new Config({
      sessionId: 'configured-root',
      cwd: root,
      targetDir: root,
      debugMode: false,
      model: 'test-model',
      provider: 'openai',
      profileDirectory: join(root, 'profiles'),
      mcpEnabled: false,
      skillsSupport: false,
      telemetry: { enabled: false },
    });
    const trust = new WorkspaceTrustLifecycle({ localTrust: true });
    const filesystem = new WorkspaceFilesystemOwner({
      targetDir: root,
      isTrusted: () => trust.isTrustedFolder(),
    });
    const memory = assembleWorkspaceMemory(config, filesystem, trust);
    cleanups.push(async () => {
      await memory.dispose();
      await filesystem.dispose();
      await trust.dispose();
      await config.dispose();
    });
    const attach = (
      policy?: (value: RuntimePolicyOwner) => void,
      manager?: (value: RuntimeProviderManager) => void,
      oauth?: (value: OAuthManager | undefined) => void,
    ) =>
      operation.preparePostConfiguration(
        config,
        filesystem,
        memory,
        trust,
        () => trust.dispose(),
        undefined,
        policy,
        manager,
        oauth,
      );
    return { root, settings, operation, config, attach };
  }

  async function retain(
    operation: AgentProfilePreflight,
    root: string,
    fileId: string,
  ) {
    const file = join(root, fileId);
    await writeFile(file, 'retained');
    return operation.retainProviderFile({
      cacheKey: file,
      fileId,
      bytes: 8,
      identity: {
        provider: 'fake',
        baseURL: 'http://127.0.0.1',
        credentialHash: 'preflight',
      },
      policy: {
        mode: 'enabled',
        scope: 'session',
        retentionMs: 60_000,
        deletion: 'delete',
        zeroDataRetention: 'incompatible-while-retained',
      },
      deleteRemote: () => rm(file),
    });
  }

  it('keeps successful legacy key and token transport ownership on their receiving owners', async () => {
    const runtime = await assembleCliProviderRuntime({
      runtimeId: 'legacy-successful-close',
      settingsService: new SettingsService(),
      config: undefined,
      credentialAuthority: credentials().authority,
    });
    try {
      await runtime.oauthManager?.getTokenStore().listProviders();
      runtime.providerManager.dispose?.();
      await runtime.oauthManager?.dispose();
      runtime.providerManager.dispose?.();
      await runtime.oauthManager?.dispose();
      expect(credentials().snapshot()).toStrictEqual([1]);
      expect(credentials().keySnapshot()).toStrictEqual([1]);
    } finally {
      runtime.registration.dispose();
    }
  });

  it('joins credential and subscription rollback before failed provider population rejects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preflight-population-'));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const settings = new SettingsService();
    const before = settings
      .eventNames()
      .reduce((total, event) => total + settings.listenerCount(event), 0);
    const previous = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = join(root, 'missing-responses.jsonl');
    try {
      await expect(
        Promise.resolve().then(() =>
          prepareAgentPreflight(
            { runtimeId: 'failed-population' },
            credentials().authority,
            settings,
          ),
        ),
      ).rejects.toThrow('missing-responses');
    } finally {
      if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previous;
    }
    expect(credentials().snapshot()).toStrictEqual([1]);
    expect(credentials().keySnapshot()).toStrictEqual([1]);
    expect(
      settings
        .eventNames()
        .reduce((total, event) => total + settings.listenerCount(event), 0),
    ).toBe(before);
  });

  it('closes credentials and retained files before Config exists', async () => {
    const { operation, root } = await fixture();
    const file = await retain(operation, root, 'pre-config-file');
    await file.lease.release();
    await operation.dispose();
    expect(await readdir(root)).not.toContain('pre-config-file');
    expect(operation.captureProviderFiles().retainedFiles).toBe(0);
    expect(credentials().snapshot()).toStrictEqual([1]);
    expect(credentials().keySnapshot()).toStrictEqual([1]);
  });
  it('joins legacy assembly rollback before reporting failed population', async () => {
    const { root, config } = await fixture();
    const previous = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = join(root, 'legacy-missing.jsonl');
    try {
      await expect(
        Promise.resolve().then(() =>
          assembleCliProviderRuntime({
            credentialAuthority: credentials().authority,
            settingsService: new SettingsService(),
            config,
            runtimeId: 'legacy-failure',
          }),
        ),
      ).rejects.toThrow('legacy-missing');
    } finally {
      if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previous;
    }
    expect(credentials().snapshot()).toStrictEqual([0, 1]);
    expect(credentials().keySnapshot()).toStrictEqual([0, 1]);
  });

  it('joins policy persistence failure before legacy acquisition rejection and keeps the primary failure first', async () => {
    const { config, settings } = await fixture();
    const home = process.env.LLXPRT_CONFIG_HOME;
    if (home === undefined) throw new Error('Missing isolated config home');
    await writeFile(join(home, 'policies'), 'not a directory');
    const registration = beginCliRuntimeRegistration(settings, config, {
      runtimeId: 'policy-rollback',
    });
    const authority = new (class extends CredentialAuthority {
      override createProviderKeyStorage(): ReturnType<
        CredentialAuthority['createProviderKeyStorage']
      > {
        return credentials().authority.createProviderKeyStorage();
      }
      override createTokenStore(): ReturnType<
        CredentialAuthority['createTokenStore']
      > {
        registration.messageBus.publish({
          type: MessageBusType.UPDATE_POLICY,
          toolName: 'read_file',
          persist: true,
        });
        readFileSync(join(home, 'missing-token-source'));
        return credentials().authority.createTokenStore();
      }
    })();
    const failure: unknown = await assembleCliProviderRuntime({
      credentialAuthority: authority,
      settingsService: settings,
      config,
      runtimeId: 'policy-rollback',
      registration,
    }).catch((error: unknown) => error);
    if (!(failure instanceof AggregateError))
      throw new Error('Missing joined policy failure');
    expect(failure.errors[0]).toMatchObject({
      code: 'ENOENT',
      path: join(home, 'missing-token-source'),
    });
    const leaves = (error: unknown): unknown[] =>
      error instanceof AggregateError ? error.errors.flatMap(leaves) : [error];
    expect(leaves(failure.errors[1])).toStrictEqual([
      expect.objectContaining({ code: 'EEXIST', path: join(home, 'policies') }),
    ]);
    expect(credentials().keySnapshot()).toStrictEqual([0, 1]);
    registration.dispose();
  });

  it('joins concurrent close while a real lease holds file deletion', async () => {
    const { operation, root } = await fixture();
    const retained = await retain(operation, root, 'held-file');
    let firstSettled = false;
    let secondSettled = false;
    const first = operation.dispose().then(() => {
      firstSettled = true;
    });
    const second = operation.dispose().then(() => {
      secondSettled = true;
    });
    await delay(20);
    expect([firstSettled, secondSettled]).toStrictEqual([false, false]);
    expect(credentials().snapshot()).toStrictEqual([0]);
    expect(credentials().keySnapshot()).toStrictEqual([0]);
    await retained.lease.release();
    await Promise.all([first, second]);
    expect(await readdir(root)).not.toContain('held-file');
    expect(credentials().snapshot()).toStrictEqual([1]);
    expect(credentials().keySnapshot()).toStrictEqual([1]);
  });

  it('preserves configured policy and OAuth for the receiving Agent after preflight disposal', async () => {
    const { operation, config, settings, attach } = await fixture();
    let policy: RuntimePolicyOwner | undefined;
    let manager: RuntimeProviderManager | undefined;
    let oauth: OAuthManager | undefined;
    await attach(
      (value) => {
        policy = value;
      },
      (value) => {
        manager = value;
      },
      (value) => {
        oauth = value;
      },
    );
    if (policy === undefined || manager === undefined || oauth === undefined)
      throw new Error('Missing published owners');
    const intent = { provider: 'openai', authMode: 'none' } as const;
    const receipt = await operation.preflight(intent);
    if (receipt.token === undefined) throw new Error('Activation failed');
    const activation = transferred(operation);
    cleanups.push(async () => {
      await activation.dispose();
    });
    const agent = await fromConfig({
      config,
      settingsService: settings,
      providerManager: manager,
      oauthManager: oauth,
      policyOwner: policy,
      credentialAuthority: credentials().authority,
      activation: intent,
      activationPreflight: { operation: activation, token: receipt.token },
    });
    cleanups.push(() => agent.dispose());
    const before = policy.session.decisions.evaluate('read_file', {
      path: config.getTargetDir(),
    });
    const bus = activation.messageBus;
    if (bus === undefined) throw new Error('Missing retained bus');
    let correlation: string | undefined;
    const unsubscribe = bus.subscribe<ToolConfirmationRequest>(
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
      (request) => {
        correlation = request.correlationId;
      },
    );
    const pending = bus.requestConfirmation(
      { name: 'preflight_unknown_tool', args: {} },
      {},
    );
    if (correlation === undefined)
      throw new Error('Confirmation did not enter');
    await operation.dispose();
    bus.publish({
      type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      correlationId: correlation,
      confirmed: true,
    });
    expect(await pending).toBe(true);
    unsubscribe();
    expect(
      policy.session.decisions.evaluate('read_file', {
        path: config.getTargetDir(),
      }),
    ).toBe(before);
    expect(before).not.toBe(PolicyDecision.DENY);
    expect(credentials().snapshot()).toStrictEqual([0]);
    await credentials().saveToken(0, 'retained', {
      access_token: 'after-transfer',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(await oauth.getTokenStore().listProviders()).toContain('retained');
    await agent.dispose();
    expect(credentials().snapshot()).toStrictEqual([1]);
    expect(credentials().keySnapshot()).toStrictEqual([1]);
    const configuredPolicy = policy;
    expect(() =>
      configuredPolicy.session.decisions.evaluate('read_file', {}),
    ).toThrow('disposed');
  });

  it('closes failed attachment and permits a fresh independent owner', async () => {
    const { operation, root, attach } = await fixture();
    await (await retain(operation, root, 'failure-file')).lease.release();
    await expect(
      attach(undefined, () => {
        throw new Error('Host publication failed');
      }),
    ).rejects.toThrow('Host publication failed');
    expect(await readdir(root)).not.toContain('failure-file');
    expect(credentials().snapshot()).toStrictEqual([1]);
    expect(credentials().keySnapshot()).toStrictEqual([1]);
    await expect(attach()).rejects.toThrow('disposed');
    const independent = await fixture();
    await independent.attach();
    expect(
      (await independent.operation.preflight({ authMode: 'none' })).authFailed,
    ).toBe(false);
  });
  it('attaches the retained OAuth reader to the configured repository and reads later edits', async () => {
    const { root, operation, settings, attach } = await fixture();
    const profiles = new ProfileManager(join(root, 'profiles'));
    await profiles.saveProfile('selected', {
      version: 1,
      provider: 'codex',
      model: 'configured',
      modelParams: {},
      ephemeralSettings: {},
    });
    settings.setCurrentProfileName('selected');
    let oauth: OAuthManager | undefined;
    await attach(undefined, undefined, (value) => {
      oauth = value;
    });
    if (oauth === undefined) throw new Error('Missing retained OAuth');
    await oauth.activateNamedLoginBucket('codex', 'first-login');
    expect(
      oauth.getSessionBucket('codex', {
        providerId: 'codex',
        profileId: 'selected',
      }),
    ).toBe('first-login');
    await profiles.saveProfile('selected', {
      version: 1,
      provider: 'anthropic',
      model: 'changed',
      modelParams: {},
      ephemeralSettings: {},
    });
    await oauth.activateNamedLoginBucket('codex', 'second-login');
    expect(
      oauth.getSessionBucket('codex', {
        providerId: 'codex',
        profileId: 'selected',
      }),
    ).toBe('first-login');
    await operation.dispose();
    expect(credentials().snapshot()).toStrictEqual([1]);
    expect(credentials().keySnapshot()).toStrictEqual([1]);
  });

  it('keeps a host failure first while joining file failure and credential release, then permits file remediation', async () => {
    const { root, operation, attach } = await fixture();
    const retained = await retain(operation, root, 'failed-deletion');
    await retained.lease.release();
    await rm(join(root, 'failed-deletion'));
    const primary = new Error('Host refused manager publication');
    const failure: unknown = await attach(undefined, () => {
      throw primary;
    }).catch((error: unknown) => error);
    if (!(failure instanceof AggregateError))
      throw new Error('Missing joined startup error');
    expect(failure.errors[0]).toBe(primary);
    expect(failure.errors[1]).toBeInstanceOf(Error);
    expect(
      operation
        .captureProviderFiles()
        .deletionFailures.map((entry) => entry.fileId),
    ).toStrictEqual(['failed-deletion']);
    expect(credentials().snapshot()).toStrictEqual([1]);
    expect(credentials().keySnapshot()).toStrictEqual([1]);
    const first = await operation.dispose().catch((error: unknown) => error);
    const second = await operation.dispose().catch((error: unknown) => error);
    expect(second).toBe(first);
    await writeFile(join(root, 'failed-deletion'), 'repaired');
    expect((await operation.retryProviderFileCleanup()).deleted).toBe(1);
    expect(operation.captureProviderFiles().retainedFiles).toBe(0);
  });
});
