import type { DebugCommandOperations } from './commands/debugCommands.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AccessibilitySettings,
  ApprovalMode,
  LlxprtExtension,
  MCPServerConfig,
  ShellExecutionConfig,
  ShellReplacementMode,
} from '@vybestack/llxprt-code-core';
import type { ProviderKeyStorageLike } from '@vybestack/llxprt-code-storage';
import type { CliSessionPersistencePort } from '../cliSessionPersistence.js';
import type { PerfSnapshotCapability } from './commands/perfCommand.js';
import type {
  SessionIdentity,
  ModelState,
  FileWorkspaceState,
  MemoryState,
  SettingsTelemetryState,
  AppEventRuntime,
  BucketFailoverRuntime,
  CheckpointRuntime,
  SessionLimitsRuntime,
  InteractiveRuntime,
  EphemeralSettingsRuntime,
  ApprovalState,
  ExtensionRuntime,
  AppStateRuntime,
  ExtensionEnablementSource,
  HookSkillState,
  McpState,
  RefreshMemoryResult,
  ShellState,
  UiSubagentManager,
  UiToolRegistryInfo,
} from './cliUiRuntime.js';
import type { WorkspaceCommandRuntime } from './hooks/workspaceCommandOwners.js';
import type { StreamPolicyReads } from './inputOwnerBindings.js';
import type { BrowserSessionReads } from './components/browserResumeHost.js';
import type { SlashCommandProcessorPorts } from './hooks/useSlashCommandProcessorCore.js';
import type { SkillsCommandRuntime } from './hooks/useResourceCommands.js';
import type { AppDialogsRuntime } from './containers/AppContainer/hooks/useAppDialogs.js';
import type { LayoutRuntime } from './layouts/DefaultAppLayoutHelpers.js';
import type { SessionBrowserReads } from './components/DialogManagerRenderers.js';
import type { EmojiFilterSettingsSource } from './utils/iContentToHistoryItems.js';
import { createKeyCommandReads } from './commands/key-completion-owner.js';

/**
 * The reads the builtin/registered command loaders and the MCP prompt loader
 * make: hook and skill support flags, extension enablement, and the MCP
 * prompts that become slash commands.
 */
export interface CommandRegistryReads {
  getEnableHooksUI(): boolean;
  isSkillsSupportEnabled(): boolean;
  isAdminSkillsEnabled(): boolean;
  readonly extensionEnablementManager?: ExtensionEnablementSource;
  getMcpServers(): Record<string, MCPServerConfig> | undefined;
  listPrompts(serverName: string): ReturnType<McpState['listPrompts']>;
}

/**
 * File-command discovery reads: where commands live, the workspace trust state
 * that gates them, and the shell settings their prompts inherit.
 */
export interface FileCommandReads {
  readonly userCommandsDir: string;
  readonly projectCommandsDir: string;
  getProjectRoot(): string;
  getExtensions(): LlxprtExtension[];
  getFolderTrust(): boolean;
  isTrustedFolder(): boolean;
  getShellReplacement(): ShellReplacementMode;
  getExcludeTools(): string[] | undefined;
  getCoreTools(): string[] | undefined;
  getApprovalMode(): ApprovalMode;
  getShellExecutionConfig(): ShellExecutionConfig;
  getTargetDir(): string;
  getShouldUseNodePtyShell(): boolean;
}

/**
 * Chat reads: the directories chats are written to, the model recorded chats
 * replay, the interactive flag /continue reads, and the persistence the
 * raw-recording path binds.
 */
export interface ChatCommandReads {
  readonly projectChatsDir: string;
  readonly projectTempDir: string;
  getProjectRoot(): string;
  getModel(): string;
  isInteractive(): boolean;
  readonly sessionPersistence?: CliSessionPersistencePort;
}

/** Provider-key command reads: the key store and the setting it toggles. */
export interface KeyCommandReads {
  getProviderKeys(): ProviderKeyStorageLike;
  listKeyCompletionNames(): Promise<readonly string[]>;
  invalidateKeyCompletion(): void;
  isInteractive(): boolean;
  setEphemeralSetting(key: string, value: unknown): void;
}

/**
 * Everything the session-browser and raw-resume path reads: the recordings
 * directory and session identity, the resume reads the recording restore
 * needs, and the emoji filter replay resolves.
 */
