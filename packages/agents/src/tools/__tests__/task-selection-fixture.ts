/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';

import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { afterEach } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { CoreToolRegistryHostAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreToolRegistryHostAdapter.js';
import { CoreMessageBusAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreMessageBusAdapter.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ToolRegistry, type ToolSelection } from '@vybestack/llxprt-code-tools';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { SessionToolCatalogOwner } from '../../session/session-tool-catalog-owner.js';

let owners: ReadonlyArray<{
  catalog: SessionToolCatalogOwner;
  settingsOwner: SessionSettingsOwner;
  config: Config;
}> = [];
afterEach(async () => {
  const retiring = owners;
  owners = [];
  const results = await Promise.allSettled(
    retiring.map(async ({ catalog, settingsOwner, config }) => {
      await catalog.dispose();
      await settingsOwner.dispose();
      await config.dispose();
    }),
  );
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(failures, 'Task selection fixture cleanup failed');
});

export async function taskSelection(input: {
  getEnabledTools(): ReadonlyArray<{ readonly name: string }>;
}): Promise<ToolSelection> {
  const settings = new SettingsService();
  const settingsOwner = new SessionSettingsOwner(settings);
  const config = new Config({
    sessionId: 'task-selection-fixture',
    model: 'task-fixture-model',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    trustedFolder: true,
    initialSettings: {},
  });
  const bus = new MessageBus();
  const registry = new ToolRegistry(
    new CoreToolRegistryHostAdapter(config),
    new CoreMessageBusAdapter(bus),
    assembleTaskSchemaPolicy(settings),
  );
  for (const { name } of input.getEnabledTools())
    registry.registerTool(new MockTool({ name }));
  const catalog = new SessionToolCatalogOwner(
    config,
    assembleTaskSchemaPolicy(settings),
    () => settingsOwner.readToolExecutionPolicy(),
  );
  await catalog.initializeInherited(registry, bus);
  owners = [...owners, { catalog, config, settingsOwner }];
  return catalog.selection;
}
