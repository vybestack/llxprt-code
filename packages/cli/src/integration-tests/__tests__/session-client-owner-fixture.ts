/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach } from 'bun:test';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import {
  WorkspaceFilesystemOwner,
  WorkspaceTrustLifecycle,
  type Config,
  type RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { acquireCapturedSessionClient } from '../../../../agents/src/api/__tests__/helpers/session-client-capture.js';
import { runCleanupSteps } from '../../../../agents/src/core/subagent-cleanup.js';
import type { SessionClientOwner } from '../../../../agents/src/session/session-client-owner.js';

export interface ProviderSessionOwner {
  readonly sessionClient: SessionClientOwner;
}

let disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
  const pending = disposals;
  disposals = [];
  await Promise.all(pending.map((dispose) => dispose()));
});

/**
 * Builds the session client owner that sits over a provider manager the test
 * assembled itself, through `acquireSessionClient` (the entry point the
 * production activation, the child assembly and the preferred route call) and
 * the collaborators it fills in production. The owner is disposed in
 * `afterEach`, together with the media store, workspace owners and, when the
 * test did not supply one, the settings owner.
 */
export async function createProviderSessionOwner(
  config: Config,
  manager: RuntimeProviderManager,
  settingsService: SettingsService,
  oauth: OAuthManager,
  borrowedSettingsOwner?: SessionSettingsOwner,
): Promise<ProviderSessionOwner> {
  const settingsOwner =
    borrowedSettingsOwner ?? new SessionSettingsOwner(settingsService);
  settingsOwner.assertSettingsIdentity(settingsService);
  settingsOwner.bindTelemetry(config);
  const media = new SessionMediaOwner(
    config.projectTempDir,
    config.getMediaStoreQuotaByteLimit(),
  );
  const trust = new WorkspaceTrustLifecycle({
    localTrust: config.initialWorkspaceTrust,
  });
  const filesystem = new WorkspaceFilesystemOwner({
    targetDir: config.getTargetDir(),
    customExcludes: config.customExcludes,
    includeDirectories: config.getConfiguredIncludeDirectories(),
    isTrusted: () => trust.isTrustedFolder(),
  });
  const closeOthers = (): Promise<void> =>
    runCleanupSteps([
      () => media.dispose(),
      () => filesystem.dispose(),
      () => trust.dispose(),
      () =>
        borrowedSettingsOwner === undefined
          ? settingsOwner.dispose()
          : undefined,
    ]);
  let sessionClient: SessionClientOwner;
  try {
    sessionClient = await acquireCapturedSessionClient(
      config,
      settingsService,
      settingsOwner,
      manager,
      oauth,
      createRuntimeContentGeneratorFactory(),
      configureProviderTokenizer(manager, undefined),
      new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
        proxy: config.getProxy(),
      }),
      media.store,
      undefined,
      () => undefined,
      filesystem.paths,
    );
  } catch (primary) {
    await closeOthers().catch((secondary: unknown) => {
      throw new AggregateError(
        [primary, secondary],
        'Provider session owner cleanup failed',
      );
    });
    throw primary;
  }
  disposals.push(() =>
    runCleanupSteps([() => sessionClient.dispose(), closeOthers]),
  );
  return { sessionClient };
}
