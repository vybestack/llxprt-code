/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  LlxprtExtension,
  WorkspaceSkillOperations,
} from '@vybestack/llxprt-code-core';
import type { ProviderKeyStorageLike } from '@vybestack/llxprt-code-storage';
import type { CliSessionPersistencePort } from '../cliSessionPersistence.js';
import type { SessionSettingsOperations } from '../runtime/createRuntimeOwnerFeatures.js';
import { InMemoryProviderKeyHandle } from './provider-key-handle-fixture.js';
import type { PerfSnapshotCapability } from '../ui/commands/perfCommand.js';
import {
  buildUiRuntimeFromSource,
  type BucketFailoverRuntime,
  type CheckpointRuntime,
  type FileWorkspaceState,
  type McpState,
  type MemoryState,
  type ToolRuntime,
  type UiRuntimeBareSource,
  type UiRuntimeDeclarationSource,
} from '../ui/cliUiRuntime.js';
import { createKeyCommandReads } from '../ui/commands/key-completion-owner.js';
import {
  buildInteractiveCommandPorts,
  type InteractiveCommandPorts,
} from '../ui/cliCommandPorts.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { LayoutRuntime } from '../ui/layouts/DefaultAppLayoutHelpers.js';
import type { AppDialogsRuntime } from '../ui/containers/AppContainer/hooks/useAppDialogs.js';
import type { SlashCommandProcessorPorts } from '../ui/hooks/useSlashCommandProcessorCore.js';

/**
 * The flat surface the UI fixtures hand to components and to the command bind
 * functions. Each production consumer takes one narrow port built by
 * `buildInteractiveCommandPorts`; a test hands this single stand-in to the
 * consumer it exercises, and the consumer's narrow prop type is satisfied
 * structurally.
 *
 * This type exists only in `__tests__`. Production has no flat runtime.
 */
export type FixtureCommandRuntime = UiRuntimeBareSource & {
  getProviderKeys(): ProviderKeyStorageLike;
  listKeyCompletionNames(): Promise<readonly string[]>;
  invalidateKeyCompletion(): void;
} & CheckpointRuntime &
  ToolRuntime &
  McpState &
  FileWorkspaceState &
  MemoryState & {
    readonly restartExtension?: (extension: LlxprtExtension) => Promise<void>;
    readonly skillOperations?: Pick<
      WorkspaceSkillOperations,
      'list' | 'find' | 'reload' | 'isAdminEnabled'
    >;
    readonly sessionPersistence?: CliSessionPersistencePort;
    getPerfSnapshotCapability(): PerfSnapshotCapability | null;
  };

