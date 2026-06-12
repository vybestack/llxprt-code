/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';

interface UseInitialPromptSubmitParams {
  initialPrompt: string | undefined;
  submitQuery: (query: string) => Promise<void>;
  agentClientPresent: boolean;
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
  isMcpReady: boolean;
}

export function useInitialPromptSubmit({
  initialPrompt,
  submitQuery,
  agentClientPresent,
  blockedByDialogs,
  startupGuardsInitialized,
  isMcpReady,
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

    if (!startupGuardsInitialized) {
      return;
    }

    if (!isMcpReady && !initialPrompt.trimStart().startsWith('/')) {
      return;
    }

    initialPromptSubmittedRef.current = 'pending';
    void submitQuery(initialPrompt).then(
      () => {
        initialPromptSubmittedRef.current = 'done';
      },
      () => {
        initialPromptSubmittedRef.current = 'idle';
      },
    );
  }, [
    initialPrompt,
    submitQuery,
    agentClientPresent,
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
    isMcpReady,
  ]);
}