export type BrowserResumeRuntime = BrowserSessionReads &
  Pick<SessionBrowserReads, 'getProjectTempDir'> &
  EmojiFilterSettingsSource;

/**
 * The reads the container makes outside the slash-command processor: the model
 * that seeds the settings store, memory refresh and debug mode for the input
 * path, and the extension and working-directory reads the command view needs.
 */
export interface ContainerRuntimeReads {
  getModel(): string;
  refreshMemory(): Promise<RefreshMemoryResult>;
  getDebugMode(): boolean;
  getExtensions(): LlxprtExtension[];
  getWorkingDir(): string;
}

/**
 * The app-level flags the container renders with: screen reader, accessibility,
 * debug mode, and the subagent manager the dialogs list.
 */
export interface ContainerAppReads {
  getScreenReader(): boolean;
  getAccessibility(): AccessibilitySettings;
  getDebugMode(): boolean;
  getSubagentManager(): UiSubagentManager | undefined;
}

/**
 * Session identity the container and app providers read: the id the task-list
 * provider scopes to and the directory the layout shows branch state for.
 */
export interface ContainerSessionReads {
  getSessionId(): string;
  getTargetDir(): string;
}

/** Terminal reads: the pty size the layout writes and the background colour. */
export interface ContainerTerminalReads {
  setPtyTerminalSize(width: number, height: number): void;
  getTerminalBackground(): string | undefined;
}

/** Memory counters the bootstrap seeds before the first render. */
export interface ContainerMemoryReads {
  getLlxprtMdFileCount(): number;
  getCoreMemoryFileCount(): number;
}

/**
 * The runtime slices the input read bindings take, narrowed to the four
 * capability objects `useInputReadOperations` reads.
 */
export interface ContainerInputReads {
  readonly hooks: Pick<HookSkillState, 'endHookSession'>;
  readonly app: Pick<AppStateRuntime, 'getQuestion'>;
  readonly shell: Pick<ShellState, 'getEnableInteractiveShell'>;
  readonly mcp: Pick<McpState, 'getMcpServers'>;
}

/**
 * The composition root's forwarding record. Every field is a projection built
 * for one consumer family (the command registry loaders, the file-command
 * loader, the workspace/chat/key command owners, the slash processor's ports,
 * and the layout and dialog layers). It carries no capability of its own, so
 * it is not the flattened runtime: the root spreads these fields into the
 * component props and each consumer reads only the field it was given.
 */
export interface InteractiveCommandPorts {
  readonly commandRegistry: CommandRegistryReads;
  readonly containerApp: ContainerAppReads;
  readonly containerSession: ContainerSessionReads;
  readonly containerTerminal: ContainerTerminalReads;
  readonly containerMemory: ContainerMemoryReads;
  readonly containerInput: ContainerInputReads;
  readonly inputPolicy: StreamPolicyReads;
  readonly fileCommands: FileCommandReads;
  readonly workspaceCommands: WorkspaceCommandRuntime;
  readonly chatCommands: ChatCommandReads;
  readonly keyCommands: KeyCommandReads;
  readonly approval: { getApprovalMode(): ApprovalMode };
  readonly browserSession: BrowserResumeRuntime;
  readonly emojiFilter: EmojiFilterSettingsSource;
  readonly containerRuntime: ContainerRuntimeReads;
  readonly slashCommandPorts: SlashCommandProcessorPorts;
  readonly layoutRuntime: LayoutRuntime;
  readonly dialogsRuntime: AppDialogsRuntime;
}

export function buildContainerAppReads(runtime: {
  app: Pick<
    AppStateRuntime,
    | 'getAccessibility'
    | 'getDebugMode'
    | 'getScreenReader'
    | 'getSubagentManager'
  >;
}): ContainerAppReads {
  const { app } = runtime;
  return {
    getScreenReader: app.getScreenReader,
    getAccessibility: app.getAccessibility,
    getDebugMode: app.getDebugMode,
    getSubagentManager: app.getSubagentManager,
  };
}

export function buildContainerSessionReads(runtime: {
  session: Pick<SessionIdentity, 'getSessionId' | 'getTargetDir'>;
}): ContainerSessionReads {
  const { session } = runtime;
  return {
    getSessionId: session.getSessionId,
    getTargetDir: session.getTargetDir,
  };
}

