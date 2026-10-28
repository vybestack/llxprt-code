/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { WorkspaceCommandRuntime } from '../ui/hooks/workspaceCommandOwners.js';
import type { AppProps } from '../ui/App.js';
import type { ReactNode } from 'react';
import type {
  ApprovalMode,
  IContent,
  RecordingIntegration,
  SessionRecordingService,
} from '@vybestack/llxprt-code-core';
import type {
  BrowserResumeRuntime,
  ChatCommandReads,
  CommandRegistryReads,
  ContainerAppReads,
  ContainerInputReads,
  ContainerMemoryReads,
  ContainerRuntimeReads,
  ContainerSessionReads,
  ContainerTerminalReads,
  FileCommandReads,
  KeyCommandReads,
} from '../ui/cliCommandPorts.js';
import type { StreamPolicyReads } from '../ui/inputOwnerBindings.js';
import type { SlashCommandProcessorPorts } from '../ui/hooks/useSlashCommandProcessorCore.js';
import type { LayoutRuntime } from '../ui/layouts/DefaultAppLayoutHelpers.js';
import type { AppDialogsRuntime } from '../ui/containers/AppContainer/hooks/useAppDialogs.js';
import type { EmojiFilterSettingsSource } from '../ui/utils/iContentToHistoryItems.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { LoadedSettings } from '../config/settings.js';
import type { OperationLifecycleRegistry } from '../ui/hooks/agentStream/operationLifecycle.js';
import type { MemoryTelemetryController } from '../ui/hooks/memoryTrend/memoryTelemetry.js';
import type {
  DetectProviderQuotaOperation,
  FetchOperation,
  GetActiveModelNameOperation,
  GetActiveProviderAliasConfigOperation,
  GetActiveProviderNameOperation,
  GetActiveToolFormatStateOperation,
  GetEphemeralSettingOperation,
  GetEphemeralSettingsOperation,
  ListSavedProfilesOperation,
  ProviderStatusOperation,
  SaveLoadBalancerProfileOperation,
  SetActiveModelOperation,
  SetActiveToolFormatOverrideOperation,
  SetEphemeralSettingOperation,
  UpdateActiveProviderApiKeyOperation,
} from '../ui/contexts/RuntimeContext.js';
import type { ProviderAliasRefresh } from '../ui/contexts/ProviderAliasRefreshContext.js';
import type { OAuthControl } from '../ui/contexts/OAuthControlContext.js';
import type { AppContainerProps } from '../ui/AppContainer.js';

