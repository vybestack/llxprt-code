/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FakeProvider } from '@vybestack/llxprt-code-providers';
import { bindProviderAliasIdentity } from '@vybestack/llxprt-code-providers/composition/aliasProviderFactory.js';
import { buildProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/index.js';
import type {
  LoadedRuntimePlugin,
  ProviderContributionRegistry,
} from '@vybestack/llxprt-code-providers/composition/runtimePlugins/types.js';
import type { Agent } from '../../agent.js';
import type { AgentConfig } from '../../config-types.js';
import { createAgent } from '../../createAgent.js';
import { cleanupAfterFailure } from '../../../core/subagent-cleanup.js';
import { fixturePath, fixturesDir, type BuiltAgent } from './agentHarness.js';
import {
  InMemoryProviderKeyStorage,
  OwnedCredentialFixture,
} from './owned-credential-fixture.js';

/** What a contributed replay provider answers with: a fixture file or inline JSONL. */
export type ReplayScript =
  | { readonly fixtureRelPath: string }
  | { readonly content: string };

export interface ReplayProviderSpec {
  /** Contributed alias the agent selects as its provider. */
  readonly alias: string;
  readonly script: ReplayScript;
  /**
   * The model this provider reports as its own and declares as its alias
   * default. Defaults to `fake-model`, the model every replay fixture answers
   * for; set it when a scenario needs a switch target whose default differs
   * from the starting provider's.
   */
  readonly defaultModel?: string;
}

/**
 * A replaying provider whose own model identity is the alias default it was
 * contributed with. `FakeProvider` otherwise reports `fake-model` for every
 * alias, which hides default-model transitions on a provider switch.
 */
class ReplayProvider extends FakeProvider {
  constructor(
    scriptFile: string,
    cwd: string | undefined,
    private readonly defaultModel: string,
  ) {
    super(scriptFile, cwd);
  }

  override getDefaultModel(): string {
    return this.defaultModel;
  }

  override getCurrentModel(): string {
    return this.defaultModel;
  }
}

export interface ReplayProviderAgentOptions {
  /** The provider the agent starts on (model `fake-model`). */
  readonly initial: ReplayProviderSpec;
  /** Further contributed providers an `agent.setProvider(alias)` switch can select. */
  readonly targets?: readonly ReplayProviderSpec[];
  /**
   * Provider keys stored under their names (for example `openai-prod`),
   * served through the agent's credential authority to built-in providers.
   */
  readonly storedKeys?: Readonly<Record<string, string>>;
  readonly configOverrides?: Readonly<Partial<AgentConfig>>;
}

/** Writes any inline scripts to files and returns the path for each spec. */
function scriptPaths(
  specs: readonly ReplayProviderSpec[],
  scratch: string,
): readonly string[] {
  return specs.map((spec, index) => {
    if ('fixtureRelPath' in spec.script)
      return fixturePath(spec.script.fixtureRelPath);
    const file = join(scratch, `${index}.jsonl`);
    writeFileSync(file, spec.script.content, 'utf8');
    return file;
  });
}

function contributeReplayProvider(
  spec: ReplayProviderSpec,
  scriptFile: string,
  cwd: string,
): LoadedRuntimePlugin {
  const providerId = `${spec.alias}-replay-provider`;
  const defaultModel = spec.defaultModel ?? 'fake-model';
  return {
    specifier: `memory:${providerId}`,
    manifest: {
      apiVersion: 1,
      id: providerId,
      providers: [
        {
          providerId,
          createProvider: (entry) => {
            const provider = new ReplayProvider(scriptFile, cwd, defaultModel);
            bindProviderAliasIdentity(provider, entry.alias);
            return provider;
          },
          builtinAliases: [
            {
              alias: spec.alias,
              config: {
                baseProvider: providerId,
                'base-url': 'http://replay-provider.invalid/v1',
                'requires-auth': false,
                defaultModel,
                staticModels: [{ id: defaultModel, name: defaultModel }],
              },
            },
          ],
        },
      ],
    },
  };
}

function buildRegistry(
  specs: readonly ReplayProviderSpec[],
  files: readonly string[],
  initialCwd: string,
  targetCwd: string,
): ProviderContributionRegistry {
  return buildProviderContributionRegistry(
    specs.map((spec, index) =>
      contributeReplayProvider(
        spec,
        files[index],
        index === 0 ? initialCwd : targetCwd,
      ),
    ),
  );
}

/**
 * Builds a public Agent whose provider and every switch target are provider
 * contributions that replay a script from its first line, the way a host
 * registers a provider. Unlike `buildAgent` it does not use the
 * `LLXPRT_FAKE_RESPONSES` replay seam, which registers only the one `fake`
 * provider; here a real `agent.setProvider(alias)` switch reaches a registered
 * provider. Built-in provider names (`openai`, `anthropic`) cannot be
 * contributed, so switch targets use their own aliases; built-in providers stay
 * available for scenarios that only apply profiles to them.
 */
export async function buildReplayProviderAgent(
  options: ReplayProviderAgentOptions,
): Promise<BuiltAgent> {
  if (process.env.LLXPRT_FAKE_RESPONSES !== undefined)
    throw new Error(
      'LLXPRT_FAKE_RESPONSES is set; the replay seam would replace the contributed providers',
    );
  const specs = [options.initial, ...(options.targets ?? [])];
  const scratch = mkdtempSync(join(tmpdir(), 'llxprt-replay-provider-'));
  const workingDir =
    options.configOverrides?.workingDir ?? resolve(fixturesDir, '..');
  const credentials =
    options.storedKeys === undefined
      ? undefined
      : await storedKeyCredentials(options.storedKeys);
  let agent: Agent | undefined;
  const cleanup = async (): Promise<void> => {
    try {
      await agent?.dispose();
    } finally {
      await credentials?.dispose();
      rmSync(scratch, { recursive: true, force: true });
    }
  };
  try {
    agent = await createAgent({
      provider: options.initial.alias,
      model: 'fake-model',
      workingDir,
      ...options.configOverrides,
      providerContributions: buildRegistry(
        specs,
        scriptPaths(specs, scratch),
        // The replay seam substitutes {{CWD}} with the process directory for
        // the starting provider and with the agent directory for switch targets.
        process.cwd(),
        workingDir,
      ),
      ...(credentials === undefined
        ? {}
        : { credentialAuthority: credentials.authority }),
    });
  } catch (primary) {
    return cleanupAfterFailure(primary, cleanup);
  }
  return { agent, cleanup };
}

async function storedKeyCredentials(
  keys: Readonly<Record<string, string>>,
): Promise<OwnedCredentialFixture> {
  const storage = new InMemoryProviderKeyStorage();
  for (const [name, value] of Object.entries(keys))
    await storage.saveKey(name, value);
  return OwnedCredentialFixture.create(undefined, storage);
}

/** The key value a stored key named `name` serves in profile scenarios. */
export function fixtureKeys(
  ...names: readonly string[]
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    names.map((name) => [name, `fixture-credential-${name}`]),
  );
}
