/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { isSlashCommand } from '../../../utils/commandUtils.js';

interface UseInitialPromptSubmitParams {
  initialPrompt: string | undefined;
  submitPrompt: (query: string) => void | Promise<void>;
  agentClientPresent: boolean;
  interactiveRuntimeReady: boolean;
  blockedByDialogs: {
    isAuthDialogOpen: boolean;
    isThemeDialogOpen: boolean;
    isEditorDialogOpen: boolean;
    isProviderDialogOpen: boolean;
    isToolsDialogOpen: boolean;
    isCreateProfileDialogOpen: boolean;
    showPrivacyNotice: boolean;
    isWelcomeDialogOpen: boolean;
    isFolderTrustDialogOpen: boolean;
  };
  startupGuardsInitialized: boolean;
}

export function useInitialPromptSubmit({
  initialPrompt,
  submitPrompt,
  agentClientPresent,
  interactiveRuntimeReady,
  blockedByDialogs,
  startupGuardsInitialized,
}: UseInitialPromptSubmitParams): void {
  const initialPromptSubmittedRef = useRef<'idle' | 'pending' | 'done'>('idle');

  useEffect(() => {
    if (!initialPrompt || initialPromptSubmittedRef.current !== 'idle') {
      return;
    }

    const isDialogOpen =
      blockedByDialogs.isAuthDialogOpen ||
      blockedByDialogs.isThemeDialogOpen ||
      blockedByDialogs.isEditorDialogOpen;
    const isConfigDialogOpen =
      blockedByDialogs.isProviderDialogOpen ||
      blockedByDialogs.isToolsDialogOpen ||
      blockedByDialogs.isCreateProfileDialogOpen;
    const isSpecialDialogOpen =
      blockedByDialogs.showPrivacyNotice ||
      blockedByDialogs.isWelcomeDialogOpen ||
      blockedByDialogs.isFolderTrustDialogOpen;

    if (
      isDialogOpen ||
      isConfigDialogOpen ||
      isSpecialDialogOpen ||
      !agentClientPresent
    ) {
      return;
    }

    const trimmedPrompt = initialPrompt.trim();
    const isCommand = isSlashCommand(trimmedPrompt);
    if (!startupGuardsInitialized || (!interactiveRuntimeReady && !isCommand)) {
      return;
    }

    initialPromptSubmittedRef.current = 'pending';
    try {
      void Promise.resolve(submitPrompt(initialPrompt)).then(
        () => {
          initialPromptSubmittedRef.current = 'done';
        },
        () => {
          initialPromptSubmittedRef.current = 'idle';
        },
      );
    } catch {
      initialPromptSubmittedRef.current = 'idle';
    }
  }, [
    initialPrompt,
    submitPrompt,
    agentClientPresent,
    interactiveRuntimeReady,
    blockedByDialogs.isAuthDialogOpen,
    blockedByDialogs.isThemeDialogOpen,
    blockedByDialogs.isEditorDialogOpen,
    blockedByDialogs.isProviderDialogOpen,
    blockedByDialogs.isToolsDialogOpen,
    blockedByDialogs.isCreateProfileDialogOpen,
    blockedByDialogs.showPrivacyNotice,
    blockedByDialogs.isWelcomeDialogOpen,
    blockedByDialogs.isFolderTrustDialogOpen,
    startupGuardsInitialized,
  ]);
}
