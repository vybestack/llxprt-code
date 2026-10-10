import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach } from 'bun:test';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { resolveShellJobSettings } from '@vybestack/llxprt-code-core/config/asyncTaskServices.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { WorkspaceToolCatalogOwner } from '@vybestack/llxprt-code-core/services/workspace-tool-catalog-owner.js';
import { PolicyDecision, PolicyEngine } from '@vybestack/llxprt-code-policy';
import { ShellJobOwner } from '../../session/shell-job-owner.js';
import type {
  AnyDeclarativeTool,
  ToolSelection,
} from '@vybestack/llxprt-code-tools';

interface SchedulerToolFixture {
  readonly config: Config;
  readonly settingsOwner: SessionSettingsOwner;
  readonly messageBus: MessageBus;
  readonly selection: ToolSelection;
  readonly shellOwner: ShellJobOwner;
}

function createOwnedSettings(config: Config): {
  settingsService: SettingsService;
  settingsOwner: SessionSettingsOwner;
} {
  const settingsService = new SettingsService();
  const settingsOwner = new SessionSettingsOwner(settingsService);
  settingsOwner.bindTelemetry(config);
  return { settingsService, settingsOwner };
}

export function installSchedulerToolFixture(): (
  tools: readonly AnyDeclarativeTool[],
  options?: {
    readonly sessionId?: string;
    readonly approvalMode?: ApprovalMode;
    readonly interactive?: boolean;
    readonly enabledNames?: readonly string[];
  },
) => SchedulerToolFixture {
  let roots: ReadonlyArray<{
    config: Config;
    settingsOwner: SessionSettingsOwner;
    catalog: WorkspaceToolCatalogOwner;
    shellOwner: ShellJobOwner;
  }> = [];
  afterEach(async () => {
    const retiring = roots;
    roots = [];
    const outcomes = await Promise.allSettled(
      retiring.map(async ({ config, settingsOwner, catalog, shellOwner }) => {
        const shellResults = await Promise.allSettled([shellOwner.dispose()]);
        const catalogResults = await Promise.allSettled([catalog.dispose()]);
        await settingsOwner.dispose();
        const configResults = await Promise.allSettled([config.dispose()]);
        const results = [...shellResults, ...catalogResults, ...configResults];
        const failures = results.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : [],
        );
        if (failures.length > 0) {
          throw new AggregateError(
            failures,
            'Scheduler fixture root cleanup failed',
          );
        }
      }),
    );
    const failures = outcomes.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Scheduler fixture cleanup failed');
    }
  });
  return (tools, options = {}) => {
    const enabledNames = options.enabledNames;
    const config = new Config({
      sessionId: options.sessionId ?? 'test-session-id',
      model: 'gemini-2.5-pro',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      trustedFolder: true,
      approvalMode: options.approvalMode ?? ApprovalMode.DEFAULT,
      interactive: options.interactive ?? false,
      excludeTools: excludedFixtureTools(tools, enabledNames),
    });
    const messageBus = new MessageBus(
      new PolicyEngine({ defaultDecision: PolicyDecision.ALLOW }),
    );
    const { settingsService, settingsOwner } = createOwnedSettings(config);
    const catalog = new WorkspaceToolCatalogOwner(
      config,
      messageBus,
      new WorkspaceTrustLifecycle({ localTrust: config.initialWorkspaceTrust }),
    );
    const shellOwner = new ShellJobOwner(() =>
      resolveShellJobSettings(settingsService),
    );
    roots = [...roots, { config, settingsOwner, catalog, shellOwner }];
    for (const tool of tools) catalog.publication.registerTool(tool);
    return {
      config,
      settingsOwner,
      messageBus,
      selection: catalog.selection,
      shellOwner,
    };
  };
}

function excludedFixtureTools(
  tools: readonly AnyDeclarativeTool[],
  enabledNames: readonly string[] | undefined,
): string[] {
  return enabledNames === undefined
    ? []
    : tools
        .filter((tool) => !enabledNames.includes(tool.name))
        .map((tool) => tool.name);
}
