/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { isSlashCommand } from '../../../utils/commandUtils.js';
import type { DialogStore } from '../../../stores/dialog/dialogStore.js';
import { useStoreSelector } from '../../../stores/useStoreSelector.js';

/** Dialog kinds whose presence defers the initial prompt submission. */
const BLOCKING_DIALOG_KINDS = [
  'auth',
  'theme',
  'editor',
  'provider',
  'tools',
  'createProfile',
] as const;

interface UseInitialPromptSubmitParams {
  initialPrompt: string | undefined;
  submitPrompt: (query: string) => void | Promise<void>;
  agentClientPresent: boolean;
  interactiveRuntimeReady: boolean;
  store: DialogStore;
  blockedByDialogs: {
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
  store,
  blockedByDialogs,
  startupGuardsInitialized,
}: UseInitialPromptSubmitParams): void {
  const initialPromptSubmittedRef = useRef<'idle' | 'pending' | 'done'>('idle');
  const blockingDialogOpen = useStoreSelector(store.store, (state) =>
    state.requests.some((r) =>
      (BLOCKING_DIALOG_KINDS as readonly string[]).includes(r.kind),
    ),
  );

  useEffect(() => {
    if (!initialPrompt || initialPromptSubmittedRef.current !== 'idle') {
      return;
    }

    const isSpecialDialogOpen =
      blockedByDialogs.showPrivacyNotice ||
      blockedByDialogs.isWelcomeDialogOpen ||
      blockedByDialogs.isFolderTrustDialogOpen;

    if (isSpecialDialogOpen || blockingDialogOpen || !agentClientPresent) {
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
    blockingDialogOpen,
    blockedByDialogs.showPrivacyNotice,
    blockedByDialogs.isWelcomeDialogOpen,
    blockedByDialogs.isFolderTrustDialogOpen,
    startupGuardsInitialized,
  ]);
}
