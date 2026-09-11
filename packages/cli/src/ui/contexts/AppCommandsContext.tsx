/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext, useContext } from 'react';
import type { EditorType } from '@vybestack/llxprt-code-core';
import type { TextBuffer } from '../components/shared/text-buffer.js';
import type { CommandContext } from '../commands/types.js';
import type { FolderTrustChoice } from '../components/FolderTrustDialog.js';
import type { Key } from '../hooks/useKeypress.js';
import type { WelcomeActions } from '../hooks/useWelcomeOnboarding.js';
import type { IdeIntegrationNudgeResult } from '../IdeIntegrationNudge.js';
import type { SettingScope } from '../../config/settings.js';

/**
 * The view-facing command surface, assembled once by the composition root
 * (AppContainerRuntime) from the domain hooks' stable callbacks and exposed
 * through a single provider. Views (Composer, DialogManager, dialog body
 * components) read handlers from here instead of receiving whole hook bags;
 * data reads stay in the stores.
 */
export interface AppCommands {
  // Services projected by the composition root (stable identities)
  buffer: TextBuffer;
  commandContext: CommandContext;
  inputHistory: string[];

  // Composer input commands
  handleUserInputSubmit: (value: string) => void;
  handleSteer: (text: string) => boolean;
  handleClearScreen: () => void;
  vimHandleInput: (key: Key) => boolean;
  sendAllQueuedSubmissions?: () => void;
  steerAllQueuedSubmissions?: () => void;
  /**
   * Clears all queued submissions (Backspace on an empty input, issue #2882).
   * Required in production: the Composer passes it straight to the
   * InputPrompt, and the key handler no-ops when it is absent.
   */
  clearQueuedSubmissions: () => void;

  // Composer mode commands
  setShellModeActive: (active: boolean) => void;
  handleEscapePromptChange: (show: boolean) => void;
  setQueueErrorMessage: (message: string | null) => void;

  // Dialog domain handlers
  onWorkspaceMigrationDialogOpen: () => void;
  handleIdePromptComplete: (result: IdeIntegrationNudgeResult) => void;
  handleFolderTrustSelect: (choice: FolderTrustChoice) => Promise<void>;
  welcomeActions: WelcomeActions;
  triggerWelcomeAuth: (
    provider: string,
    method: 'oauth' | 'api_key',
    apiKey?: string,
  ) => Promise<void>;
  handleThemeSelect: (
    themeName: string | undefined,
    scope: SettingScope,
  ) => void;
  handleThemeHighlight: (themeName: string | undefined) => void;
  handleAuthSelect: (
    method: string | undefined,
    scope: SettingScope,
  ) => Promise<void>;
  handleOAuthCodeDialogClose: () => void;
  handleOAuthCodeSubmit: (code: string) => Promise<void>;
  handleEditorSelect: (
    editorType: EditorType | undefined,
    scope: SettingScope,
  ) => void;
  handleProviderSelect: (provider: string) => Promise<void>;
  handleProfileSelect: (profile: string) => void;
  viewProfileDetail: (profileName: string, openedDirectly?: boolean) => void;
  closeProfileDetailDialog: () => void;
  loadProfileFromDetail: (profileName: string) => void;
  deleteProfileFromDetail: (profileName: string) => void;
  deleteProfileFromList: (profileName: string) => void;
  setProfileAsDefault: (profileName: string) => void;
  openProfileEditor: (profileName: string, openedDirectly?: boolean) => void;
  closeProfileEditor: () => void;
  saveProfileFromEditor: (
    profileName: string,
    updatedProfile: unknown,
  ) => Promise<void>;
  handleToolsSelect: (tool: string) => void;
  handleSettingsRestart: () => void;
}

const AppCommandsContext = createContext<AppCommands | null>(null);

export function AppCommandsProvider({
  value,
  children,
}: {
  value: AppCommands;
  children: React.ReactNode;
}) {
  return (
    <AppCommandsContext.Provider value={value}>
      {children}
    </AppCommandsContext.Provider>
  );
}

export function useAppCommands(): AppCommands {
  const commands = useContext(AppCommandsContext);
  if (commands === null) {
    throw new Error(
      'useAppCommands must be used within an AppCommandsProvider',
    );
  }
  return commands;
}
