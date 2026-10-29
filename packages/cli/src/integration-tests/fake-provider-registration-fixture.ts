/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createProviderPopulationTarget } from '@vybestack/llxprt-code-providers/composition/providerManagerInstance.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as nodeOs from 'node:os';
import {
  Config,
  createProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';
import { OwnedFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import {
  NodeFileSystem,
  createOwnedOAuthManager,
  createOwnedTokenStoreClose,
  populateProviderManager,
} from '@vybestack/llxprt-code-providers/composition.js';
import { OwnedCredentialFixture } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../../agents/src/core/subagent-cleanup.js';

export async function observeFakeProviderRegistration(): Promise<{
  readonly registeredProviderNames: readonly string[];
  readonly activeProviderName: string | undefined;
  readonly activeProviderImplementationName: string | undefined;
}> {
  const tempDir = fs.mkdtempSync(path.join(nodeOs.tmpdir(), 'p13-fake-'));
  const originalEnv = process.env.LLXPRT_FAKE_RESPONSES;
  const release: Array<() => void | Promise<void>> = [
    () => fs.rmSync(tempDir, { recursive: true, force: true }),
  ];
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= runCleanupSteps([...release].reverse());
    return closing;
  };
  try {
    let observation: {
      readonly registeredProviderNames: readonly string[];
      readonly activeProviderName: string | undefined;
      readonly activeProviderImplementationName: string | undefined;
    };
    try {
      const fixturePath = writeFakeResponse(tempDir);
      process.env.LLXPRT_FAKE_RESPONSES = fixturePath;
      const credentials = await OwnedCredentialFixture.create();
      release.push(() => credentials.dispose());
      const settings = new SettingsService();
      const config = fakeConfig(tempDir);
      release.push(() => config.dispose());
      const manager = new ProviderManager(
        undefined,
        undefined,
        undefined,
        undefined,
        settings,
        config,
        createProviderRuntimeContext({}),
      );
      bindFakeNetwork(config, manager, release);
      release.push(() => manager.dispose());
      const keys = credentials.authority.createProviderKeyStorage();
      release.push(() => keys.close());
      manager.bindProviderKeyStorage(keys);
      const oauth = acquireFakeOAuth(
        credentials.authority,
        config,
        manager,
        settings,
        release,
      );
      const tokens = oauth.getTokenStore();
      populateProviderManager({
        target: createProviderPopulationTarget(manager, oauth, tokens),
        readSetting: (key) => settings.get(key),
        fileSystem: new NodeFileSystem(),
        configuration: { kind: 'configured', config },
        contributions: { kind: 'none' },
        messages: { kind: 'none' },
        allowBrowser: true,
        activateConfiguredProvider: true,
        fakeResponses: { kind: 'replay', path: fixturePath },
      });
      observation = {
        registeredProviderNames: manager.listProviders(),
        activeProviderName: manager.getActiveProviderName(),
        activeProviderImplementationName: manager.getActiveProvider()?.name,
      };
    } catch (primary) {
      await cleanupAfterFailure(primary, close);
      throw primary;
    }
    await close();
    return observation;
  } finally {
    if (originalEnv === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = originalEnv;
  }
}

function bindFakeNetwork(
  config: Config,
  manager: ProviderManager,
  release: Array<() => void | Promise<void>>,
): void {
  const network = new OwnedFetch(config.getProxy());
  release.push(() => {
    network.closeAdmissionAndAbort();
    return network.dispose();
  });
  manager.bindNetworkFetch(network.fetch);
}

function acquireFakeOAuth(
  authority: OwnedCredentialFixture['authority'],
  config: Config,
  manager: ProviderManager,
  settings: SettingsService,
  release: Array<() => void | Promise<void>>,
): ReturnType<typeof createOwnedOAuthManager> {
  const tokens = authority.createTokenStore();
  let transferred = false;
  const closeTokens = createOwnedTokenStoreClose(tokens);
  release.push(() => (transferred ? undefined : closeTokens()));
  const oauth = createOwnedOAuthManager(
    tokens,
    undefined,
    undefined,
    config,
    manager,
    settings,
  );
  release.push(() => oauth.dispose());
  transferred = true;
  return oauth;
}

function writeFakeResponse(directory: string): string {
  const pathName = path.join(directory, 'fake.jsonl');
  fs.writeFileSync(
    pathName,
    JSON.stringify({
      chunks: [{ speaker: 'ai', blocks: [{ type: 'text', text: 'test' }] }],
    }),
    'utf-8',
  );
  return pathName;
}

function fakeConfig(directory: string): Config {
  return new Config({
    sessionId: 'p13-fake',
    targetDir: directory,
    debugMode: false,
    cwd: directory,
    model: 'fake-model',
  });
}
