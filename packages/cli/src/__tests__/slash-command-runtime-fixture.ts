/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  LlxprtExtension,
  WorkspaceSkillOperations,
} from '@vybestack/llxprt-code-core';
import type { CliSessionPersistencePort } from '../cliSessionPersistence.js';
import type { SessionSettingsOperations } from '../runtime/createRuntimeOwnerFeatures.js';
import { InMemoryProviderKeyHandle } from './provider-key-handle-fixture.js';
import type { PerfSnapshotCapability } from '../ui/commands/perfCommand.js';
import {
  buildSlashCommandRuntime,
  type BucketFailoverRuntime,
  type CliUiRuntime,
  type UiRuntimeDeclarationSource,
} from '../ui/cliUiRuntime.js';

type CliUiRuntimeTestArgs = [
  source: UiRuntimeDeclarationSource,
  agent: Parameters<typeof buildSlashCommandRuntime>[1],
  perfSnapshotCapability?: PerfSnapshotCapability | null,
  sessionPersistence?: CliSessionPersistencePort,
  bucketFailover?: BucketFailoverRuntime,
  skillOperations?: Pick<
    WorkspaceSkillOperations,
    'list' | 'find' | 'reload' | 'isAdminEnabled'
  >,
  restartExtension?: (extension: LlxprtExtension) => Promise<void>,
  telemetrySettings?: SessionSettingsOperations,
];

/**
 * The one place test code builds a slash-command runtime. Every test that needs
 * a `CliUiRuntime` goes through here, so a change to what the runtime needs at
 * construction is made in this function rather than at each test. Each runtime
 * reads keys from its own in-memory store.
 */
export function buildSlashCommandRuntimeForTest(
  ...args: CliUiRuntimeTestArgs
): CliUiRuntime {
  const [source, agent, ...rest] = args;
  return buildSlashCommandRuntime(
    source,
    agent,
    new InMemoryProviderKeyHandle(),
    ...rest,
  );
}
