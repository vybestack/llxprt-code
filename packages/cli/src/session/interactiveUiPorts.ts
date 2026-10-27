/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { LlxprtExtension } from '@vybestack/llxprt-code-core';
import {
  buildSettingsRuntime,
  type SessionSettingsOperations,
} from '../runtime/createRuntimeOwnerFeatures.js';
import type { PerfSnapshotCapability } from '../ui/commands/perfCommand.js';
import {
  buildSessionRuntime,
  buildModelRuntime,
  buildShellRuntime,
  buildFilesRuntime,
  buildMemoryRuntime,
  buildHooksRuntime,
  buildMcpRuntime,
  buildAppEventRuntime,
  buildAppRuntime,
  buildApprovalRuntime,
  buildExtensionRuntime,
  type UiRuntimeDeclarationSource,
  type McpUiSelection,
  type UiToolRegistryInfo,
  type BucketFailoverRuntime,
} from '../ui/cliUiRuntime.js';
import type { ProviderKeyStorageLike } from '@vybestack/llxprt-code-storage';
import type { CliSessionPersistencePort } from '../cliSessionPersistence.js';
import type { SkillsCommandRuntime } from '../ui/hooks/useResourceCommands.js';
import * as Ports from '../ui/cliCommandPorts.js';

export interface InteractiveUiSources {
  source: UiRuntimeDeclarationSource;
  agent: Parameters<typeof buildAppRuntime>[1] &
    Parameters<typeof buildSettingsRuntime>[1] & {
      hooks: Parameters<typeof buildHooksRuntime>[1];
      mcp: McpUiSelection;
      memory: Agent['memory'];
      getModel: Agent['getModel'];
      getApprovalMode: Agent['getApprovalMode'];
      setApprovalMode: Agent['setApprovalMode'];
    };
  providerKeys: ProviderKeyStorageLike;
  describeToolConfiguration: () => UiToolRegistryInfo;
  bucketFailover: BucketFailoverRuntime;
  telemetrySettings: SessionSettingsOperations | undefined;
  restartExtension?: (extension: LlxprtExtension) => Promise<void>;
  skillOperations?: SkillsCommandRuntime;
  sessionPersistence?: CliSessionPersistencePort;
  perfSnapshotCapability?: PerfSnapshotCapability | null;
}

class InteractiveUiAssembly {
  readonly inputs: InteractiveUiSources;
  readonly session;
  readonly model;
  readonly shell;
  readonly files;
  readonly memory;
  readonly hooks;
  readonly mcp;
  readonly settings;
  readonly events;
  readonly bucketFailover;
  readonly checkpoint;
  readonly sessionLimits;
  readonly interactive;
  readonly ephemeral;
  readonly approval;
  readonly extensions;
  readonly app;

  constructor(inputs: InteractiveUiSources) {
    this.inputs = inputs;
    const { source, agent } = inputs;
    this.session = buildSessionRuntime(source);
    this.model = buildModelRuntime(agent);
    this.shell = buildShellRuntime(source);
    this.files = buildFilesRuntime(source, agent);
    this.memory = buildMemoryRuntime(source, agent);
    this.hooks = buildHooksRuntime(source, agent.hooks);
    this.mcp = buildMcpRuntime(source, agent.mcp);
    this.settings = buildSettingsRuntime(
      source,
      agent,
      inputs.telemetrySettings,
    );
    this.events = buildAppEventRuntime(agent.mcp);
    this.bucketFailover = inputs.bucketFailover;
    this.checkpoint = {
      checkpoints: agent.workspace.checkpoints,
      getCheckpointingEnabled: () => source.getCheckpointingEnabled(),
    };
    this.sessionLimits = {
      getMaxSessionTurns: () => source.getMaxSessionTurns(),
    };
    this.interactive = { isInteractive: () => source.isInteractive() };
    this.ephemeral = {
      getEphemeralSetting: (key: string) => agent.getEphemeralSetting(key),
    };
    this.approval = buildApprovalRuntime(source, agent);
    this.extensions = buildExtensionRuntime(source);
    this.app = buildAppRuntime(source, agent);
  }
  commands(): Pick<
    Ports.InteractiveCommandPorts,
    | 'commandRegistry'
    | 'fileCommands'
    | 'workspaceCommands'
    | 'chatCommands'
    | 'keyCommands'
    | 'slashCommandPorts'
  > {
    const inputs = this.inputs;
    const { source, providerKeys } = inputs;
    const {
      session,
      model,
      shell,
      files,
      memory,
      hooks,
      mcp,
      settings,
      interactive,
      approval,
      extensions,
      app,
    } = this;
    return {
      commandRegistry: Ports.buildCommandRegistryReads({
        extensions,
        hooks,
        mcp,
      }),
      fileCommands: Ports.buildFileCommandReads({
        app,
        approval,
        extensions,
        projectCommandsDir: source.projectCommandsDir,
        session,
        shell,
        userCommandsDir: source.userCommandsDir,
      }),
      workspaceCommands: Ports.buildWorkspaceCommandPorts({
        app,
        files,
        memory,
        model,
        session,
        settings,
      }),
      chatCommands: Ports.buildChatCommandReads(
        {
          interactive,
          model,
          projectChatsDir: source.projectChatsDir,
          projectTempDir: source.projectTempDir,
          session,
        },
        inputs.sessionPersistence,
      ),
      keyCommands: Ports.buildKeyCommandReads(
        { app, interactive },
        providerKeys,
      ),
      slashCommandPorts: this.commandRegistration(),
    };
  }
  private commandRegistration(): Ports.InteractiveCommandPorts['slashCommandPorts'] {
    const inputs = this.inputs;
    const { source } = inputs;
    const {
      app,
      approval,
      bucketFailover,
      checkpoint,
      ephemeral,
      extensions,
      files,
      mcp,
      memory,
      model,
      session,
      settings,
    } = this;
    return Ports.buildSlashCommandPorts({
      runtime: {
        app,
        approval,
        bucketFailover,
        checkpoint,
        ephemeral,
        extensions,
        files,
        mcp,
        memory,
        model,
        projectCheckpointsDir: source.projectCheckpointsDir,
        session,
        settings,
      },
      restartExtension: inputs.restartExtension,
      skillOperations: inputs.skillOperations,
      sessionPersistence: inputs.sessionPersistence,
      perfSnapshotCapability: inputs.perfSnapshotCapability,
    });
  }

