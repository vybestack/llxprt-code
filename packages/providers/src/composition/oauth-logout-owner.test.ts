import { createProviderConfigFixture } from '../runtime/__tests__/provider-config-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';

import { NodeFileSystem } from './IFileSystem.js';

import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderManager } from './providerManagerInstance.js';
import {
  createTestProvider,
  makeToken,
} from '../auth/__tests__/behavioral/test-utils.js';
import {
  createIsolatedRuntimeContext,
  type IsolatedRuntimeContextHandle,
  type RuntimeActivationBindings,
} from '../runtime/runtimeContextFactory.js';

const activationBindings: RuntimeActivationBindings = {
  resetInfrastructure: () => {},
  setRuntimeContext: () => {},
  registerInfrastructure: () => {},
  linkProviderManager: (config, manager) => {
    configureProviderRuntimeFactories(config, manager);
  },
};

function ownerContext(runtimeId: string) {
  const settingsService = new SettingsService();
  const { config: config } = createProviderConfigFixture({
    sessionId: runtimeId,
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: 'gpt-5',
    settingsService,
  });
  return { runtimeId, settingsService, config };
}

describe('logout ownership', () => {
  it.each(['composition', 'isolated'] as const)(
    '%s logout removes A credentials while B credentials remain usable',
    async (construction) => {
      const contextA = ownerContext(`logout-owner-a-${construction}`);
      const contextB = ownerContext(`logout-owner-b-${construction}`);
      const handles: IsolatedRuntimeContextHandle[] = [];
      const build = (context: ReturnType<typeof ownerContext>) => {
        if (construction === 'composition') {
          return createProviderManager(context, {
            fileSystem: new NodeFileSystem(),
            config: context.config,
            activateConfiguredProvider: false,
          });
        }
        const handle = createIsolatedRuntimeContext(
          {
            ...context,
            activationBindings,
          },
          context.settingsService,
        );
        handles.push(handle);
        return {
          manager: handle.providerManager,
          oauthManager: handle.oauthManager,
        };
      };
      const a = build(contextA);
      const b = build(contextB);
      try {
        for (const [owner, bucket] of [
          [a, 'a'],
          [b, 'b'],
        ] as const) {
          owner.oauthManager.registerProvider(
            createTestProvider('anthropic', {
              initiateAuthResult: makeToken(`credential-${bucket}`),
            }),
          );
          await owner.oauthManager.authenticate('anthropic', bucket);
          owner.oauthManager.setSessionBucket('anthropic', bucket);
        }
        const credentialB = await b.oauthManager.getOAuthToken('anthropic');

        await a.oauthManager.logout('anthropic');

        expect(await a.oauthManager.getOAuthToken('anthropic', 'a')).toBeNull();
        expect(
          await b.oauthManager.getOAuthToken('anthropic', 'b'),
        ).toStrictEqual(credentialB);
      } finally {
        await b.oauthManager.logout('anthropic', 'b');
        await Promise.all(handles.map((handle) => handle.cleanup()));
        await contextA.config.dispose();
        await contextB.config.dispose();
      }
    },
  );
});
