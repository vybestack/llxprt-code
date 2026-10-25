import { ProviderReadFixture } from '../../../agents/src/api/__tests__/helpers/provider-read-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  openRouteAAgent,
  type RouteAAgent,
} from '../../../agents/src/api/__tests__/helpers/route-a-agent.js';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../../agents/src/core/subagent-cleanup.js';
import { resolveProviderFilePolicy } from '../providerFilePolicy.js';

describe('isolated runtime owner activation', () => {
  const credentials = useOwnedCredentials();
  const retiring: Array<() => void | Promise<void>> = [];
  let directory: string;
  let first: RouteAAgent;
  let second: RouteAAgent;

  afterEach(async () => {
    await runCleanupSteps(retiring.splice(0).reverse());
  });

  async function openDirectory(): Promise<void> {
    const raw = await mkdtemp(join(tmpdir(), 'owner-activation-'));
    retiring.push(() => rm(raw, { recursive: true, force: true }));
    directory = await realpath(raw);
  }

  async function openOwner(
    runtimeId: string | undefined,
  ): Promise<RouteAAgent> {
    const owner = await openRouteAAgent({
      authority: credentials().authority,
      config: { sessionId: 'shared-owner-label', workingDir: directory },
      intent: { sessionId: runtimeId },
    });
    retiring.push(() => owner.close());
    return owner;
  }

  it('requires the explicit SDK owner even when an isolated owner is active', async () => {
    await openDirectory();
    first = await openOwner('sdk-owner');
    expect(() => Reflect.construct(ProviderReadFixture, [])).toThrow(
      'Provider reads require an explicit session owner',
    );
    expect('providerManager' in first.config).toBe(false);
  });

  it('keeps two concurrent owners with the same label independent', async () => {
    await openDirectory();
    [first, second] = await Promise.all([
      openOwner('shared-label'),
      openOwner('shared-label'),
    ]);
    expect('providerManager' in first.config).toBe(false);
    await first.agent.dispose();
    expect('providerManager' in second.config).toBe(false);
    expect(second.agent.getProvider()).toBe('fake');
    expect(second.agent.captureProviderFiles()).toBeDefined();
    expect(second.agent.getRuntimeId()).toBe('shared-label');
  });

  it('assigns independent UUID identities to equal-label Config owners without caller IDs', async () => {
    await openDirectory();
    [first, second] = await Promise.all([
      openOwner(undefined),
      openOwner(undefined),
    ]);
    expect(first.config.getSessionId()).toBe(second.config.getSessionId());
    expect(first.agent.getRuntimeId()).toMatch(
      /^agent-[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i,
    );
    expect(second.agent.getRuntimeId()).not.toBe(first.agent.getRuntimeId());
    expect('providerManager' in first.config).toBe(false);
    await first.agent.dispose();
    expect('providerManager' in second.config).toBe(false);
  });

  it('an aborted same-label activation leaves the other owner usable', async () => {
    await openDirectory();
    first = await openOwner('same-label-abort');
    first.agent.setEphemeralSetting('auth-key', 'sibling-credential');
    await expect(
      openRouteAAgent({
        authority: credentials().authority,
        config: { sessionId: 'shared-owner-label', workingDir: directory },
        intent: {
          sessionId: 'same-label-abort',
          activation: {
            provider: 'openai',
            model: 'gpt-4o',
            cliOverrides: { baseUrl: 'not a url' },
          },
        },
      }),
    ).rejects.toThrow('baseUrl.invalid');
    expect(first.agent.getEphemeralSetting('auth-key')).toBe(
      'sibling-credential',
    );
    expect('providerManager' in first.config).toBe(false);
  });

  it('passes the exact owner Config and runtime ID to activation callbacks', async () => {
    await openDirectory();
    const observed: string[] = [];
    first = await openOwner('callback-owner');
    const owner = first;
    const path = join(owner.config.getTargetDir(), 'remote-owner-file');
    await writeFile(path, 'retained owner data');
    try {
      const retained = await owner.agent.retainProviderFile({
        cacheKey: 'callback-file',
        fileId: path,
        bytes: 19,
        identity: {
          provider: 'kimi',
          baseURL: 'https://api.kimi.test/v1',
          credentialHash: 'caller',
        },
        policy: resolveProviderFilePolicy({
          configuredMode: 'session',
          configuredRetentionMs: 60000,
          configuredDeletion: 'delete',
          providerFileReferences: true,
          zeroDataRetention: 'incompatible-while-retained',
          zeroDataRetentionRequired: false,
        }),
        deleteRemote: async (file) => {
          await rm(file);
          expect(owner.agent.workspace.getWorkingDirectory()).toBe(
            owner.config.getTargetDir(),
          );
          observed.push(owner.agent.getRuntimeId());
        },
      });
      await retained.lease.release();
      await owner.agent.dispose();
    } catch (primary) {
      await cleanupAfterFailure(primary, () => owner.agent.dispose());
    }
    expect(observed).toStrictEqual(['callback-owner']);
  });
});
