/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { coreEvents, CoreEvent } from '@vybestack/llxprt-code-core';
import type { TerminalStore } from '../../../stores/terminal/terminalStore.js';
import type { SettingsProfileStore } from '../../../stores/settings/settingsStore.js';
import { useStoreSelector } from '../../../stores/useStoreSelector.js';

/**
 * @hook useDisplayPreferences
 * @description Display toggles and settings sync backed by the stores
 * @inputs terminalStore (display prefs), settingsStore (nonce)
 * @outputs Display states, setters, settingsNonce
 * @sideEffects CoreEvent.SettingsChanged subscription writing the nonce
 * @cleanup Unsubscribes on unmount
 * @strictMode Safe - subscription cleanup runs on both unmounts
 * @subscriptionStrategy Resubscribe
 */

export interface UseDisplayPreferencesResult {
  // Debug profiler
  showDebugProfiler: boolean;
  toggleDebugProfiler: () => void;

  // Markdown rendering
  renderMarkdown: boolean;
  setRenderMarkdown: (render: boolean) => void;

  // Task-list panel collapse state
  isTodoPanelCollapsed: boolean;
  setIsTodoPanelCollapsed: (collapsed: boolean) => void;

  // Queued messages panel collapse state
  isQueuedMessagesPanelCollapsed: boolean;
  setIsQueuedMessagesPanelCollapsed: (collapsed: boolean) => void;

  // Settings nonce for forcing re-renders when settings change
  settingsNonce: number;
}

export function useDisplayPreferences(
  terminalStore: TerminalStore,
  settingsStore: SettingsProfileStore,
): UseDisplayPreferencesResult {
  const showDebugProfiler = useStoreSelector(
    terminalStore.store,
    (s) => s.showDebugProfiler,
  );
  const renderMarkdown = useStoreSelector(
    terminalStore.store,
    (s) => s.renderMarkdown,
  );
  const isTodoPanelCollapsed = useStoreSelector(
    terminalStore.store,
    (s) => s.isTodoPanelCollapsed,
  );
  const isQueuedMessagesPanelCollapsed = useStoreSelector(
    terminalStore.store,
    (s) => s.isQueuedMessagesPanelCollapsed,
  );
  const settingsNonce = useStoreSelector(
    settingsStore.store,
    (s) => s.settingsNonce,
  );

  // Subscribe to settings changes to bump the nonce
  useEffect(() => {
    const handleSettingsChanged = () => {
      settingsStore.commands.bumpSettingsNonce();
    };

    coreEvents.on(CoreEvent.SettingsChanged, handleSettingsChanged);
    return () => {
      coreEvents.off(CoreEvent.SettingsChanged, handleSettingsChanged);
    };
  }, [settingsStore]);

  return {
    // Debug profiler
    showDebugProfiler,
    toggleDebugProfiler: terminalStore.commands.toggleDebugProfiler,

    // Markdown rendering
    renderMarkdown,
    setRenderMarkdown: terminalStore.commands.setRenderMarkdown,

    // Task-list panel collapse state
    isTodoPanelCollapsed,
    setIsTodoPanelCollapsed: terminalStore.commands.setIsTodoPanelCollapsed,

    // Queued messages panel collapse state
    isQueuedMessagesPanelCollapsed,
    setIsQueuedMessagesPanelCollapsed:
      terminalStore.commands.setIsQueuedMessagesPanelCollapsed,

    // Settings nonce
    settingsNonce,
  };
}