export function buildContainerTerminalReads(runtime: {
  shell: Pick<ShellState, 'getTerminalBackground' | 'setPtyTerminalSize'>;
}): ContainerTerminalReads {
  const { shell } = runtime;
  return {
    setPtyTerminalSize: shell.setPtyTerminalSize,
    getTerminalBackground: shell.getTerminalBackground,
  };
}

export function buildContainerMemoryReads(runtime: {
  memory: Pick<MemoryState, 'getCoreMemoryFileCount' | 'getLlxprtMdFileCount'>;
}): ContainerMemoryReads {
  const { memory } = runtime;
  return {
    getLlxprtMdFileCount: memory.getLlxprtMdFileCount,
    getCoreMemoryFileCount: memory.getCoreMemoryFileCount,
  };
}

export function buildContainerInputReads(runtime: {
  app: Pick<AppStateRuntime, 'getQuestion'>;
  hooks: Pick<HookSkillState, 'endHookSession'>;
  mcp: Pick<McpState, 'getMcpServers'>;
  shell: Pick<ShellState, 'getEnableInteractiveShell'>;
}): ContainerInputReads {
  return {
    hooks: { endHookSession: runtime.hooks.endHookSession },
    app: { getQuestion: runtime.app.getQuestion },
    shell: {
      getEnableInteractiveShell: runtime.shell.getEnableInteractiveShell,
    },
    mcp: { getMcpServers: runtime.mcp.getMcpServers },
  };
}

export function buildInputStreamPolicyReads(runtime: {
  bucketFailover: BucketFailoverRuntime;
  checkpoint: CheckpointRuntime;
  ephemeral: EphemeralSettingsRuntime;
  events: AppEventRuntime;
  files: Pick<
    FileWorkspaceState,
    | 'contains'
    | 'directories'
    | 'getEnableRecursiveFileSearch'
    | 'getFileFilteringOptions'
    | 'ignore'
  >;
  model: ModelState;
  projectCheckpointsDir: string;
  projectTempDir: string;
  session: Pick<SessionIdentity, 'getSessionId' | 'getTargetDir'>;
  sessionLimits: SessionLimitsRuntime;
  settings: Pick<
    SettingsTelemetryState,
    | 'logUserPrompt'
    | 'readCitations'
    | 'readProfileName'
    | 'readSelectedProvider'
  >;
  shell: Pick<
    ShellState,
    | 'getEnableInteractiveShell'
    | 'getPtyTerminalHeight'
    | 'getPtyTerminalWidth'
    | 'getShellExecutionConfig'
    | 'getShouldUseNodePtyShell'
  >;
}): StreamPolicyReads {
  const { session, events, model, ephemeral, shell, checkpoint } = runtime;
  const { files, settings, bucketFailover, sessionLimits } = runtime;
  return {
    session: {
      getSessionId: session.getSessionId,
      getTargetDir: session.getTargetDir,
    },
    events,
    model,
    ephemeral,
    shell: {
      getShouldUseNodePtyShell: shell.getShouldUseNodePtyShell,
      getShellExecutionConfig: shell.getShellExecutionConfig,
      getPtyTerminalWidth: shell.getPtyTerminalWidth,
      getPtyTerminalHeight: shell.getPtyTerminalHeight,
      getEnableInteractiveShell: shell.getEnableInteractiveShell,
    },
    checkpoint,
    files: {
      getFileFilteringOptions: files.getFileFilteringOptions,
      directories: files.directories,
      contains: files.contains,
      ignore: files.ignore,
      getEnableRecursiveFileSearch: files.getEnableRecursiveFileSearch,
    },
    settings: {
      logUserPrompt: settings.logUserPrompt,
      readSelectedProvider: settings.readSelectedProvider,
      readCitations: settings.readCitations,
      readProfileName: settings.readProfileName,
    },
    bucketFailover,
    sessionLimits,
    projectTempDir: runtime.projectTempDir,
    projectCheckpointsDir: runtime.projectCheckpointsDir,
  };
}

