/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { fromConfig } from '../fromConfig.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';

/**
 * The adopted construction receives its credential authority from the caller.
 * A host environment that cannot produce one must not matter: if adoption ever
 * fell back to constructing a host owner from `process.env`, the poisoned
 * descriptor below would make it throw before any store was acquired, and
 * adoption without a caller authority would still try to reach the host.
 */
describe('adoption credential authority source', () => {
  useFakeResponsesReplay('plain-text.jsonl');
  const credentials = useOwnedCredentials();

  let promptDirectory: string;
  let previousPrompts: string | undefined;
  let previousDescriptor: string | undefined;
  let previousSocket: string | undefined;

  beforeAll(async () => {
    promptDirectory = await mkdtemp(
      join(tmpdir(), 'authority-source-prompts-'),
    );
    previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });

  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  afterEach(() => {
    if (previousDescriptor === undefined)
      delete process.env.LLXPRT_CAPABILITY_FD;
    else process.env.LLXPRT_CAPABILITY_FD = previousDescriptor;
    if (previousSocket === undefined)
      delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    else process.env.LLXPRT_CREDENTIAL_SOCKET = previousSocket;
  });

  function poisonHostCredentialEnvironment(): void {
    previousDescriptor = process.env.LLXPRT_CAPABILITY_FD;
    previousSocket = process.env.LLXPRT_CREDENTIAL_SOCKET;
    process.env.LLXPRT_CAPABILITY_FD = 'not-a-descriptor';
    delete process.env.LLXPRT_CREDENTIAL_SOCKET;
  }

  it('uses exactly the caller authority, never the host environment, for keys and tokens', async () => {
    poisonHostCredentialEnvironment();

    const built = await openRouteAAgent({
      authority: credentials().authority,
      intent: {},
    });
    try {
      expect(built.authority).toBe(credentials().authority);
      expect(credentials().snapshot()).toHaveLength(1);
      expect(credentials().keySnapshot()).toHaveLength(1);
    } finally {
      await built.close();
    }
    expect(credentials().snapshot()).toStrictEqual([1]);
    expect(credentials().keySnapshot()).toStrictEqual([1]);
  });

  it('rejects adoption without a caller authority instead of building a host owner', async () => {
    poisonHostCredentialEnvironment();
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'authority-source-')),
    );
    const config = new Config(
      toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: directory,
      }),
    );
    try {
      const error: unknown = await Reflect.apply(fromConfig, undefined, [
        config,
        new SettingsService(),
        {},
        undefined,
      ]).then(
        () => undefined,
        (failure: unknown) => failure,
      );
      expect(error).toBeInstanceOf(Error);
      // A host-owner fallback reports its own transport requirement; reading the
      // environment here would mean adoption invented an authority.
      expect(String(error)).not.toContain('Capability transport');
    } finally {
      await config.dispose();
      await rm(directory, { recursive: true, force: true });
    }
    expect(credentials().snapshot()).toStrictEqual([]);
    expect(credentials().keySnapshot()).toStrictEqual([]);
  });
});
