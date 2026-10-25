/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Config,
  WorkspaceFilesystemOwner,
  WorkspaceTrustLifecycle,
  assembleWorkspaceMemory,
  type SessionSettingsOwner,
  type WorkspaceMemoryOwner,
} from '@vybestack/llxprt-code-core';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/types.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { toConfigParameters } from '../../agentConfig.adapter.js';
import type { Agent } from '../../agent.js';
import type {
  AgentConfig,
  AgentForegroundHost,
  ProviderActivationIntent,
} from '../../config-types.js';
import {
  AgentProfilePreflight,
  prepareAgentPreflight,
} from '../../profile-preflight.js';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../../core/subagent-cleanup.js';

export interface RouteBOptions {
  /** Fields merged over the defaults (fake provider and model, fresh session id). */
  readonly config?: Partial<AgentConfig>;
  /** Defaults to a new `CredentialAuthority`. */
  readonly authority?: CredentialAuthority;
  /** Host runtime id passed to `prepareAgentPreflight`. */
  readonly runtimeId?: string;
  /**
   * Provider contributions passed to `prepareAgentPreflight`, so a provider
   * other than `fake` can be selected. Absent: no contributions.
   */
  readonly contributions?: ProviderContributionRegistry;
  /**
   * Forward-proxy URL passed as the host `proxy` to `prepareAgentPreflight`,
   * the way a production host routes its requests. Absent: no proxy.
   */
  readonly proxy?: string;
}

export interface RouteBPrepareOptions {
  /** Defaults to disposing the trust lifecycle, as the CLI's workspace preparation does. */
  readonly trustCleanup?: () => Promise<void>;
  /** Passed as `preparePostConfiguration`'s `suppliedSettings` (borrowed by the preflight). */
  readonly settingsOwner?: SessionSettingsOwner;
}

/**
 * The foreground preflight route a host takes: `prepareAgentPreflight`, then
 * `preparePostConfiguration` with the host's workspace owners, then
 * `preflight(intent)` and `createForegroundAgent`. `close` disposes the
 * preflight, the workspace owners and the `Config`, and removes the working
 * directory; every step runs and failures are reported together.
 */
export interface RouteBPreflight {
  readonly preflight: AgentProfilePreflight;
  readonly config: Config;
  readonly settings: SettingsService;
  readonly authority: CredentialAuthority;
  readonly directory: string;
  readonly filesystem: WorkspaceFilesystemOwner;
  readonly memory: WorkspaceMemoryOwner;
  readonly trust: WorkspaceTrustLifecycle;
  readonly prepare: (options?: RouteBPrepareOptions) => Promise<void>;
  /**
   * Disposes the preflight and hands its outcome to the caller; `close` then
   * does not report that disposal a second time.
   */
  readonly disposePreflight: () => Promise<void>;
  readonly createAgent: (
    intent?: ProviderActivationIntent,
    host?: AgentForegroundHost,
  ) => Promise<Agent>;
  readonly close: () => Promise<void>;
}

const DEFAULT_INTENT: ProviderActivationIntent = {
  provider: 'fake',
  model: 'fake-model',
};

function openWorkspaceOwners(config: Config): {
  readonly trust: WorkspaceTrustLifecycle;
  readonly filesystem: WorkspaceFilesystemOwner;
  readonly memory: WorkspaceMemoryOwner;
} {
  const trust = new WorkspaceTrustLifecycle({
    localTrust: config.initialWorkspaceTrust,
  });
  const filesystem = new WorkspaceFilesystemOwner({
    targetDir: config.getTargetDir(),
    isTrusted: () => trust.isTrustedFolder(),
  });
  return {
    trust,
    filesystem,
    memory: assembleWorkspaceMemory(config, filesystem, trust),
  };
}

/**
 * Opens a preflight through the production `prepareAgentPreflight` entry
 * point. The fake provider is selected by the `LLXPRT_FAKE_RESPONSES` replay
 * seam, which the suite sets with `useFakeResponsesReplay`.
 */
export async function openRouteBPreflight(
  options: RouteBOptions = {},
): Promise<RouteBPreflight> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'route-b-preflight-')),
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
  const authority = options.authority ?? new CredentialAuthority();
  const { trust, filesystem, memory } = openWorkspaceOwners(config);
  let preflight: AgentProfilePreflight | undefined;
  let preflightDisposal: Promise<void> | undefined;
  const close = (): Promise<void> =>
    runCleanupSteps([
      () =>
        preflightDisposal === undefined ? preflight?.dispose() : undefined,
      () => memory.dispose(),
      () => filesystem.dispose(),
      () => trust.dispose(),
      () => config.dispose(),
      () => rm(directory, { recursive: true, force: true }),
    ]);
  try {
    preflight = await prepareAgentPreflight(
      {
        runtimeId: options.runtimeId ?? `route-b-${randomUUID()}`,
        ...(options.proxy === undefined ? {} : { proxy: options.proxy }),
      },
      authority,
      settings,
      undefined,
      options.contributions,
    );
  } catch (primary) {
    return cleanupAfterFailure(primary, close);
  }
  const opened = preflight;
  return {
    preflight: opened,
    config,
    settings,
    authority,
    directory,
    filesystem,
    memory,
    trust,
    prepare: (prepareOptions = {}) =>
      opened.preparePostConfiguration(
        config,
        filesystem,
        memory,
        trust,
        prepareOptions.trustCleanup ?? (() => trust.dispose()),
        prepareOptions.settingsOwner,
      ),
    disposePreflight: () => (preflightDisposal ??= opened.dispose()),
    createAgent: async (intent = DEFAULT_INTENT, host = {}) => {
      const result = await opened.preflight(intent);
      if (result.token === undefined)
        throw new Error('Preflight did not accept the activation');
      return AgentProfilePreflight.createForegroundAgent(
        opened,
        result.token,
        intent,
        host,
      );
    },
    close,
  };
}
