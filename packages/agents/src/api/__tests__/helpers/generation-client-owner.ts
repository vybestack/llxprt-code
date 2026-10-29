/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GenerateOptions } from '@vybestack/llxprt-code-agents';
import type {
  AgentClientContract,
  AgentClientFactory,
} from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { ContentGeneratorConfig } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { createRuntimeContentGeneratorFactory } from '@vybestack/llxprt-code-providers/composition.js';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../../core/subagent-cleanup.js';
import type { SessionClientOwner } from '../../../session/session-client-owner.js';
import { buildAgentClientFactory } from '../../agentBootstrap.js';
import type { AgentConfig } from '../../config-types.js';
import type { GenerationProvider } from './generation-provider.js';
import {
  openProductionClientOwner,
  type ProductionClientOwner,
  type ProviderTokenizer,
} from './production-client-owner.js';

export function generationGate(): { promise: Promise<void>; release(): void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** The recording a detached-generation owner reports to; it records nothing. */
export const generationRecording = {
  transcriptPath: (): undefined => undefined,
  persistSemanticMediaPurge: async (): Promise<void> => {},
};

/**
 * The text generator a host binds to a session client owner:
 * `Agent.generate` without the facade.
 */
export function ownerTextGenerator(
  owner: SessionClientOwner,
): (input: string, options?: GenerateOptions) => Promise<string> {
  return async (input, options) =>
    owner.clients.generateText(input, options, generationRecording);
}

/**
 * A real client the owner's factory returned, wrapped on the instance: it
 * counts its own `initialize` and `dispose` calls and runs the hooks a test
 * assigns inside them. Nothing is patched on a prototype and no class is
 * subclassed.
 */
export type ObservedClient = AgentClientContract & {
  initialized: number;
  disposed: number;
  initializing: (() => Promise<void>) | undefined;
  initializedEffect: (() => void) | undefined;
  disposing: (() => Promise<void>) | undefined;
};

function observeClient(client: AgentClientContract): ObservedClient {
  const observed: ObservedClient = Object.assign(client, {
    initialized: 0,
    disposed: 0,
    initializing: undefined as (() => Promise<void>) | undefined,
    initializedEffect: undefined as (() => void) | undefined,
    disposing: undefined as (() => Promise<void>) | undefined,
  });
  const initialize = client.initialize.bind(client);
  const dispose = client.dispose.bind(client);
  client.initialize = async (config: ContentGeneratorConfig) => {
    observed.initialized += 1;
    await observed.initializing?.();
    await initialize(config);
    observed.initializedEffect?.();
  };
  client.dispose = async () => {
    observed.disposed += 1;
    await observed.disposing?.();
    await dispose();
  };
  return observed;
}

export interface GenerationClientOwnerOptions {
  readonly authority: CredentialAuthority;
  /** The contributed provider the owner activates (its alias is the provider name). */
  readonly provider: GenerationProvider;
  /** Runs once for each client the owner's factory returns, before the owner uses it. */
  readonly acquired?: (client: ObservedClient, index: number) => void;
  /**
   * Replaces tokenizer readiness once the owner is open, so construction
   * keeps the production readiness and only the scenario's admissions use the
   * hook.
   */
  readonly prepareTokenizer?: () => Promise<void>;
}

export interface GenerationClientOwner {
  readonly owner: SessionClientOwner;
  readonly settingsOwner: SessionSettingsOwner;
  /** The clients the owner's factory returned, in creation order. */
  readonly clients: readonly ObservedClient[];
  /** Releases everything except the owner. */
  readonly closeStack: () => Promise<void>;
}

function selectionFor(directory: string, alias: string): AgentConfig {
  return {
    provider: alias,
    model: 'primary-model',
    sessionId: randomUUID(),
    workingDir: directory,
    telemetry: { enabled: false },
    recording: { enabled: false },
    mcpEnabled: false,
    skillsSupport: false,
    harness: { includeProcessCwd: false },
  };
}

function gateTokenizer(hook: (() => Promise<void>) | undefined): {
  tokenizer: (base: ProviderTokenizer) => ProviderTokenizer;
  admit: () => void;
} {
  let admitted = false;
  return {
    tokenizer: (base) => ({
      ...base,
      prepareTokenizer: async (provider, model) => {
        if (admitted && hook !== undefined) await hook();
        else await base.prepareTokenizer?.(provider, model);
      },
    }),
    admit: () => {
      admitted = true;
    },
  };
}

async function openGenerationClientOwner(
  options: GenerationClientOwnerOptions,
): Promise<GenerationClientOwner> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'generation-client-owner-')),
  );
  const removeDirectory = (): Promise<void> =>
    rm(directory, { recursive: true, force: true });
  const production = buildAgentClientFactory();
  const observed: ObservedClient[] = [];
  const factory: AgentClientFactory = (...operands) => {
    const client = observeClient(production(...operands));
    observed.push(client);
    options.acquired?.(client, observed.length - 1);
    return client;
  };
  const gate = gateTokenizer(options.prepareTokenizer);
  let opened: ProductionClientOwner;
  try {
    opened = await openProductionClientOwner({
      authority: options.authority,
      selection: selectionFor(directory, options.provider.alias),
      activation: { provider: options.provider.alias, model: 'primary-model' },
      providerContributions: options.provider.contributions,
      clientFactory: factory,
      contentGeneratorFactory: createRuntimeContentGeneratorFactory(),
      tokenizer: gate.tokenizer,
    });
  } catch (primary) {
    return cleanupAfterFailure(primary, removeDirectory);
  }
  gate.admit();
  return {
    owner: opened.owner,
    settingsOwner: opened.settingsOwner,
    clients: observed,
    closeStack: () => runCleanupSteps([opened.closeResources, removeDirectory]),
  };
}

/**
 * Runs a scenario against a `SessionClientOwner` built through its production
 * `create` with a contributed provider activated, a primary client whose chat is not started yet and a
 * client factory that wraps each real client on the instance. After the
 * scenario the owner is disposed and the failures that disposal reports are
 * returned; the remaining resources are released either way.
 */
export async function withGenerationClientOwner(
  options: GenerationClientOwnerOptions,
  run: (opened: GenerationClientOwner) => Promise<void>,
): Promise<readonly unknown[]> {
  const opened = await openGenerationClientOwner(options);
  try {
    await run(opened);
  } catch (primary) {
    return cleanupAfterFailure(primary, () =>
      runCleanupSteps([() => opened.owner.dispose(), opened.closeStack]),
    );
  }
  const failures: unknown[] = [];
  try {
    await opened.owner.dispose();
  } catch (failure) {
    failures.push(failure);
  }
  await opened.closeStack();
  return failures;
}