export function buildCommandRegistryReads(runtime: {
  extensions: Pick<ExtensionRuntime, 'extensionEnablementManager'>;
  hooks: Pick<
    HookSkillState,
    'getEnableHooksUI' | 'isAdminSkillsEnabled' | 'isSkillsSupportEnabled'
  >;
  mcp: Pick<McpState, 'getMcpServers' | 'listPrompts'>;
}): CommandRegistryReads {
  return {
    getEnableHooksUI: runtime.hooks.getEnableHooksUI,
    isSkillsSupportEnabled: runtime.hooks.isSkillsSupportEnabled,
    isAdminSkillsEnabled: runtime.hooks.isAdminSkillsEnabled,
    extensionEnablementManager: runtime.extensions.extensionEnablementManager,
    getMcpServers: runtime.mcp.getMcpServers,
    listPrompts: runtime.mcp.listPrompts,
  };
}

export function buildFileCommandReads(runtime: {
  app: Pick<AppStateRuntime, 'getFolderTrust' | 'isTrustedFolder'>;
  approval: Pick<
    ApprovalState,
    'getApprovalMode' | 'getCoreTools' | 'getExcludeTools'
  >;
  extensions: Pick<ExtensionRuntime, 'getExtensions'>;
  projectCommandsDir: string;
  session: Pick<SessionIdentity, 'getProjectRoot' | 'getTargetDir'>;
  shell: Pick<
    ShellState,
    | 'getShellExecutionConfig'
    | 'getShellReplacement'
    | 'getShouldUseNodePtyShell'
  >;
  userCommandsDir: string;
}): FileCommandReads {
  const { session, approval, app, extensions, shell } = runtime;
  return {
    userCommandsDir: runtime.userCommandsDir,
    projectCommandsDir: runtime.projectCommandsDir,
    getProjectRoot: session.getProjectRoot,
    getExtensions: extensions.getExtensions,
    getFolderTrust: app.getFolderTrust,
    isTrustedFolder: app.isTrustedFolder,
    getShellReplacement: shell.getShellReplacement,
    getExcludeTools: approval.getExcludeTools,
    getCoreTools: approval.getCoreTools,
    getApprovalMode: approval.getApprovalMode,
    getShellExecutionConfig: shell.getShellExecutionConfig,
    getTargetDir: session.getTargetDir,
    getShouldUseNodePtyShell: shell.getShouldUseNodePtyShell,
  };
}

export function buildWorkspaceCommandPorts(runtime: {
  app: Pick<
    AppStateRuntime,
    | 'getFolderTrust'
    | 'isRestrictiveSandbox'
    | 'updateSystemInstructionIfInitialized'
  >;
  files: Pick<FileWorkspaceState, 'addDirectory' | 'directories'>;
  memory: Pick<
    MemoryState,
    | 'getLlxprtMdFileCount'
    | 'getLlxprtMdFilePaths'
    | 'getUserMemory'
    | 'refreshMemory'
    | 'shouldLoadMemoryFromIncludeDirectories'
  >;
  model: Pick<ModelState, 'getModel'>;
  session: Pick<SessionIdentity, 'getTargetDir' | 'getWorkingDir'>;
  settings: Pick<SettingsTelemetryState, 'getBugCommand'>;
}): WorkspaceCommandRuntime {
  const { session, memory, model, app, files, settings } = runtime;
  return {
    memory: {
      getUserMemory: memory.getUserMemory,
      getLlxprtMdFileCount: memory.getLlxprtMdFileCount,
      getLlxprtMdFilePaths: memory.getLlxprtMdFilePaths,
      refreshMemory: memory.refreshMemory,
      updateSystemInstructionIfInitialized:
        app.updateSystemInstructionIfInitialized,
      getWorkingDir: session.getWorkingDir,
    },
    bug: {
      getModel: model.getModel,
      getBugCommand: settings.getBugCommand,
    },
    directory: {
      addDirectory: files.addDirectory,
      directories: files.directories,
      getFolderTrust: app.getFolderTrust,
      isRestrictiveSandbox: app.isRestrictiveSandbox,
      refreshMemory: memory.refreshMemory,
      shouldLoadMemoryFromIncludeDirectories:
        memory.shouldLoadMemoryFromIncludeDirectories,
    },
    getTargetDir: session.getTargetDir,
  };
}

