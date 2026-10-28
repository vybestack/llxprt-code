/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { toConfigParameters } from '../../agentConfig.adapter.js';
import type { Agent } from '../../agent.js';
import type { AgentAdoptionIntent, AgentConfig } from '../../config-types.js';
import { fromConfig } from '../../fromConfig.js';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../../core/subagent-cleanup.js';

export interface RouteAAgentOptions {
  /** Fields merged over the defaults (fake provider and model, fresh session id). */
  readonly config?: Partial<AgentConfig>;
  /** Defaults to activating the fake provider and model. */
  readonly intent?: AgentAdoptionIntent;
  /** Defaults to a new `CredentialAuthority`. */
  readonly authority?: CredentialAuthority;
}

/**
 * One agent built through `fromConfig` with the caller-owned `Config`,
 * `SettingsService` and `CredentialAuthority` a host passes. `close` disposes
 * the agent, then the borrowed `Config`, then removes the working directory;
 * every step runs and failures are reported together.
 */
export interface RouteAAgent {
  readonly agent: Agent;
  readonly config: Config;
  readonly settings: SettingsService;
  readonly authority: CredentialAuthority;
  readonly directory: string;
  readonly close: () => Promise<void>;
}

/**
 * Builds an agent through the production `fromConfig` entry point. The fake
 * provider is selected by the `LLXPRT_FAKE_RESPONSES` replay seam, which the
 * suite sets with `useFakeResponsesReplay`.
 */
export async function openRouteAAgent(
  options: RouteAAgentOptions = {},
): Promise<RouteAAgent> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'route-a-agent-')),
  );
  const config = new Config(
    toConfigParameters({
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      workingDir: directory,
      ...options.config,
    }),
  );
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
  const authority = options.authority ?? new CredentialAuthority();
  const intent = options.intent ?? {
    activation: { provider: 'fake', model: 'fake-model' },
  };
  let agent: Agent | undefined;
  const close = (): Promise<void> =>
    runCleanupSteps([
      () => agent?.dispose(),
      () => config.dispose(),
      () => rm(directory, { recursive: true, force: true }),
    ]);
  try {
    agent = await fromConfig(config, settings, intent, authority);
  } catch (primary) {
    return cleanupAfterFailure(primary, close);
  }
  return { agent, config, settings, authority, directory, close };
}
