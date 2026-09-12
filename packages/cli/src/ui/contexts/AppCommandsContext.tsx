/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext, useContext, useMemo, useRef } from 'react';
import { createStableAppCommands } from './stableAppCommands.js';
import type { EditorType } from '@vybestack/llxprt-code-core';
import type { TextBuffer } from '../components/shared/text-buffer.js';
import type { CommandContext } from '../commands/types.js';
import type { FolderTrustChoice } from '../components/FolderTrustDialog.js';
import type { Key } from '../hooks/useKeypress.js';
import type { WelcomeActions } from '../hooks/useWelcomeOnboarding.js';
import type { IdeIntegrationNudgeResult } from '../IdeIntegrationNudge.js';
import type { SettingScope } from '../../config/settings.js';

/**
 * Changing input snapshots use a separate context from stable view commands.
 * This data boundary updates input consumers without invalidating consumers
 * that only dispatch commands.
 */
export interface AppCommandData {
  buffer: TextBuffer;
  commandContext: CommandContext;
  inputHistory: string[];
}

export interface AppCommandBindings extends AppCommands, AppCommandData {}

export interface AppCommands {
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

const AppCommandDataContext = createContext<AppCommandData | null>(null);

const AppCommandsContext = createContext<AppCommands | null>(null);

export function AppCommandsProvider({
  value,
  children,
}: {
  value: AppCommandBindings;
  children: React.ReactNode;
}) {
  const latest = useRef(value);
  latest.current = value;
  const canSendQueued = value.sendAllQueuedSubmissions !== undefined;
  const canSteerQueued = value.steerAllQueuedSubmissions !== undefined;
  const commands = useMemo(
    () => createStableAppCommands(latest, { canSendQueued, canSteerQueued }),
    [latest, canSendQueued, canSteerQueued],
  );
  const { buffer, commandContext, inputHistory } = value;
  const data = useMemo(
    () => ({ buffer, commandContext, inputHistory }),
    [buffer, commandContext, inputHistory],
  );
  return (
    <AppCommandsContext.Provider value={commands}>
      <AppCommandDataContext.Provider value={data}>
        {children}
      </AppCommandDataContext.Provider>
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

/** Reads changing input snapshots without subscribing command-only consumers. */
export function useAppCommandData(): AppCommandData {
  const data = useContext(AppCommandDataContext);
  if (data === null) {
    throw new Error(
      'useAppCommandData must be used within an AppCommandsProvider',
    );
  }
  return data;
}