export function buildChatCommandReads(
  runtime: {
    interactive: Pick<InteractiveRuntime, 'isInteractive'>;
    model: Pick<ModelState, 'getModel'>;
    projectChatsDir: string;
    projectTempDir: string;
    session: Pick<SessionIdentity, 'getProjectRoot'>;
  },
  sessionPersistence?: CliSessionPersistencePort,
): ChatCommandReads {
  return {
    projectChatsDir: runtime.projectChatsDir,
    projectTempDir: runtime.projectTempDir,
    getProjectRoot: runtime.session.getProjectRoot,
    getModel: runtime.model.getModel,
    isInteractive: runtime.interactive.isInteractive,
    sessionPersistence,
  };
}

export function buildKeyCommandReads(
  runtime: {
    app: Pick<AppStateRuntime, 'setEphemeralSetting'>;
    interactive: Pick<InteractiveRuntime, 'isInteractive'>;
  },
  providerKeys: ProviderKeyStorageLike,
): KeyCommandReads {
  return {
    ...createKeyCommandReads(() => providerKeys),
    isInteractive: runtime.interactive.isInteractive,
    setEphemeralSetting: runtime.app.setEphemeralSetting,
  };
}

export function buildContainerRuntimeReads(runtime: {
  app: Pick<AppStateRuntime, 'getDebugMode'>;
  extensions: Pick<ExtensionRuntime, 'getExtensions'>;
  memory: Pick<MemoryState, 'refreshMemory'>;
  model: Pick<ModelState, 'getModel'>;
  session: Pick<SessionIdentity, 'getWorkingDir'>;
}): ContainerRuntimeReads {
  return {
    getModel: runtime.model.getModel,
    refreshMemory: runtime.memory.refreshMemory,
    getDebugMode: runtime.app.getDebugMode,
    getExtensions: runtime.extensions.getExtensions,
    getWorkingDir: runtime.session.getWorkingDir,
  };
}

export function buildBrowserResumeRuntime(
  runtime: {
    ephemeral: Pick<EphemeralSettingsRuntime, 'getEphemeralSetting'>;
    files: Pick<FileWorkspaceState, 'directories'>;
    model: Pick<ModelState, 'getModel' | 'getProvider'>;
    session: Pick<
      SessionIdentity,
      | 'adoptSessionId'
      | 'getProjectRoot'
      | 'getProjectTempDir'
      | 'getSessionId'
      | 'getSessionRecordingQueueByteLimit'
    >;
  },
  sessionPersistence?: CliSessionPersistencePort,
): BrowserResumeRuntime {
  return {
    ...buildBrowserSessionReads(runtime, sessionPersistence),
    getProjectTempDir: runtime.session.getProjectTempDir,
    getEphemeralSetting: runtime.ephemeral.getEphemeralSetting,
  };
}

function buildBrowserSessionReads(
  runtime: {
    files: Pick<FileWorkspaceState, 'directories'>;
    model: Pick<ModelState, 'getModel' | 'getProvider'>;
    session: Pick<
      SessionIdentity,
      | 'adoptSessionId'
      | 'getProjectRoot'
      | 'getProjectTempDir'
      | 'getSessionId'
      | 'getSessionRecordingQueueByteLimit'
    >;
  },
  sessionPersistence?: CliSessionPersistencePort,
): BrowserSessionReads {
  const { session, model, files } = runtime;
  return {
    projectTempDir: session.getProjectTempDir(),
    getProjectRoot: session.getProjectRoot,
    getSessionId: session.getSessionId,
    getProvider: model.getProvider,
    getModel: model.getModel,
    directories: files.directories,
    getSessionRecordingQueueByteLimit:
      session.getSessionRecordingQueueByteLimit,
    adoptSessionId: session.adoptSessionId,
    sessionPersistence,
  };
}