export interface InteractiveApplicationInputs
  extends Pick<
    Agent,
    | 'addHistory'
    | 'getHistory'
    | 'stream'
    | 'injectSteer'
    | 'getProviderContextLimit'
    | 'dispose'
    | 'getApprovalMode'
    | 'setApprovalMode'
    | 'generate'
    | 'getModel'
    | 'getProvider'
    | 'getCurrentSequenceModel'
    | 'getActiveProfileName'
    | 'getEphemeralSetting'
    | 'setEphemeralSetting'
    | 'addDirectoryContext'
    | 'compress'
    | 'setProvider'
    | 'saveProfileSnapshot'
    | 'deleteProfileByName'
    | 'setDefaultProfileName'
    | 'listProviders'
  > {
  containerApp: ContainerAppReads;
  containerSession: ContainerSessionReads;
  containerTerminal: ContainerTerminalReads;
  containerMemory: ContainerMemoryReads;
  containerInput: ContainerInputReads;
  inputPolicy: StreamPolicyReads;
  commandRegistry: CommandRegistryReads;
  fileCommands: FileCommandReads;
  workspaceCommands: WorkspaceCommandRuntime;
  chatCommands: ChatCommandReads;
  keyCommands: KeyCommandReads;
  approval: { getApprovalMode(): ApprovalMode };
  browserSession: BrowserResumeRuntime;
  emojiFilter: EmojiFilterSettingsSource;
  containerRuntime: ContainerRuntimeReads;
  slashCommandPorts: SlashCommandProcessorPorts;
  layoutRuntime: LayoutRuntime;
  dialogsRuntime: AppDialogsRuntime;
  session: Pick<
    Agent['session'],
    | 'flushRecording'
    | 'attachRecordingHistory'
    | 'deleteSession'
    | 'subscribeHistoryTokens'
    | 'connectRecordingHistory'
    | 'getRecording'
    | 'resume'
    | 'listBrowserTargetsDetailed'
    | 'importSession'
    | 'getHistory'
    | 'replaceHistory'
    | 'recordRecordingEvent'
    | 'startNewSession'
    | 'readInitializedHistory'
    | 'listCheckpoints'
    | 'createCheckpoint'
    | 'deleteCheckpoint'
    | 'renameCheckpoint'
    | 'clearHistory'
    | 'restoreTurns'
    | 'nameCurrentSession'
    | 'exportSession'
    | 'listBrowserTargets'
    | 'readHistorySnapshot'
    | 'isHistoryInitialized'
  >;
  providerReads: Pick<
    Agent['providerReads'],
    'getActiveProviderMetrics' | 'getSessionTokenUsage'
  >;
  policy: Pick<
    Agent['policy'],
    'reloadUserRules' | 'getRules' | 'getDefaultDecision' | 'isNonInteractive'
  >;
  ide: Pick<
    Agent['ide'],
    | 'getIdeMode'
    | 'readConnection'
    | 'readContext'
    | 'subscribeContext'
    | 'readWorkspaceTrust'
    | 'subscribeWorkspaceTrust'
    | 'subscribeConnection'
    | 'resolveDiff'
    | 'setIdeMode'
    | 'setIdeClientConnected'
    | 'setIdeClientDisconnected'
  >;
  hooks: Pick<
    Agent['hooks'],
    | 'triggerSessionEnd'
    | 'triggerSessionStart'
    | 'subscribeExecutionPhase'
    | 'listHooks'
    | 'enable'
    | 'disable'
    | 'setDisabledHooks'
  >;
  auth: Pick<
    Agent['auth'],
    | 'subscribeBucketConsent'
    | 'respondToBucketConsent'
    | 'setBaseUrl'
    | 'status'
    | 'logout'
  >;
  sessionClient: Pick<
    Agent['sessionClient'],
    'publishTools' | 'runImageOperation'
  >;
  profiles: Pick<Agent['profiles'], 'load'>;
  workspace: Pick<
    Agent['workspace'],
    'subagentDefinitions' | 'subagentWrites' | 'profileDefinitions'
  >;
  tools: AppProps['tools'] & Pick<Agent['tools'], 'list'>;
  mcp: AppProps['mcp'] &
    Pick<
      Agent['mcp'],
      | 'discoveryState'
      | 'refresh'
      | 'listServers'
      | 'listBlockedServers'
      | 'details'
      | 'authenticate'
      | 'reload'
      | 'subscribeStatus'
    >;
  tasks: AppProps['tasks'] &
    Pick<Agent['tasks'], 'list' | 'listRunning' | 'get' | 'cancel'>;
  metrics: AppProps['metrics'];
  renderRuntime: (children: ReactNode) => ReactNode;
  detectProviderQuota: DetectProviderQuotaOperation;
  fetch: FetchOperation;
  getActiveModelName: GetActiveModelNameOperation;
  getActiveProviderAliasConfig: GetActiveProviderAliasConfigOperation;
  getActiveProviderName: GetActiveProviderNameOperation;
  getActiveToolFormatState: GetActiveToolFormatStateOperation;
  getEphemeralSetting: GetEphemeralSettingOperation;
  getEphemeralSettings: GetEphemeralSettingsOperation;
  listSavedProfiles: ListSavedProfilesOperation;
  providerStatus: ProviderStatusOperation;
  saveLoadBalancerProfile: SaveLoadBalancerProfileOperation;
  setActiveModel: SetActiveModelOperation;
  setActiveToolFormatOverride: SetActiveToolFormatOverrideOperation;
  setEphemeralSetting: SetEphemeralSettingOperation;
  updateActiveProviderApiKey: UpdateActiveProviderApiKeyOperation;
  providerAliasRefresh: ProviderAliasRefresh;
  oauthControl: OAuthControl;
  settings: LoadedSettings;
  startupWarnings?: string[];
  resumedHistory?: IContent[];
  version: string;
  terminalBackgroundColor?: string;
  /** @plan:PLAN-20260211-SESSIONRECORDING.P26 */
  recordingIntegration?: RecordingIntegration;
  recordingOwner?: 'agent' | 'raw';
  /** @plan:PLAN-20260214-SESSIONBROWSER.P23 */
  initialRecordingService?: SessionRecordingService;
  /** @plan:PLAN-20260214-SESSIONBROWSER.P23 */
  initialLockHandle?: AppContainerProps['initialLockHandle'];
  suppressStartupWelcome?: boolean;
  /** P12: optional perf operation lifecycle registry (perf enabled only). */
  operationLifecycle?: OperationLifecycleRegistry;
  /** P12: optional memory telemetry controller (perf+memory enabled only). */
  memoryController?: MemoryTelemetryController;
}
