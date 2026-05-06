/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

import { Box, Text } from 'ink';
import { useCallback, useMemo } from 'react';
import { IdeIntegrationNudge } from '../IdeIntegrationNudge.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import type {
  HydratedModel,
  Config,
  Profile,
  SessionSummary,
} from '@vybestack/llxprt-code-core';
import { getProjectHash, DebugLogger } from '@vybestack/llxprt-code-core';
import { join } from 'node:path';
import {
  performResume,
  type PerformResumeResult,
  type ResumeContext,
} from '../../services/performResume.js';
import { iContentToHistoryItems } from '../utils/iContentToHistoryItems.js';
// import { LoopDetectionConfirmation } from './LoopDetectionConfirmation.js'; // NOTE: Not yet ported from upstream
import { FolderTrustDialog } from './FolderTrustDialog.js';
import { WelcomeDialog } from './WelcomeOnboarding/WelcomeDialog.js';

import { ConsentPrompt } from './ConsentPrompt.js';
import { ThemeDialog } from './ThemeDialog.js';
import { SettingsDialog } from './SettingsDialog.js';
import { AuthDialog } from './AuthDialog.js';
import { OAuthCodeDialog } from './OAuthCodeDialog.js';
import { EditorSettingsDialog } from './EditorSettingsDialog.js';
import { ProviderDialog } from './ProviderDialog.js';
import { LoadProfileDialog } from './LoadProfileDialog.js';
import { ProfileCreateWizard } from './ProfileCreateWizard/index.js';
import { ProfileListDialog } from './ProfileListDialog.js';
import { ProfileDetailDialog } from './ProfileDetailDialog.js';
import { ProfileInlineEditor } from './ProfileInlineEditor.js';
import { ToolsDialog } from './ToolsDialog.js';
import { PrivacyNotice } from '../privacy/PrivacyNotice.js';
import { WorkspaceMigrationDialog } from './WorkspaceMigrationDialog.js';
import { PermissionsModifyTrustDialog } from './PermissionsModifyTrustDialog.js';
import { LoggingDialog } from './LoggingDialog.js';
import { SubagentManagerDialog } from './SubagentManagement/index.js';
import { SubagentView } from './SubagentManagement/types.js';
import { ModelsDialog } from './ModelDialog.js';
/**
 * @plan PLAN-20260214-SESSIONBROWSER.P21
 */