  view(): Pick<
    Ports.InteractiveCommandPorts,
    | 'containerApp'
    | 'containerSession'
    | 'containerTerminal'
    | 'containerMemory'
    | 'containerInput'
    | 'approval'
    | 'browserSession'
    | 'emojiFilter'
    | 'containerRuntime'
    | 'layoutRuntime'
    | 'dialogsRuntime'
  > {
    const inputs = this.inputs;
    const { source, describeToolConfiguration } = inputs;
    const {
      session,
      model,
      shell,
      files,
      memory,
      hooks,
      mcp,
      settings,
      ephemeral,
      approval,
      extensions,
      app,
    } = this;
    return {
      containerApp: Ports.buildContainerAppReads({ app }),
      containerSession: Ports.buildContainerSessionReads({ session }),
      containerTerminal: Ports.buildContainerTerminalReads({ shell }),
      containerMemory: Ports.buildContainerMemoryReads({ memory }),
      containerInput: Ports.buildContainerInputReads({
        app,
        hooks,
        mcp,
        shell,
      }),
      approval: { getApprovalMode: approval.getApprovalMode },
      browserSession: Ports.buildBrowserResumeRuntime(
        { ephemeral, files, model, session },
        inputs.sessionPersistence,
      ),
      emojiFilter: { getEphemeralSetting: ephemeral.getEphemeralSetting },
      containerRuntime: Ports.buildContainerRuntimeReads({
        app,
        extensions,
        memory,
        model,
        session,
      }),
      layoutRuntime: Ports.buildLayoutRuntime(
        {
          app,
          extensions,
          files,
          historyFilePath: source.historyFilePath,
          mcp,
          memory,
          session,
          shell,
        },
        describeToolConfiguration,
      ),
      dialogsRuntime: Ports.buildDialogsRuntime({
        app,
        ephemeral,
        model,
        session,
        settings,
      }),
    };
  }
  input(): Pick<Ports.InteractiveCommandPorts, 'inputPolicy'> {
    const inputs = this.inputs;
    const { source } = inputs;
    const {
      session,
      model,
      shell,
      files,
      settings,
      events,
      bucketFailover,
      checkpoint,
      sessionLimits,
      ephemeral,
    } = this;
    return {
      inputPolicy: Ports.buildInputStreamPolicyReads({
        bucketFailover,
        checkpoint,
        ephemeral,
        events,
        files,
        model,
        projectCheckpointsDir: source.projectCheckpointsDir,
        projectTempDir: source.projectTempDir,
        session,
        sessionLimits,
        settings,
        shell,
      }),
    };
  }
}

export function buildInteractiveUiPorts(
  inputs: InteractiveUiSources,
): Ports.InteractiveCommandPorts {
  const assembly = new InteractiveUiAssembly(inputs);
  return { ...assembly.commands(), ...assembly.view(), ...assembly.input() };
}
