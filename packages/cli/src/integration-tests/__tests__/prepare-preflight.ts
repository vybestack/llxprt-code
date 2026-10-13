/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  WorkspaceTrustLifecycle,
  WorkspaceFilesystemOwner,
  assembleWorkspaceMemory,
  type Config,
  type RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import {
  prepareAgentPreflight,
  type AgentProfilePreflight,
} from '@vybestack/llxprt-code-agents';

export async function prepareIntegrationPreflight(
  config: Config,
  settings: SettingsService,
  authority: CredentialAuthority,
  runtimeId: string,
  publishManager: (manager: RuntimeProviderManager) => void,
): Promise<AgentProfilePreflight> {
  const preflight = await prepareAgentPreflight(
    { runtimeId },
    authority,
    settings,
  );
  const trust = new WorkspaceTrustLifecycle({
    localTrust: config.initialWorkspaceTrust,
  });
  const filesystem = new WorkspaceFilesystemOwner({
    targetDir: config.getTargetDir(),
    isTrusted: () => trust.isTrustedFolder(),
  });
  const memory = assembleWorkspaceMemory(config, filesystem, trust);
  try {
    await preflight.preparePostConfiguration(
      config,
      filesystem,
      memory,
      trust,
      () => trust.dispose(),
      undefined,
      undefined,
      publishManager,
    );
    return preflight;
  } catch (error) {
    const results = await Promise.allSettled([
      preflight.dispose(),
      memory.dispose(),
      filesystem.dispose(),
      trust.dispose(),
    ]);
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(
        [error, ...failures],
        'Integration preflight cleanup failed',
      );
    throw error;
  }
}