interface SlashCommandSources {
  debug: DebugCommandOperations;
  runtime: {
    app: Pick<
      AppStateRuntime,
      | 'getConversationLogPath'
      | 'getDebugMode'
      | 'getEphemeralSettings'
      | 'getFolderTrust'
      | 'getScreenReader'
      | 'isTrustedFolder'
      | 'setTrustedFolderLive'
    >;
    approval: Pick<ApprovalState, 'getApprovalMode'>;
    bucketFailover: Pick<
      BucketFailoverRuntime,
      'readCurrentBucket' | 'readFailoverBuckets'
    >;
    checkpoint: Pick<
      CheckpointRuntime,
      'checkpoints' | 'getCheckpointingEnabled'
    >;
    ephemeral: Pick<EphemeralSettingsRuntime, 'getEphemeralSetting'>;
    extensions: Pick<ExtensionRuntime, 'getExtensions'>;
    files: Pick<FileWorkspaceState, 'directories'>;
    mcp: Pick<McpState, 'getMcpServerCommand' | 'getMcpServers'>;
    memory: Pick<MemoryState, 'getLlxprtMdFileCount' | 'getUserMemory'>;
    model: Pick<ModelState, 'getModel' | 'getProvider'>;
    projectCheckpointsDir: string;
    session: Pick<
      SessionIdentity,
      | 'adoptSessionId'
      | 'getProjectRoot'
      | 'getProjectTempDir'
      | 'getSessionId'
      | 'getSessionRecordingQueueByteLimit'
      | 'getTargetDir'
      | 'getWorkingDir'
    >;
    settings: Pick<
      SettingsTelemetryState,
      | 'logSlashCommand'
      | 'getProxy'
      | 'getRedactionConfig'
      | 'getTelemetrySettings'
      | 'updateTelemetrySettings'
    >;
  };
  restartExtension?: (extension: LlxprtExtension) => Promise<void>;
  skillOperations?: SkillsCommandRuntime;
  sessionPersistence?: CliSessionPersistencePort;
  perfSnapshotCapability?: PerfSnapshotCapability | null;
}

export function buildSlashCommandPorts(
  sources: SlashCommandSources,
): SlashCommandProcessorPorts {
  const {
    runtime,
    restartExtension,
    skillOperations,
    sessionPersistence,
    perfSnapshotCapability,
  } = sources;
  const { session, model, memory, mcp, app, approval, extensions } = runtime;
  const { settings, ephemeral, bucketFailover, checkpoint } = runtime;
  return {
    debug: sources.debug,
    extensions: {
      getExtensions: extensions.getExtensions,
      restartExtension,
    },
    hosts: {
      getWorkingDir: session.getWorkingDir,
      getProxy: settings.getProxy,
    },
    trust: {
      isTrustedFolder: app.isTrustedFolder,
      getWorkingDir: session.getWorkingDir,
      setTrustedFolderLive: app.setTrustedFolderLive,
      getFolderTrust: app.getFolderTrust,
    },
    logging: {
      getTelemetrySettings: settings.getTelemetrySettings,
      updateTelemetrySettings: settings.updateTelemetrySettings,
      getConversationLogPath: app.getConversationLogPath,
      getRedactionConfig: settings.getRedactionConfig,
    },
    skills: skillOperations,
    emojiFilter: { getEphemeralSetting: ephemeral.getEphemeralSetting },
    commandLogging: settings,
    about: {
      getModel: model.getModel,
      getProvider: model.getProvider,
      getEphemeralSetting: ephemeral.getEphemeralSetting,
    },
    diagnostics: {
      getWorkingDir: session.getWorkingDir,
      getDebugMode: app.getDebugMode,
      getApprovalMode: approval.getApprovalMode,
      getMcpServers: mcp.getMcpServers,
      getMcpServerCommand: mcp.getMcpServerCommand,
      getUserMemory: memory.getUserMemory,
      getLlxprtMdFileCount: memory.getLlxprtMdFileCount,
      readFailoverBuckets: bucketFailover.readFailoverBuckets,
      readCurrentBucket: bucketFailover.readCurrentBucket,
    },
    history: {
      getEphemeralSettings: app.getEphemeralSettings,
      getPerfSnapshotCapability: () => perfSnapshotCapability ?? null,
      getProjectTempDir: session.getProjectTempDir,
      getCheckpointingEnabled: checkpoint.getCheckpointingEnabled,
      projectCheckpointsDir: runtime.projectCheckpointsDir,
      checkpoints: checkpoint.checkpoints,
    },
    readScreenReader: app.getScreenReader,
    readTargetDir: session.getTargetDir,
    resumeSession: buildBrowserSessionReads(runtime, sessionPersistence),
  };
}

