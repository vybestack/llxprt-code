/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import {
  coreEvents,
  CoreEvent,
  debugLogger,
  type Config,
  type ModelProfileInfoPayload,
} from '@vybestack/llxprt-code-core';

interface UseModelRuntimeSyncParams {
  config: Config;
  currentModel: string;
  setCurrentModel: (model: string) => void;
  /**
   * Profile-aware display label shown in the footer (e.g. profile name or
   * provider:model composite). Tracked separately from the raw model string
   * so provider/profile-only changes still update the footer.
   */
  currentModelLabel?: string;
  setCurrentModelLabel?: (label: string) => void;
  getActiveModelName: () => string | undefined;
  getActiveProviderName?: () => string | undefined;
  /**
   * Resolves the profile-qualified footer identity from live runtime state
   * (issue #2193). When provided this is the single source of truth for the
   * footer label, producing `profileName:modelName` for standard profiles and
   * `lb:<lb>:<sub>:<model>` for load-balancer profiles. When omitted the hook
   * falls back to deriving a `provider:model` composite label.
   */
  resolveModelDisplayLabel?: () => string;
  contextLimit?: number;
  setContextLimit: (limit: number | undefined) => void;
}

export function useModelRuntimeSync({
  config,
  currentModel,
  setCurrentModel,
  currentModelLabel,
  setCurrentModelLabel,
  getActiveModelName,
  getActiveProviderName,
  resolveModelDisplayLabel,
  contextLimit,
  setContextLimit,
}: UseModelRuntimeSyncParams): void {
  const contextLimitRef = useRef(contextLimit);
  contextLimitRef.current = contextLimit;

  const currentModelRef = useRef(currentModel);
  currentModelRef.current = currentModel;

  const currentModelLabelRef = useRef(currentModelLabel);
  currentModelLabelRef.current = currentModelLabel;

  const resolveModelDisplayLabelRef = useRef(resolveModelDisplayLabel);
  resolveModelDisplayLabelRef.current = resolveModelDisplayLabel;

  useEffect(() => {
    const syncModelAndContextLimit = (
      payload?: ModelProfileInfoPayload,
      isInitial = false,
    ): void => {
      const effectiveModel =
        payload?.model ?? computeEffectiveModel(config, getActiveModelName);

      if (effectiveModel !== currentModelRef.current) {
        debugLogger.debug(
          `[Model Update] Updating footer from ${currentModelRef.current} to ${effectiveModel}`,
        );
        setCurrentModel(effectiveModel);
      }

      if (setCurrentModelLabel) {
        syncModelLabel({
          isInitial,
          payload,
          config,
          getActiveModelName,
          getActiveProviderName,
          resolveModelDisplayLabel: resolveModelDisplayLabelRef.current,
          currentLabel: currentModelLabelRef.current,
          setCurrentModelLabel,
        });
      }

      const currentContextLimit = config.getEphemeralSetting(
        'context-limit',
      ) as number | undefined;
      if (currentContextLimit !== contextLimitRef.current) {
        setContextLimit(currentContextLimit);
      }
    };

    syncModelAndContextLimit(undefined, true);

    const handleModelChanged = () => syncModelAndContextLimit();
    const handleModelProfileChanged = (payload: ModelProfileInfoPayload) =>
      syncModelAndContextLimit(payload);
    const handleSettingsChanged = () => syncModelAndContextLimit();

    coreEvents.on(CoreEvent.ModelChanged, handleModelChanged);
    coreEvents.on(CoreEvent.ModelProfileChanged, handleModelProfileChanged);
    coreEvents.on(CoreEvent.SettingsChanged, handleSettingsChanged);

    return () => {
      coreEvents.off(CoreEvent.ModelChanged, handleModelChanged);
      coreEvents.off(CoreEvent.ModelProfileChanged, handleModelProfileChanged);
      coreEvents.off(CoreEvent.SettingsChanged, handleSettingsChanged);
    };
  }, [
    config,
    getActiveModelName,
    getActiveProviderName,
    setCurrentModel,
    setCurrentModelLabel,
    setContextLimit,
  ]);
}

interface SyncModelLabelParams {
  isInitial: boolean;
  payload: ModelProfileInfoPayload | undefined;
  config: Config;
  getActiveModelName: () => string | undefined;
  getActiveProviderName?: () => string | undefined;
  resolveModelDisplayLabel?: () => string;
  currentLabel: string | undefined;
  setCurrentModelLabel: (label: string) => void;
}

/**
 * Resolves and applies the profile-aware footer label.
 *
 * On the initial sync (no event), only seeds the label when the consumer has
 * not provided one yet, preserving a prior profile-aware label. On
 * event-triggered syncs (ModelChanged/SettingsChanged/ModelProfileChanged),
 * always updates when the computed label differs so stale profile labels are
 * refreshed when the underlying model/provider changes.
 */
function syncModelLabel(params: SyncModelLabelParams): void {
  const {
    isInitial,
    payload,
    config,
    getActiveModelName,
    getActiveProviderName,
    resolveModelDisplayLabel,
    currentLabel,
    setCurrentModelLabel,
  } = params;

  const effectiveLabel = resolveModelDisplayLabel
    ? resolveModelDisplayLabel()
    : computeEffectiveModelLabel(
        payload,
        config,
        getActiveModelName,
        getActiveProviderName,
      );

  const shouldUpdateLabel = !isInitial || !currentLabel || currentLabel === '';
  if (shouldUpdateLabel && effectiveLabel !== currentLabel) {
    debugLogger.debug(
      `[Model Update] Updating footer label from ${currentLabel} to ${effectiveLabel}`,
    );
    setCurrentModelLabel(effectiveLabel);
  }
}

function computeEffectiveModel(
  config: Config,
  getActiveModelName: () => string | undefined,
): string {
  const configModel = config.getModel();
  const providerModel = getActiveModelName();
  const trimmed = providerModel?.trim();
  return trimmed && trimmed !== '' ? trimmed : configModel;
}

/**
 * Computes the profile-aware display label shown in the footer.
 *
 * Prefers an explicit `displayLabel` from a profile/provider/model change
 * payload. When no payload is available (e.g. ModelChanged/SettingsChanged),
 * derives a composite label from the active provider and model so that
 * provider-only or profile-only changes still produce a distinct label.
 */
function computeEffectiveModelLabel(
  payload: ModelProfileInfoPayload | undefined,
  config: Config,
  getActiveModelName: () => string | undefined,
  getActiveProviderName?: () => string | undefined,
): string {
  if (payload) {
    const trimmedLabel = payload.displayLabel.trim();
    if (trimmedLabel !== '') {
      return trimmedLabel;
    }
  }

  const model = computeEffectiveModel(config, getActiveModelName);
  const provider = getActiveProviderName?.()?.trim();
  return provider && provider !== '' ? `${provider}:${model}` : model;
}
