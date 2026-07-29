/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import type { HydratedModel } from '@vybestack/llxprt-code-core';
import type { useRuntimeApi } from '../contexts/RuntimeContext.js';
import type { useUIActions } from '../contexts/UIActionsContext.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';

interface ModelDialogCommandContext {
  recordingIntegration?: {
    recordProviderSwitch: (provider: string, model: string) => void;
  };
}

function buildCrossProviderMessages(
  currentProvider: string | null,
  switchResult: { nextProvider: string; infoMessages: readonly string[] },
  modelId: string,
  selectedProvider: string,
): string[] {
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
  messages.push(
    `Active model is '${modelId}' for provider '${selectedProvider}'.`,
  );
  if (selectedProvider !== 'gemini') {
    messages.push('Use /key to set API key if needed.');
  }
  return messages;
}

function recordSwitchSideEffects(
  messages: string[],
  addItem: UseHistoryManagerReturn['addItem'],
  recorder: ((provider: string, model: string) => void) | undefined,
  provider: string,
  modelId: string,
): void {
  for (const msg of messages) {
    try {
      addItem({ type: 'info', text: msg });
    } catch {
      // A single info-message failure must not mask a successful switch
      // or suppress the remaining switch-info messages.
    }
  }
  recorder?.(provider, modelId);
}

/**
 * Handler invoked when a user selects a model in the ModelsDialog browser.
 * Performs the provider/model switch, records it, and opens the
 * ModelConfigDialog on success. Recording/history failures are isolated
 * so they never suppress the config dialog after a successful switch.
 */
export function useModelDialogHandler(
  runtime: ReturnType<typeof useRuntimeApi>,
  addItem: UseHistoryManagerReturn['addItem'],
  uiActions: ReturnType<typeof useUIActions>,
  currentProvider: string | null,
  commandContext: ModelDialogCommandContext,
) {
  return useCallback(
    (model: HydratedModel) => {
      void (async () => {
        let switchSucceeded = false;
        try {
          const selectedProvider = model.provider;
          const recorder =
            commandContext.recordingIntegration?.recordProviderSwitch;
          if (selectedProvider !== currentProvider) {
            const switchResult = await runtime.setProvider(selectedProvider);
            await runtime.setActiveModel(model.id);
            switchSucceeded = true;
            try {
              const messages = buildCrossProviderMessages(
                currentProvider,
                switchResult,
                model.id,
                selectedProvider,
              );
              recordSwitchSideEffects(
                messages,
                addItem,
                recorder,
                selectedProvider,
                model.id,
              );
            } catch {
              // Recording failure must not mask a successful switch
            }
          } else {
            const result = await runtime.setActiveModel(model.id);
            switchSucceeded = true;
            try {
              addItem({
                type: 'info',
                text: `Active model is '${result.nextModel}' for provider '${result.providerName}'.`,
              });
              recorder?.(result.providerName, result.nextModel);
            } catch {
              // Recording failure must not mask a successful switch
            }
          }
        } catch (e) {
          let providerName: string | null | undefined;
          try {
            providerName = runtime.getActiveProviderStatus().providerName;
          } catch {
            // Runtime status read failure must not mask the original error
          }
          try {
            addItem({
              type: 'error',
              text: `Failed to switch model for provider '${providerName ?? 'unknown'}': ${e instanceof Error ? e.message : String(e)}`,
            });
          } catch {
            // addItem failure must not prevent dialog cleanup
          }
        }
        uiActions.closeModelsDialog();
        if (switchSucceeded) {
          uiActions.openModelConfigDialog();
        }
      })();
    },
    [runtime, addItem, uiActions, currentProvider, commandContext],
  );
}
