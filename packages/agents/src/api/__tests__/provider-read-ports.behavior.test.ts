/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'bun:test';
import { FakeProvider, type IProvider } from '@vybestack/llxprt-code-providers';
import { bindProviderAliasIdentity } from '@vybestack/llxprt-code-providers/composition/aliasProviderFactory.js';
import { buildProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/index.js';
import { createAgent } from '../createAgent.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { makeScratchDir } from './helpers/scratch-dir.js';

const ALIAS = 'live-limit-local';
const PROVIDER_ID = `${ALIAS}-provider`;

describe('public Agent live provider reads', () => {
  const credentials = useOwnedCredentials();

  it('reads current active state, model catalogue and changing provider limits without returning runtime services', async () => {
    const directory = await makeScratchDir('provider-read-ports-');
    let provider: IProvider | undefined;
    const contributions = buildProviderContributionRegistry([
      {
        specifier: `memory:${PROVIDER_ID}`,
        manifest: {
          apiVersion: 1,
          id: PROVIDER_ID,
          providers: [
            {
              providerId: PROVIDER_ID,
              createProvider: (entry) => {
                const created = new FakeProvider(
                  fileURLToPath(
                    new URL('./fixtures/plain-text.jsonl', import.meta.url),
                  ),
                  directory,
                );
                bindProviderAliasIdentity(created, entry.alias);
                provider = created;
                return created;
              },
              builtinAliases: [
                {
                  alias: ALIAS,
                  config: {
                    baseProvider: PROVIDER_ID,
                    'base-url': 'http://fake-provider.local',
                    'requires-auth': false,
                    defaultModel: 'fake-model',
                    staticModels: [{ id: 'fake-model', name: 'fake-model' }],
                  },
                },
              ],
            },
          ],
        },
      },
    ]);
    const agent = await createAgent({
      provider: ALIAS,
      model: 'fake-model',
      providerContributions: contributions,
      workingDir: directory,
      credentialAuthority: credentials().authority,
      harness: { includeProcessCwd: false },
    });
    try {
      if (provider === undefined)
        throw new Error('Expected activated contributed provider');
      let limit = 8192;
      provider.getContextLimit = () => limit;
      const reads = {
        hasActiveProvider: () => agent.hasActiveProvider(),
        getProviderContextLimit: () => agent.getProviderContextLimit(),
        listAvailableModels: () => agent.listAvailableModels(),
      };
      expect(reads.hasActiveProvider()).toBe(true);
      expect(reads.getProviderContextLimit()).toBe(8192);
      limit *= 2;
      expect(reads.getProviderContextLimit()).toBe(16384);
      const models = await reads.listAvailableModels();
      expect(models.map(({ id }) => id)).toContain(agent.getModel());
      const result = await agent.chat('Respond with the retained fixture text');
      expect(result.text).toContain('a plain text reply');
    } finally {
      await runCleanupSteps([
        () => agent.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    }
  });
});
