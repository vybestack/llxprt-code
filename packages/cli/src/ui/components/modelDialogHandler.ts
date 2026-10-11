/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import type { HydratedModel } from '@vybestack/llxprt-code-core';
import type { DialogStore } from '../stores/dialog/dialogStore.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import {
  agentProviderSwitchRecorder,
  recordProviderSwitchReportingFailure,
} from '../utils/recordActiveProviderSwitch.js';

interface ModelDialogCommandContext {
  recordingIntegration?: {
    recordProviderSwitch(provider: string, model: string): void;
  };
  recordingOwner?: 'agent';
  services?: { agent: Agent | null };
}

/** The part of the runtime API a model selection uses. */
interface ModelSwitchRuntime {
  setProvider(provider: string): Promise<{
    nextProvider: string;
    infoMessages: readonly string[];
  }>;
  setActiveModel(model: string): Promise<{
    nextModel: string;
    providerName: string;
  }>;
  providerStatus(): { providerName: string | null };
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

/** An info-message failure must not mask a successful switch or the other messages. */
function addInfoItem(
  addItem: UseHistoryManagerReturn['addItem'],
  text: string,
): void {
  try {
    addItem({ type: 'info', text });
  } catch {
    // History rendering failure is isolated from the switch itself.
  }
}

/** A failure report must not turn a successful switch into a failed one. */
function addErrorItem(
  addItem: UseHistoryManagerReturn['addItem'],
  text: string,
): void {
  try {
    addItem({ type: 'error', text });
  } catch {
    // History rendering failure is isolated from the switch itself.
  }
}

/** A status or history failure must not mask the original switch error. */
function reportSwitchFailure(
  readProviderName: () => string | null,
  addItem: UseHistoryManagerReturn['addItem'],
  error: unknown,
): void {
  let providerName: string | null | undefined;
  try {
    providerName = readProviderName();
  } catch {
    // Runtime status read failure must not mask the original error
  }
  addErrorItem(
    addItem,
    `Failed to switch model for provider '${providerName ?? 'unknown'}': ${error instanceof Error ? error.message : String(error)}`,
  );
}

/**
 * Handler invoked when a user selects a model in the ModelsDialog browser.
 * Performs the provider/model switch, records it, and opens the
 * ModelConfigDialog on success. History rendering failures are isolated;
 * a recording failure is reported as its own error item and never turns a
 * successful switch into a failed one.
 */
export function useModelDialogHandler(
  runtime: ModelSwitchRuntime,
  addItem: UseHistoryManagerReturn['addItem'],
  store: DialogStore,
  currentProvider: string | null,
  commandContext: ModelDialogCommandContext,
) {
  return useCallback(
    (model: HydratedModel) => {
      void (async () => {
        let switchSucceeded = false;
        try {
          const selectedProvider = model.provider;
          if (
            commandContext.recordingOwner === 'agent' &&
            !commandContext.services?.agent
          ) {
            throw new Error('Session agent is unavailable');
          }
          // The Agent session owner is the single recording writer in owner
          // mode; otherwise the raw integration records.
          const recorder =
            commandContext.recordingOwner === 'agent'
              ? agentProviderSwitchRecorder((event) =>
                  commandContext.services?.agent?.session.recordRecordingEvent(
                    event,
                  ),
                )
              : commandContext.recordingIntegration;
          if (selectedProvider !== currentProvider) {
            const switchResult = await runtime.setProvider(selectedProvider);
            await runtime.setActiveModel(model.id);
            switchSucceeded = true;
            for (const message of buildCrossProviderMessages(
              currentProvider,
              switchResult,
              model.id,
              selectedProvider,
            )) {
              addInfoItem(addItem, message);
            }
            await recordProviderSwitchReportingFailure(
              recorder,
              () => ({ provider: selectedProvider, model: model.id }),
              (text) => addErrorItem(addItem, text),
            );
          } else {
            const result = await runtime.setActiveModel(model.id);
            switchSucceeded = true;
            addInfoItem(
              addItem,
              `Active model is '${result.nextModel}' for provider '${result.providerName}'.`,
            );
            await recordProviderSwitchReportingFailure(
              recorder,
              () => ({
                provider: result.providerName,
                model: result.nextModel,
              }),
              (text) => addErrorItem(addItem, text),
            );
          }
        } catch (e) {
          reportSwitchFailure(
            () => runtime.providerStatus().providerName,
            addItem,
            e,
          );
        }
        store.commands.closeDialog('models');
        if (switchSucceeded) {
          store.commands.openDialog({ kind: 'modelConfig', payload: {} });
        }
      })();
    },
    [runtime, addItem, store, currentProvider, commandContext],
  );
}
