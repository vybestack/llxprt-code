/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { coreEvents, CoreEvent } from '@vybestack/llxprt-code-core';

/**
 * @hook useDisplayPreferences
 * @description Display toggles and settings sync
 * @inputs none
 * @outputs Display states, setters, settingsNonce
 * @sideEffects CoreEvent.SettingsChanged subscription
 * @cleanup Unsubscribes on unmount
 * @strictMode Safe - subscription cleanup runs on both unmounts
 * @subscriptionStrategy Resubscribe
 */

export interface UseDisplayPreferencesResult {
  // Error details display
  showErrorDetails: boolean;
  setShowErrorDetails: (show: boolean) => void;

  // Tool descriptions display
  showToolDescriptions: boolean;
  setShowToolDescriptions: (show: boolean) => void;

  // Debug profiler
  showDebugProfiler: boolean;
  toggleDebugProfiler: () => void;

  // Copy mode
  copyModeEnabled: boolean;
  setCopyModeEnabled: (enabled: boolean) => void;

  // Markdown rendering
  renderMarkdown: boolean;
  setRenderMarkdown: (render: boolean) => void;

  // Todo panel collapse state
  isTodoPanelCollapsed: boolean;
  setIsTodoPanelCollapsed: (collapsed: boolean) => void;

  // Settings nonce for forcing re-renders when settings change
  settingsNonce: number;
}

export function useDisplayPreferences(): UseDisplayPreferencesResult {
  const [showErrorDetails, setShowErrorDetails] = useState<boolean>(false);
  const [showToolDescriptions, setShowToolDescriptions] =
    useState<boolean>(false);
  const [showDebugProfiler, setShowDebugProfiler] = useState(false);
  const [copyModeEnabled, setCopyModeEnabled] = useState(false);
  const [renderMarkdown, setRenderMarkdown] = useState<boolean>(true);
  const [isTodoPanelCollapsed, setIsTodoPanelCollapsed] = useState(false);
  const [settingsNonce, setSettingsNonce] = useState(0);

  const toggleDebugProfiler = useCallback(() => {
    setShowDebugProfiler((prev) => !prev);
  }, []);

  // Subscribe to settings changes to increment nonce
  useEffect(() => {
    const handleSettingsChanged = () => {
      setSettingsNonce((prev) => prev + 1);
    };

    coreEvents.on(CoreEvent.SettingsChanged, handleSettingsChanged);
    return () => {
      coreEvents.off(CoreEvent.SettingsChanged, handleSettingsChanged);
    };
  }, []);

  return {
    // Error details display
    showErrorDetails,
    setShowErrorDetails,

    // Tool descriptions display
    showToolDescriptions,
    setShowToolDescriptions,

    // Debug profiler
    showDebugProfiler,
    toggleDebugProfiler,

    // Copy mode
    copyModeEnabled,
    setCopyModeEnabled,

    // Markdown rendering
    renderMarkdown,
    setRenderMarkdown,

    // Todo panel collapse state
    isTodoPanelCollapsed,
    setIsTodoPanelCollapsed,

    // Settings nonce
    settingsNonce,
  };
}