type FixtureRuntimeArgs = [
  source: UiRuntimeDeclarationSource,
  agent: Parameters<typeof buildUiRuntimeFromSource>[1] & {
    tools: Pick<Agent['tools'], 'get' | 'describeConfiguration'>;
  },
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

function flatten(
  runtime: ReturnType<typeof buildUiRuntimeFromSource>,
): FixtureCommandRuntime {
  const { session, model, shell, files, memory, hooks, mcp, settings } =
    runtime;
  const { bucketFailover, checkpoint, sessionLimits, interactive } = runtime;
  const { ephemeral, approval, extensions, app } = runtime;
  return {
    ...session,
    ...model,
    ...shell,
    ...files,
    ...memory,
    ...hooks,
    ...mcp,
    ...settings,
    ...bucketFailover,
    ...checkpoint,
    ...sessionLimits,
    ...interactive,
    ...ephemeral,
    ...approval,
    ...extensions,
    ...app,
    projectTempDir: runtime.projectTempDir,
    projectChatsDir: runtime.projectChatsDir,
    projectCheckpointsDir: runtime.projectCheckpointsDir,
    historyFilePath: runtime.historyFilePath,
    userCommandsDir: runtime.userCommandsDir,
    projectCommandsDir: runtime.projectCommandsDir,
  } as unknown as FixtureCommandRuntime;
}

/**
 * The one place test code builds the flat UI fixture. Every test that needs it
 * goes through here, so a change to what the fixture needs at construction is
 * made in this function rather than at each test. Each runtime reads keys from
 * its own in-memory store.
 */
export function buildSlashCommandRuntimeForTest(
  ...[
    source,
    agent,
    perfSnapshotCapability,
    sessionPersistence,
    bucketFailover,
    skillOperations,
    restartExtension,
    telemetrySettings,
  ]: FixtureRuntimeArgs
): FixtureCommandRuntime {
  const flat = flatten(
    buildUiRuntimeFromSource(source, agent, bucketFailover, telemetrySettings),
  );
  const keys = new InMemoryProviderKeyHandle();
  return {
    ...flat,
    ...createKeyCommandReads(() => keys),
    describeToolConfiguration: () => agent.tools.describeConfiguration(),
    getPerfSnapshotCapability: () => perfSnapshotCapability ?? null,
    ...(restartExtension === undefined ? {} : { restartExtension }),
    ...(skillOperations === undefined ? {} : { skillOperations }),
    ...(sessionPersistence === undefined ? {} : { sessionPersistence }),
  };
}

/**
 * Every narrow port the interactive composition root spreads into
 * `AppWrapper`'s and `AppContainerRuntime`'s props. Mounting tests spread this
 * instead of handing the components one runtime object.
 */
export function buildUiPortsForTest(
  ...args: FixtureRuntimeArgs
): InteractiveCommandPorts {
  const [
    source,
    agent,
    perfSnapshotCapability,
    sessionPersistence,
    bucketFailover,
    skillOperations,
    restartExtension,
    telemetrySettings,
  ] = args;
  return buildInteractiveCommandPorts({
    runtime: buildUiRuntimeFromSource(
      source,
      agent,
      bucketFailover,
      telemetrySettings,
    ),
    providerKeys: new InMemoryProviderKeyHandle(),
    describeToolConfiguration: () => agent.tools.describeConfiguration(),
    restartExtension,
    skillOperations,
    sessionPersistence,
    perfSnapshotCapability,
  });
}

/**
 * The ports `AppContainer` requires, spread into its props by tests. Each is
 * built here from one composed runtime so a mount test names only the ports.
 */
export function buildAppContainerPortsForTest(
  ...args: FixtureRuntimeArgs
): Pick<
  InteractiveCommandPorts,
  | 'containerApp'
  | 'containerSession'
  | 'containerTerminal'
  | 'containerMemory'
  | 'containerInput'
  | 'inputPolicy'
  | 'emojiFilter'
  | 'containerRuntime'
  | 'slashCommandPorts'
  | 'layoutRuntime'
  | 'dialogsRuntime'
  | 'browserSession'
> {
  const {
    containerApp,
    containerSession,
    containerTerminal,
    containerMemory,
    containerInput,
    inputPolicy,
    emojiFilter,
    containerRuntime,
    slashCommandPorts,
    layoutRuntime,
    dialogsRuntime,
    browserSession,
  } = buildUiPortsForTest(...args);
  return {
    containerApp,
    containerSession,
    containerTerminal,
    containerMemory,
    containerInput,
    inputPolicy,
    emojiFilter,
    containerRuntime,
    slashCommandPorts,
    layoutRuntime,
    dialogsRuntime,
    browserSession,
  };
}

/** The layout reads alone, for layout, region and inline-content tests. */
export function buildLayoutRuntimeForTest(
  ...args: FixtureRuntimeArgs
): LayoutRuntime {
  return buildUiPortsForTest(...args).layoutRuntime;
}

/** The slash-processor ports alone, for command-family tests. */
export function buildSlashCommandPortsForTest(
  ...args: FixtureRuntimeArgs
): SlashCommandProcessorPorts {
  return buildUiPortsForTest(...args).slashCommandPorts;
}

/** The dialog-layer reads alone, for useAppDialogs tests. */
export function buildDialogsRuntimeForTest(
  ...args: FixtureRuntimeArgs
): AppDialogsRuntime {
  return buildUiPortsForTest(...args).dialogsRuntime;
}
