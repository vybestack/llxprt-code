/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  Config,
  MessageBus,
  WorkspaceTrustLifecycle,
  WorkspaceFilesystemOwner,
  assembleWorkspaceMemory,
} from '@vybestack/llxprt-code-core';
import { MessageBusType } from '@vybestack/llxprt-code-policy/confirmation-bus/types.js';
import type { IOAuthSettingsProvider } from '@vybestack/llxprt-code-auth';
import {
  ProfileManager,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import {
  createOwnedTokenStoreClose,
  createOwnerOAuthManager,
  createPreflightOAuthProfileReads,
  createSessionAuthPolicyReader,
} from '@vybestack/llxprt-code-providers/composition.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import {
  prepareAgentPreflight,
  AgentProfilePreflight,
} from '../profile-preflight.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  countType,
  drain,
  ToolConfirmationOutcome,
  type Agent,
  type ToolConfirmation,
} from './helpers/agentHarness.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

import { cleanupFailedCreatedAgent } from '../createAgent.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';

const oauthSettings: IOAuthSettingsProvider = {
  isOAuthEnabled: () => true,
  getProviderApiKey: () => undefined,
  getProviderKeyfile: () => undefined,
  getProviderBaseUrl: () => undefined,
  getOAuthEnabledProviders: () => ({ codex: true }),
  setOAuthEnabled: () => {},
};

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
    const attach = (): Promise<void> =>
      operation.preparePostConfiguration(
        config,
        filesystem,
        memory,
        trust,
        () => trust.dispose(),
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

  it('keeps successful key and token transport ownership on the receiving preflight owner', async () => {
    const operation = await prepareAgentPreflight(
      { runtimeId: 'successful-close' },
      credentials().authority,
      new SettingsService(),
    );
    try {
      await operation.dispose();
      await operation.dispose();
      expect(credentials().snapshot()).toStrictEqual([1]);
      expect(credentials().keySnapshot()).toStrictEqual([1]);
    } finally {
      await operation.dispose();
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
  it('joins preflight assembly rollback before reporting failed population', async () => {
    const { root } = await fixture();
    const previous = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = join(root, 'legacy-missing.jsonl');
    try {
      await expect(
        Promise.resolve().then(() =>
          prepareAgentPreflight(
            { runtimeId: 'failed-population' },
            credentials().authority,
            new SettingsService(),
          ),
        ),
      ).rejects.toThrow('legacy-missing');
    } finally {
      if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previous;
    }
    expect(credentials().snapshot()).toStrictEqual([0, 1]);
    expect(credentials().keySnapshot()).toStrictEqual([0, 1]);
  });

  it('joins policy persistence failure before preferred failed-bootstrap rejection and keeps the primary failure first', async () => {
    const { config } = await fixture();
    const home = process.env.LLXPRT_CONFIG_HOME;
    if (home === undefined) throw new Error('Missing isolated config home');
    await writeFile(join(home, 'policies'), 'not a directory');
    const policy = new RuntimePolicyOwner(config);
    const media = new SessionMediaOwner(
      config.projectTempDir,
      config.getMediaStoreQuotaByteLimit(),
    );
    const keys = credentials().authority.createProviderKeyStorage();
    policy.session.messageBus.publish({
      type: MessageBusType.UPDATE_POLICY,
      toolName: 'read_file',
      persist: true,
    });
    let primary: unknown;
    try {
      readFileSync(join(home, 'missing-token-source'));
    } catch (error) {
      primary = error;
    }
    const failure: unknown = await cleanupFailedCreatedAgent(
      primary,
      () => keys.close(),
      config,
      media,
      undefined,
      () => policy.dispose(),
    ).catch((error: unknown) => error);
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

  describe('with the fake provider replay', () => {
    useFakeResponsesReplay('read-write-confirmations-across-preflight.jsonl');

    it('preserves configured policy and transport for the receiving Agent after preflight disposal', async () => {
      const confirmedOutput = join(
        process.cwd(),
        'preflight-release-confirmed.txt',
      );
      const pendingOutput = join(
        process.cwd(),
        'preflight-release-pending.txt',
      );
      cleanups.push(async () => {
        await rm(confirmedOutput, { force: true });
        await rm(pendingOutput, { force: true });
      });
      const route = await openRouteBPreflight({
        authority: credentials().authority,
        config: { workingDir: process.cwd(), interactive: true },
      });
      let agent: Agent | undefined;
      const requests: ToolConfirmation[] = [];
      let wake: (() => void) | undefined;
      const unsubscribe: Array<() => void> = [];
      const confirmationNumber = async (count: number) => {
        while (requests.length < count)
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        return requests[count - 1];
      };
      try {
        await route.prepare();
        agent = await route.createAgent({ provider: 'fake', authMode: 'auto' });
        unsubscribe.push(
          agent.tools.onConfirmationRequest((request) => {
            requests.push(request);
            wake?.();
          }),
        );
        const before = await drain(agent.stream('read package metadata'));
        expect(countType(before, 'tool-result')).toBeGreaterThan(0);
        expect(requests).toHaveLength(0);

        const confirmedTurn = drain(agent.stream('write the confirmed file'));
        const confirmed = await confirmationNumber(1);
        expect(confirmed.name).toBe('write_file');
        await route.disposePreflight();
        agent.tools.respondToConfirmation(
          confirmed.confirmationId,
          ToolConfirmationOutcome.ProceedOnce,
        );
        await confirmedTurn;
        expect(readFileSync(confirmedOutput, 'utf8')).toBe(
          'confirmed after preflight disposal',
        );

        const after = await drain(agent.stream('read package metadata again'));
        expect(countType(after, 'tool-result')).toBeGreaterThan(0);
        expect(requests).toHaveLength(1);

        expect(credentials().snapshot()).toStrictEqual([0]);
        await credentials().saveToken(0, 'retained', {
          access_token: 'after-transfer',
          token_type: 'Bearer',
          expiry: Math.floor(Date.now() / 1000) + 3600,
        });
        expect(await credentials().listProviders(0)).toContain('retained');

        const pendingTurn = drain(agent.stream('write the pending file')).catch(
          (error: unknown) => error,
        );
        const pending = await confirmationNumber(2);
        expect(pending.name).toBe('write_file');
        await agent.dispose();
        await pendingTurn;
        expect(existsSync(pendingOutput)).toBe(false);
        expect(credentials().snapshot()).toStrictEqual([1]);
        expect(credentials().keySnapshot()).toStrictEqual([1]);
      } finally {
        for (const stop of unsubscribe) stop();
        await agent?.dispose();
        await route.close();
      }
    });
  });

  it('closes failed attachment and permits a fresh independent owner', async () => {
    const { operation, root, settings, attach } = await fixture();
    await (await retain(operation, root, 'failure-file')).lease.release();
    settings.set('activeProvider', 'no-such-provider');
    await expect(attach()).rejects.toThrow(
      "Could not activate explicitly-configured provider 'no-such-provider'",
    );
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
    const root = await mkdtemp(join(tmpdir(), 'preflight-oauth-reads-'));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const settings = new SettingsService();
    const profileDirectory = join(root, 'profiles');
    const profiles = new ProfileManager(profileDirectory);
    await profiles.saveProfile('selected', {
      version: 1,
      provider: 'codex',
      model: 'configured',
      modelParams: {},
      ephemeralSettings: {},
    });
    settings.setCurrentProfileName('selected');
    const tokens = credentials().authority.createTokenStore();
    const closeTokens = createOwnedTokenStoreClose(tokens);
    const profileReads = createPreflightOAuthProfileReads();
    const oauth = createOwnerOAuthManager(
      tokens,
      oauthSettings,
      new MessageBus(),
      profileReads,
      createSessionAuthPolicyReader(settings),
      () => ({ runtimeId: 'retained-root', runtimeKind: 'agent' }),
      undefined,
      () => {},
      async () => {
        throw new Error('Unexpected network request');
      },
    );
    try {
      profileReads.attachProfileDirectory(profileDirectory);
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
    } finally {
      await oauth.dispose();
      closeTokens();
    }
    expect(credentials().snapshot()).toStrictEqual([1]);
  });

  it('keeps a host failure first while joining file failure and credential release, then permits file remediation', async () => {
    const { root, operation, settings, attach } = await fixture();
    const retained = await retain(operation, root, 'failed-deletion');
    await retained.lease.release();
    await rm(join(root, 'failed-deletion'));
    settings.set('activeProvider', 'no-such-provider');
    const failure: unknown = await attach().catch((error: unknown) => error);
    if (!(failure instanceof AggregateError))
      throw new Error('Missing joined startup error');
    expect(failure.errors[0]).toBeInstanceOf(Error);
    expect((failure.errors[0] as Error).message).toContain(
      "Could not activate explicitly-configured provider 'no-such-provider'",
    );
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
