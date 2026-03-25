/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';

interface UseInitialPromptSubmitParams {
  initialPrompt: string | undefined;
  submitQuery: (query: string) => Promise<void>;
  geminiClientPresent: boolean;
  blockedByDialogs: {
    isAuthDialogOpen: boolean;
    isThemeDialogOpen: boolean;
    isEditorDialogOpen: boolean;
    isProviderDialogOpen: boolean;
    isToolsDialogOpen: boolean;
    isCreateProfileDialogOpen: boolean;
    showPrivacyNotice: boolean;
    isWelcomeDialogOpen: boolean;
  };
}

export function useInitialPromptSubmit({
  initialPrompt,
  submitQuery,
  geminiClientPresent,
  blockedByDialogs,
}: UseInitialPromptSubmitParams): void {
  const initialPromptSubmittedRef = useRef(false);

  useEffect(() => {
    if (!initialPrompt || initialPromptSubmittedRef.current) {
      return;
    }

    if (
      blockedByDialogs.isAuthDialogOpen ||
      blockedByDialogs.isThemeDialogOpen ||
      blockedByDialogs.isEditorDialogOpen ||
      blockedByDialogs.isProviderDialogOpen ||
      blockedByDialogs.isToolsDialogOpen ||
      blockedByDialogs.isCreateProfileDialogOpen ||
      blockedByDialogs.showPrivacyNotice ||
      blockedByDialogs.isWelcomeDialogOpen ||
      !geminiClientPresent
    ) {
      return;
    }

    void submitQuery(initialPrompt);
    initialPromptSubmittedRef.current = true;
  }, [
    initialPrompt,
    submitQuery,
    geminiClientPresent,
    blockedByDialogs.isAuthDialogOpen,
    blockedByDialogs.isThemeDialogOpen,
    blockedByDialogs.isEditorDialogOpen,
    blockedByDialogs.isProviderDialogOpen,
    blockedByDialogs.isToolsDialogOpen,
    blockedByDialogs.isCreateProfileDialogOpen,
    blockedByDialogs.showPrivacyNotice,
    blockedByDialogs.isWelcomeDialogOpen,
  ]);
}