export function buildLayoutRuntime(
  runtime: {
    app: Pick<
      AppStateRuntime,
      | 'getDebugMode'
      | 'getEnablePromptCompletion'
      | 'getFolderTrust'
      | 'getScreenReader'
      | 'getSubagentManager'
      | 'getUtilityModel'
      | 'githubCompletion'
      | 'isTrustedFolder'
      | 'setTrustedFolderLive'
    >;
    extensions: Pick<ExtensionRuntime, 'isExtensionEnabled'>;
    files: Pick<
      FileWorkspaceState,
      | 'directories'
      | 'getEnableRecursiveFileSearch'
      | 'getFileFilteringDisableFuzzySearch'
      | 'getFileFilteringOptions'
      | 'ignore'
      | 'initializeSearch'
      | 'search'
    >;
    historyFilePath: string;
    getSkillCount(): number;
    mcp: Pick<
      McpState,
      'getBlockedMcpServers' | 'getMcpServers' | 'listResources'
    >;
    memory: Pick<MemoryState, 'getLlxprtMdFileCount'>;
    session: Pick<
      SessionIdentity,
      | 'getProjectRoot'
      | 'getProjectTempDir'
      | 'getSessionId'
      | 'getTargetDir'
      | 'getWorkingDir'
    >;
    shell: Pick<ShellState, 'getEnableInteractiveShell'>;
  },
  describeToolConfiguration: () => UiToolRegistryInfo,
): LayoutRuntime {
  const { session, shell, files, memory, mcp, app, extensions } = runtime;
  return {
    getLlxprtMdFileCount: memory.getLlxprtMdFileCount,
    getSkillCount: runtime.getSkillCount,
    getScreenReader: app.getScreenReader,
    getEnableInteractiveShell: shell.getEnableInteractiveShell,
    isTrustedFolder: app.isTrustedFolder,
    search: files.search,
    initializeSearch: files.initializeSearch,
    ignore: files.ignore,
    getFileFilteringOptions: files.getFileFilteringOptions,
    getEnableRecursiveFileSearch: files.getEnableRecursiveFileSearch,
    getFileFilteringDisableFuzzySearch:
      files.getFileFilteringDisableFuzzySearch,
    directories: files.directories,
    getSubagentManager: app.getSubagentManager,
    githubCompletion: app.githubCompletion,
    listResources: mcp.listResources,
    getMcpServers: mcp.getMcpServers,
    getBlockedMcpServers: mcp.getBlockedMcpServers,
    isExtensionEnabled: extensions.isExtensionEnabled,
    getEnablePromptCompletion: app.getEnablePromptCompletion,
    getUtilityModel: app.getUtilityModel,
    getWorkingDir: session.getWorkingDir,
    setTrustedFolderLive: app.setTrustedFolderLive,
    getFolderTrust: app.getFolderTrust,
    describeToolConfiguration,
    getProjectTempDir: session.getProjectTempDir,
    getProjectRoot: session.getProjectRoot,
    getSessionId: session.getSessionId,
    getTargetDir: session.getTargetDir,
    getDebugMode: app.getDebugMode,
    historyFilePath: runtime.historyFilePath,
  };
}

export function buildDialogsRuntime(runtime: {
  app: Pick<
    AppStateRuntime,
    | 'getEphemeralSettings'
    | 'getScreenReader'
    | 'isTrustedFolder'
    | 'setEphemeralSetting'
    | 'setTrustedFolderLive'
  >;
  ephemeral: Pick<EphemeralSettingsRuntime, 'getEphemeralSetting'>;
  model: Pick<ModelState, 'getModel'>;
  session: Pick<SessionIdentity, 'getWorkingDir'>;
  settings: Pick<SettingsTelemetryState, 'subscribeModelSelection'>;
}): AppDialogsRuntime {
  const { session, model, app, settings, ephemeral } = runtime;
  return {
    getWorkingDir: session.getWorkingDir,
    setTrustedFolderLive: app.setTrustedFolderLive,
    isTrustedFolder: app.isTrustedFolder,
    getModel: model.getModel,
    subscribeModelSelection: settings.subscribeModelSelection,
    getEphemeralSetting: ephemeral.getEphemeralSetting,
    getEphemeralSettings: app.getEphemeralSettings,
    setEphemeralSetting: app.setEphemeralSetting,
    getScreenReader: app.getScreenReader,
  };
}
