/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';

import { afterEach } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { WorkspaceToolCatalogOwner } from '@vybestack/llxprt-code-core/services/workspace-tool-catalog-owner.js';
import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { CoreToolHostAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreToolHostAdapter.js';
import { ReadFileTool, type ToolSelection } from '@vybestack/llxprt-code-tools';

export function installModelToolFixture(
  options: { readonly targetDir: string } = { targetDir: process.cwd() },
): () => ToolSelection {
  const LocalModelConfig = Config;
  let roots: ReadonlyArray<{
    config: Config;
    filesystem: WorkspaceFilesystemOwner;
    owner: WorkspaceToolCatalogOwner;
    settingsOwner: SessionSettingsOwner;
    trust: WorkspaceTrustLifecycle;
  }> = [];
  afterEach(async () => {
    const retiring = roots;
    roots = [];
    const results = await Promise.allSettled(
      retiring.map(
        async ({ owner, filesystem, config, settingsOwner, trust }) => {
          await owner.dispose();
          await filesystem.dispose();
          await settingsOwner.dispose();
          await config.dispose();
          await trust.dispose();
        },
      ),
    );
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, 'Model tool fixture cleanup failed');
  });
  return () => {
    const config = new LocalModelConfig({
      sessionId: 'local-model-tools',
      model: 'local-model-fixture',
      targetDir: options.targetDir,
      cwd: options.targetDir,
      debugMode: false,
      trustedFolder: true,
    });
    const settingsOwner = new SessionSettingsOwner(new SettingsService());
    settingsOwner.bindTelemetry(config);
    const trust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });
    const filesystem = new WorkspaceFilesystemOwner({
      targetDir: options.targetDir,
      includeDirectories: [],
      isTrusted: () => trust.isTrustedFolder(),
    });
    const owner = new WorkspaceToolCatalogOwner(
      config,
      new MessageBus(),
      trust,
    );
    owner.publication.registerTool(
      new ReadFileTool(
        new CoreToolHostAdapter(
          config,
          filesystem.paths,
          filesystem.files,
          filesystem.ignore,
          filesystem.scans,
          () => settingsOwner.readToolExecutionPolicy(),
          trust,
          settingsOwner.telemetry,
        ),
      ),
    );
    roots = [...roots, { config, filesystem, owner, settingsOwner, trust }];
    return owner.selection;
  };
}