import { SessionBrowserDialog } from './SessionBrowserDialog.js';
import { theme } from '../semantic-colors.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { useUIActions } from '../contexts/UIActionsContext.js';
import type { LoadedSettings } from '../../config/settings.js';
import { type UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
// import { IdeTrustChangeDialog } from './IdeTrustChangeDialog.js'; // NOTE: Not yet ported from upstream

interface DialogManagerProps {
  addItem: UseHistoryManagerReturn['addItem'];
  terminalWidth: number;
  config: Config;
  settings: LoadedSettings;
}

const dialogManagerLogger = new DebugLogger('llxprt:ui:dialogmanager');

function useModelDialogHandler(
  runtime: ReturnType<typeof useRuntimeApi>,
  addItem: UseHistoryManagerReturn['addItem'],
  uiActions: ReturnType<typeof useUIActions>,
  currentProvider: string | null,
  commandContext: {
    recordingIntegration?: {
      recordProviderSwitch: (provider: string, model: string) => void;
    };
  },
) {
  return useCallback(
    (model: HydratedModel) => {
      void (async () => {
        try {
          const selectedProvider = model.provider;
          if (selectedProvider !== currentProvider) {
            const switchResult = await runtime.switchActiveProvider(
              selectedProvider,
              { addItem },
            );
            const messages: string[] = [];
            messages.push(
              currentProvider
                ? `Switched from ${currentProvider} to ${switchResult.nextProvider}`
                : `Switched to ${switchResult.nextProvider}`,
            );
            const baseUrlMsg = switchResult.infoMessages.find(
              (m) => m.includes('Base URL') || m.includes('base URL'),
            );
            if (baseUrlMsg) messages.push(baseUrlMsg);
            await runtime.setActiveModel(model.id);
            messages.push(
              `Active model is '${model.id}' for provider '${selectedProvider}'.`,
            );
            if (selectedProvider !== 'gemini') {
              messages.push('Use /key to set API key if needed.');
            }
            for (const msg of messages) {
              addItem({ type: 'info', text: msg });
            }
            commandContext.recordingIntegration?.recordProviderSwitch(
              selectedProvider,
              model.id,
            );
          } else {
            const result = await runtime.setActiveModel(model.id);
            addItem(
              {
                type: 'info',
                text: `Active model is '${result.nextModel}' for provider '${result.providerName}'.`,
              },
              Date.now(),
            );
            commandContext.recordingIntegration?.recordProviderSwitch(
              result.providerName,
              result.nextModel,
            );
          }
        } catch (e) {
          const status = runtime.getActiveProviderStatus();
          addItem(
            {
              type: 'error',
              text: `Failed to switch model for provider '${status.providerName ?? 'unknown'}': ${e instanceof Error ? e.message : String(e)}`,
            },
            Date.now(),
          );
        }
        uiActions.closeModelsDialog();
      })();
    },
    [runtime, addItem, uiActions, currentProvider, commandContext],
  );
}

/**
 * Handler for SessionBrowserDialog selection - performs real session resume.
 * @plan PLAN-20260214-SESSIONBROWSER.P23
 * @requirement REQ-PR-001, REQ-PR-002
 */
function useSessionBrowserHandler(
  config: Config,
  commandContext: {
    ui: {
      clear: () => void;
      addItem: UseHistoryManagerReturn['addItem'];
      pendingItem: unknown;
    };
    recordingSwapCallbacks?: unknown;
  },
  addItem: UseHistoryManagerReturn['addItem'],
  uiActions: ReturnType<typeof useUIActions>,
) {
  return useCallback(
    async (session: SessionSummary): Promise<PerformResumeResult> => {
      const recordingSwapCallbacks = commandContext.recordingSwapCallbacks;
      if (recordingSwapCallbacks == null) {
        dialogManagerLogger.warn(
          'Cannot resume session: recording infrastructure not available.',
        );
        return {
          ok: false,
          error: 'Recording infrastructure not available.',
        };
      }
      const chatsDir = join(config.getProjectTempDir(), 'chats');
      const projectHash = getProjectHash(config.getProjectRoot());
      const currentSessionId = config.getSessionId();
      const currentProvider = config.getProvider() ?? 'unknown';
      const currentModel = config.getModel();
      const workspaceDirs = [...config.getWorkspaceContext().getDirectories()];
      const resumeContext: ResumeContext = {
        chatsDir,
        projectHash,
        currentSessionId,
        currentProvider,
        currentModel,
        workspaceDirs,
        recordingCallbacks: recordingSwapCallbacks as NonNullable<
          ResumeContext['recordingCallbacks']
        >,
        logger: dialogManagerLogger,
      };
      const resumeResult = await performResume(
        session.sessionId,
        resumeContext,
      );
      if (!resumeResult.ok) {
        addItem({ type: 'error', text: resumeResult.error });
        return resumeResult;
      }
      for (const warning of resumeResult.warnings) {
        addItem({ type: 'info', text: `Warning: ${warning}` });
      }
      await config.getGeminiClient().restoreHistory(resumeResult.history);
      const uiHistory = iContentToHistoryItems(resumeResult.history);
      commandContext.ui.clear();
      uiHistory.forEach((item, index) => {
        commandContext.ui.addItem(item, index);
      });
      uiActions.closeSessionBrowserDialog();
      return resumeResult;
    },
    [config, commandContext, addItem, uiActions],
  );
}

function renderEarlyDialogs(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
  terminalWidth: number,
) {
  if (uiState.showWorkspaceMigrationDialog) {
    return (
      <WorkspaceMigrationDialog
        workspaceExtensions={uiState.workspaceGeminiCLIExtensions}
        onOpen={uiActions.onWorkspaceMigrationDialogOpen}
        onClose={uiActions.onWorkspaceMigrationDialogClose}
      />
    );
  }
  if (uiState.shouldShowIdePrompt) {
    return (
      <IdeIntegrationNudge
        ide={uiState.currentIDE!}
        onComplete={uiActions.handleIdePromptComplete}
      />
    );
  }
  if (uiState.isFolderTrustDialogOpen) {
    return (
      <FolderTrustDialog
        onSelect={uiActions.handleFolderTrustSelect}
        isRestarting={uiState.isRestarting}
      />
    );
  }
  if (uiState.isWelcomeDialogOpen) {
    return (
      <WelcomeDialog
        state={uiState.welcomeState}
        actions={uiActions.welcomeActions}
        availableProviders={uiState.welcomeAvailableProviders}
        availableModels={uiState.welcomeAvailableModels}
        triggerAuth={uiActions.triggerWelcomeAuth}
      />
    );
  }
  if (uiState.confirmationRequest) {
    return (
      <ConsentPrompt
        prompt={uiState.confirmationRequest.prompt}
        onConfirm={uiState.confirmationRequest.onConfirm}
        terminalWidth={terminalWidth}
      />
    );
  }
  if (uiState.confirmUpdateGeminiCLIExtensionRequests.length > 0) {
    const request = uiState.confirmUpdateGeminiCLIExtensionRequests[0];
    return (
      <ConsentPrompt
        prompt={request.prompt}
        onConfirm={request.onConfirm}
        terminalWidth={terminalWidth}
      />
    );
  }
  return null;
}

function renderThemeDialog(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
  settings: LoadedSettings,
  constrainHeight: boolean,
  terminalHeight: number,
  staticExtraHeight: number,
  mainAreaWidth: number,
) {
  return (
    <Box flexDirection="column">
      {uiState.themeError && (
        <Box marginBottom={1}>
          <Text color={theme.status.error}>{uiState.themeError}</Text>
        </Box>
      )}
      <ThemeDialog
        onSelect={uiActions.handleThemeSelect}
        onHighlight={uiActions.handleThemeHighlight}
        settings={settings}
        availableTerminalHeight={
          constrainHeight ? terminalHeight - staticExtraHeight : undefined
        }
        terminalWidth={mainAreaWidth}
      />
    </Box>
  );
}

function renderAuthDialog(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
  settings: LoadedSettings,
) {
  return (
    <Box flexDirection="column">
      <AuthDialog
        onSelect={(method, scope) => {
          void uiActions.handleAuthSelect(method, scope);
        }}
        settings={settings}
        initialErrorMessage={uiState.authError}
      />
    </Box>
  );
}

function renderOAuthCodeDialog(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
) {
  const provider =
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string provider should fall back to 'unknown'
    (global as unknown as { __oauth_provider?: string }).__oauth_provider ||
    'unknown';
  return (
    <OAuthCodeDialog
      provider={provider}
      onClose={uiActions.handleOAuthCodeDialogClose}
      onSubmit={(code) => {
        void uiActions.handleOAuthCodeSubmit(code);
      }}
    />
  );
}

function renderEditorDialog(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
  settings: LoadedSettings,
) {
  return (
    <Box flexDirection="column">
      {uiState.editorError && (
        <Box marginBottom={1}>
          <Text color={theme.status.error}>{uiState.editorError}</Text>
        </Box>
      )}
      <EditorSettingsDialog
        onSelect={uiActions.handleEditorSelect}
        settings={settings}
        onExit={uiActions.exitEditorDialog}
      />
    </Box>
  );
}

function renderProviderDialog(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
) {
  return (
    <Box flexDirection="column">
      <ProviderDialog
        providers={uiState.providerOptions}
        currentProvider={uiState.selectedProvider}
        onSelect={(provider) => {
          void uiActions.handleProviderSelect(provider);
        }}
        onClose={uiActions.exitProviderDialog}
      />
    </Box>
  );
}

function renderLoadProfileDialog(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
) {
  return (
    <Box flexDirection="column">
      <LoadProfileDialog
        profiles={uiState.profiles}
        onSelect={uiActions.handleProfileSelect}
        onClose={uiActions.exitLoadProfileDialog}
      />
    </Box>
  );
}

function renderCreateProfileDialog(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
) {
  return (
    <Box flexDirection="column">
      <ProfileCreateWizard
        onClose={uiActions.exitCreateProfileDialog}
        onLoadProfile={uiActions.handleProfileSelect}
        availableProviders={uiState.providerOptions}
      />
    </Box>
  );
}

function renderProfileListDialogView(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
) {
  return (
    <Box flexDirection="column">
      <ProfileListDialog
        profiles={uiState.profileListItems}
        onSelect={uiActions.loadProfileFromDetail}
        onClose={uiActions.closeProfileListDialog}
        onViewDetail={uiActions.viewProfileDetail}
        isLoading={uiState.profileDialogLoading}
        defaultProfileName={uiState.defaultProfileName ?? undefined}
        activeProfileName={uiState.activeProfileName ?? undefined}
      />
    </Box>
  );
}

function renderProfileDetailDialogView(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
) {
  return (
    <Box flexDirection="column">
      <ProfileDetailDialog
        profileName={uiState.selectedProfileName ?? ''}
        profile={uiState.selectedProfileData as Profile | null}
        onClose={uiActions.closeProfileDetailDialog}
        onLoad={uiActions.loadProfileFromDetail}
        onDelete={uiActions.deleteProfileFromDetail}
        onSetDefault={uiActions.setProfileAsDefault}
        onEdit={uiActions.openProfileEditor}
        isLoading={uiState.profileDialogLoading}
        isDefault={uiState.selectedProfileName === uiState.defaultProfileName}
        isActive={uiState.selectedProfileName === uiState.activeProfileName}
        error={uiState.profileDialogError ?? undefined}
      />
    </Box>
  );
}

function renderProfileEditorDialogView(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
) {
  return (
    <Box flexDirection="column">
      <ProfileInlineEditor
        profileName={uiState.selectedProfileName ?? ''}
        profile={uiState.selectedProfileData as Profile}
        onSave={
          uiActions.saveProfileFromEditor as (
            name: string,
            profile: Profile,
          ) => void
        }
        onCancel={uiActions.closeProfileEditor}
        error={uiState.profileDialogError ?? undefined}
      />
    </Box>
  );
}

function renderProfileDialogs(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
) {
  if (uiState.isLoadProfileDialogOpen) {
    return renderLoadProfileDialog(uiState, uiActions);
  }
  if (uiState.isCreateProfileDialogOpen) {
    return renderCreateProfileDialog(uiState, uiActions);
  }
  if (uiState.isProfileListDialogOpen) {
    return renderProfileListDialogView(uiState, uiActions);
  }
  if (uiState.isProfileDetailDialogOpen) {
    return renderProfileDetailDialogView(uiState, uiActions);
  }
  if (
    uiState.isProfileEditorDialogOpen &&
    uiState.selectedProfileData != null
  ) {
    return renderProfileEditorDialogView(uiState, uiActions);
  }
  return null;
}

function renderToolsDialog(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
) {
  return (
    <Box flexDirection="column">
      <ToolsDialog
        tools={uiState.toolsDialogTools}
        action={uiState.toolsDialogAction}
        disabledTools={uiState.toolsDialogDisabledTools}
        onSelect={uiActions.handleToolsSelect}
        onClose={uiActions.exitToolsDialog}
      />
    </Box>
  );
}

function renderLoggingDialog(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
) {
  return (
    <LoggingDialog
      entries={
        uiState.loggingDialogData.entries as Array<{
          timestamp: string;
          type: 'request' | 'response' | 'tool_call';
          provider: string;
          model?: string;
          conversationId?: string;
          messages?: Array<{ role: string; content: string }>;
          response?: string;
          tokens?: { input?: number; output?: number };
          error?: string;
          tool?: string;
          duration?: number;
          success?: boolean;
          gitStats?: {
            linesAdded: number;
            linesRemoved: number;
            filesChanged: number;
          };
        }>
      }
      onClose={uiActions.closeLoggingDialog}
    />
  );
}

function renderModelsDialog(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
  handleModelsDialogSelect: (model: HydratedModel) => void,
  currentProvider: string | null,
) {
  return (
    <Box flexDirection="column">
      <ModelsDialog
        onSelect={handleModelsDialogSelect}
        onClose={uiActions.closeModelsDialog}
        initialSearch={uiState.modelsDialogData?.initialSearch}
        initialFilters={uiState.modelsDialogData?.initialFilters}
        includeDeprecated={uiState.modelsDialogData?.includeDeprecated}
        currentProvider={currentProvider}
        initialProviderFilter={uiState.modelsDialogData?.providerOverride}
        showAllProviders={uiState.modelsDialogData?.showAllProviders}
      />
    </Box>
  );
}

/**
 * @plan PLAN-20260214-SESSIONBROWSER.P21
 * @plan PLAN-20260214-SESSIONBROWSER.P23
 */
function renderSessionBrowserDialog(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
  config: Config,
  commandContext: { ui: { pendingItem: unknown } },
  handleSessionBrowserSelect: (
    session: SessionSummary,
  ) => Promise<PerformResumeResult>,
) {
  const chatsDir = join(config.getProjectTempDir(), 'chats');
  const projectHash = getProjectHash(config.getProjectRoot());
  const currentSessionId = config.getSessionId();
  const hasActiveConversation = commandContext.ui.pendingItem !== null;
  return (
    <Box flexDirection="column">
      <SessionBrowserDialog
        chatsDir={chatsDir}
        projectHash={projectHash}
        currentSessionId={currentSessionId}
        hasActiveConversation={hasActiveConversation}
        onSelect={handleSessionBrowserSelect}
        onClose={uiActions.closeSessionBrowserDialog}
      />
    </Box>
  );
}

function useDialogManagerState(
  addItem: UseHistoryManagerReturn['addItem'],
  config: Config,
  settings: LoadedSettings,
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
  runtime: ReturnType<typeof useRuntimeApi>,
  _terminalWidth: number,
) {
  const { constrainHeight, terminalHeight, mainAreaWidth, commandContext } =
    uiState;
  const staticExtraHeight = 0;

  const currentProvider = useMemo(() => {
    try {
      return runtime.getActiveProviderName() || null;
    } catch {
      return null;
    }
  }, [runtime]);

  const handlePrivacyNoticeExit = useCallback(() => {
    uiActions.handlePrivacyNoticeExit();
  }, [uiActions]);

  const handleModelsDialogSelect = useModelDialogHandler(
    runtime,
    addItem,
    uiActions,
    currentProvider,
    commandContext,
  );

  const handleSessionBrowserSelect = useSessionBrowserHandler(
    config,
    commandContext,
    addItem,
    uiActions,
  );

  return {
    constrainHeight,
    terminalHeight,
    mainAreaWidth,
    commandContext,
    staticExtraHeight,
    currentProvider,
    handlePrivacyNoticeExit,
    handleModelsDialogSelect,
    handleSessionBrowserSelect,
  };
}

function renderDialogBodyFirstHalf(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
  settings: LoadedSettings,
  config: Config,
  state: ReturnType<typeof useDialogManagerState>,
) {
  if (uiState.isThemeDialogOpen) {
    return renderThemeDialog(
      uiState,
      uiActions,
      settings,
      state.constrainHeight,
      state.terminalHeight,
      state.staticExtraHeight,
      state.mainAreaWidth,
    );
  }
  if (uiState.isSettingsDialogOpen) {
    return (
      <Box flexDirection="column">
        <SettingsDialog
          settings={settings}
          onSelect={uiActions.closeSettingsDialog}
          onRestartRequest={uiActions.handleSettingsRestart}
          config={config}
        />
      </Box>
    );
  }
  if (uiState.isAuthDialogOpen) {
    return renderAuthDialog(uiState, uiActions, settings);
  }
  if (uiState.isOAuthCodeDialogOpen) {
    return renderOAuthCodeDialog(uiState, uiActions);
  }
  if (uiState.isEditorDialogOpen) {
    return renderEditorDialog(uiState, uiActions, settings);
  }
  if (uiState.isProviderDialogOpen) {
    return renderProviderDialog(uiState, uiActions);
  }
  return undefined;
}

function renderDialogBodySecondHalf(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
  config: Config,
  addItem: UseHistoryManagerReturn['addItem'],
  state: ReturnType<typeof useDialogManagerState>,
) {
  if (uiState.isToolsDialogOpen) {
    return renderToolsDialog(uiState, uiActions);
  }
  if (uiState.showPrivacyNotice) {
    return (
      <PrivacyNotice onExit={state.handlePrivacyNoticeExit} config={config} />
    );
  }
  if (uiState.isPermissionsDialogOpen) {
    return (
      <PermissionsModifyTrustDialog
        onExit={uiActions.closePermissionsDialog}
        addItem={addItem}
      />
    );
  }
  if (uiState.isLoggingDialogOpen) {
    return renderLoggingDialog(uiState, uiActions);
  }
  if (uiState.isSubagentDialogOpen) {
    return (
      <SubagentManagerDialog
        onClose={uiActions.closeSubagentDialog}
        initialView={uiState.subagentDialogInitialView ?? SubagentView.MENU}
        initialSubagentName={uiState.subagentDialogInitialName}
      />
    );
  }
  if (uiState.isModelsDialogOpen) {
    return renderModelsDialog(
      uiState,
      uiActions,
      state.handleModelsDialogSelect,
      state.currentProvider,
    );
  }
  if (uiState.isSessionBrowserDialogOpen) {
    return renderSessionBrowserDialog(
      uiState,
      uiActions,
      config,
      state.commandContext,
      state.handleSessionBrowserSelect,
    );
  }
  return null;
}

function renderDialogBody(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
  settings: LoadedSettings,
  config: Config,
  addItem: UseHistoryManagerReturn['addItem'],
  state: ReturnType<typeof useDialogManagerState>,
) {
  const firstHalf = renderDialogBodyFirstHalf(
    uiState,
    uiActions,
    settings,
    config,
    state,
  );
  if (firstHalf !== undefined) return firstHalf;

  const profileDialog = renderProfileDialogs(uiState, uiActions);
  if (profileDialog) return profileDialog;

  return renderDialogBodySecondHalf(uiState, uiActions, config, addItem, state);
}

// Props for DialogManager
export const DialogManager = ({
  addItem,
  terminalWidth,
  config,
  settings,
}: DialogManagerProps) => {
  const uiState = useUIState();
  const uiActions = useUIActions();
  const runtime = useRuntimeApi();

  const state = useDialogManagerState(
    addItem,
    config,
    settings,
    uiState,
    uiActions,
    runtime,
    terminalWidth,
  );

  // NOTE: IdeTrustChangeDialog not yet ported from upstream
  const earlyDialog = renderEarlyDialogs(uiState, uiActions, terminalWidth);
  if (earlyDialog) return earlyDialog;

  return renderDialogBody(uiState, uiActions, settings, config, addItem, state);
};
