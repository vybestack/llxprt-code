/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgent, type Agent } from '@vybestack/llxprt-code-agents';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../../core/subagent-cleanup.js';
import { OwnedCredentialFixture } from './owned-credential-fixture.js';
import {
  createRecordingProvider,
  type RecordingProvider,
} from './recording-provider.js';

export interface GenerateOptionsAgentOptions {
  /**
   * Provider alias the agent selects. `SessionTextGeneration` takes a detached
   * client only for a provider named `gemini`.
   */
  readonly alias?: string;
  /**
   * Runs when the agent asks the supplied tokenizer factory to prepare after
   * construction. Detached client acquisition starts with that call.
   */
  readonly prepareTokenizer?: () => Promise<void>;
}

export interface GenerateOptionsTokenizer {
  /** Tokenizer preparations requested after the agent was constructed. */
  readonly preparations: () => number;
}

type GenerateOptionsScenario = (
  agent: Agent,
  provider: RecordingProvider,
  tokenizer: GenerateOptionsTokenizer,
) => Promise<void>;

function createReadinessTokenizer(options: GenerateOptionsAgentOptions): {
  readonly factory: RuntimeTokenizerFactory;
  readonly tokenizer: GenerateOptionsTokenizer;
  readonly admit: () => void;
} {
  let admitted = false;
  let preparations = 0;
  const factory: RuntimeTokenizerFactory = {
    prepareTokenizer: async () => {
      if (!admitted) return;
      preparations += 1;
      await options.prepareTokenizer?.();
    },
    getTokenizer: () => ({
      fallbackPolicy: 'deny',
      countTokens: () => 1,
    }),
    estimatePrompt: async (request) => ({
      count: await request.legacyEstimate(),
      method: 'calibrated',
      family: 'test-readiness',
      estimatorVersion: 'test-readiness-v1',
      assetRevision: 'none',
      projectionRevision: request.projectionRevision,
    }),
  };
  return {
    factory,
    tokenizer: { preparations: () => preparations },
    admit: () => {
      admitted = true;
    },
  };
}

/**
 * Runs a scenario against one agent built through `createAgent` with the
 * inputs a host fills: a contributed recording provider, a supplied tokenizer
 * factory and a `CredentialAuthority` over a credential endpoint the helper
 * starts and stops. Resolves with the failures disposal of the agent reported;
 * a scenario failure is rethrown after the cleanup, together with any cleanup
 * failure.
 */
export async function withGenerateOptionsAgent(
  run: GenerateOptionsScenario,
  options: GenerateOptionsAgentOptions = {},
): Promise<readonly unknown[]> {
  const credentials = await OwnedCredentialFixture.create();
  const cleanupFailures: unknown[] = [];
  let directory: string | undefined;
  let agent: Agent | undefined;
  const release = (): Promise<void> =>
    runCleanupSteps([
      async () => {
        try {
          await agent?.dispose();
        } catch (error) {
          cleanupFailures.push(error);
        }
      },
      () => credentials.dispose(),
      () =>
        directory === undefined
          ? undefined
          : rm(directory, { recursive: true, force: true }),
    ]);
  const provider = createRecordingProvider({
    alias: options.alias,
    responseText: 'turn one reply',
  });
  const readiness = createReadinessTokenizer(options);
  try {
    directory = await realpath(
      await mkdtemp(join(tmpdir(), 'generate-options-')),
    );
    agent = await createAgent({
      provider: provider.alias,
      model: 'primary-model',
      workingDir: directory,
      telemetry: { enabled: false },
      recording: { enabled: false },
      mcpEnabled: false,
      skillsSupport: false,
      providerContributions: provider.contributions,
      tokenizerFactory: readiness.factory,
      credentialAuthority: credentials.authority,
    });
    readiness.admit();
    await run(agent, provider, readiness.tokenizer);
  } catch (primary) {
    return cleanupAfterFailure(primary, release);
  }
  await release();
  return cleanupFailures;
}
