/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createStore, type Store } from '../createStore.js';

/**
 * Terminal dimensions, focus, capabilities, and pure display preferences for
 * the interactive UI. Every field is a primitive, so narrow selectors keep a
 * resize storm from re-rendering subscribers that do not read the changed
 * field. Writers are the domain hooks (useAppBootstrap, useAppInput,
 * useAppDialogs, useAppLayout); components read through useStoreSelector.
 */
export interface TerminalState {
  // Dimensions
  terminalWidth: number;
  terminalHeight: number;
  mainAreaWidth: number;
  inputWidth: number;
  suggestionsWidth: number;
  isNarrow: boolean;
  footerHeight: number;
  availableTerminalHeight: number;

  // Focus
  isFocused: boolean;
  isInputActive: boolean;

  // Capabilities
  useAlternateBuffer: boolean;
  screenReaderEnabled: boolean;

  // Display preferences
  copyModeEnabled: boolean;
  constrainHeight: boolean;
  showErrorDetails: boolean;
  showToolDescriptions: boolean;
}

/** The four terminal-derived widths written together on every resize. */
export interface TerminalDimensions {
  terminalWidth: number;
  terminalHeight: number;
  inputWidth: number;
  suggestionsWidth: number;
}

/** Terminal capability flags derived from settings and the host terminal. */
export interface TerminalCapabilities {
  useAlternateBuffer: boolean;
  screenReaderEnabled: boolean;
}

export interface TerminalCommands {
  setDimensions: (dimensions: TerminalDimensions) => void;
  setMainAreaWidth: (width: number) => void;
  setNarrow: (narrow: boolean) => void;
  setFooterHeight: (height: number) => void;
  setAvailableTerminalHeight: (height: number) => void;
  setFocus: (focused: boolean) => void;
  setInputActive: (active: boolean) => void;
  setCapabilities: (capabilities: TerminalCapabilities) => void;
  setCopyModeEnabled: (enabled: boolean) => void;
  setConstrainHeight: (constrain: boolean) => void;
  setShowErrorDetails: (show: boolean) => void;
  setShowToolDescriptions: (show: boolean) => void;
}

export interface TerminalStore {
  store: Store<TerminalState>;
  commands: TerminalCommands;
}

const DEFAULT_TERMINAL_WIDTH = 80;
const DEFAULT_TERMINAL_HEIGHT = 24;
const DEFAULT_STATIC_EXTRA_HEIGHT = 3;

function initialTerminalState(): TerminalState {
  return {
    terminalWidth: DEFAULT_TERMINAL_WIDTH,
    terminalHeight: DEFAULT_TERMINAL_HEIGHT,
    mainAreaWidth: DEFAULT_TERMINAL_WIDTH,
    inputWidth: Math.max(20, Math.floor(DEFAULT_TERMINAL_WIDTH * 0.9) - 6),
    suggestionsWidth: Math.max(60, Math.floor(DEFAULT_TERMINAL_WIDTH * 0.8)),
    isNarrow: false,
    footerHeight: 0,
    availableTerminalHeight:
      DEFAULT_TERMINAL_HEIGHT - DEFAULT_STATIC_EXTRA_HEIGHT,
    isFocused: true,
    isInputActive: false,
    useAlternateBuffer: false,
    screenReaderEnabled: false,
    copyModeEnabled: false,
    constrainHeight: true,
    showErrorDetails: false,
    showToolDescriptions: false,
  };
}

export function createTerminalStore(
  initial?: Partial<TerminalState>,
): TerminalStore {
  const store = createStore<TerminalState>({
    ...initialTerminalState(),
    ...initial,
  });

  const setDimensions = (dimensions: TerminalDimensions): void => {
    store.setState((prev) => ({ ...prev, ...dimensions }));
  };

  const setCapabilities = (capabilities: TerminalCapabilities): void => {
    store.setState((prev) => ({ ...prev, ...capabilities }));
  };

  const setMainAreaWidth = (width: number): void => {
    store.setState((prev) => ({ ...prev, mainAreaWidth: width }));
  };

  const setNarrow = (narrow: boolean): void => {
    store.setState((prev) => ({ ...prev, isNarrow: narrow }));
  };

  const setFooterHeight = (height: number): void => {
    store.setState((prev) => ({ ...prev, footerHeight: height }));
  };

  const setAvailableTerminalHeight = (height: number): void => {
    store.setState((prev) => ({ ...prev, availableTerminalHeight: height }));
  };

  const setFocus = (focused: boolean): void => {
    store.setState((prev) => ({ ...prev, isFocused: focused }));
  };

  const setInputActive = (active: boolean): void => {
    store.setState((prev) => ({ ...prev, isInputActive: active }));
  };

  const setCopyModeEnabled = (enabled: boolean): void => {
    store.setState((prev) => ({ ...prev, copyModeEnabled: enabled }));
  };

  const setConstrainHeight = (constrain: boolean): void => {
    store.setState((prev) => ({ ...prev, constrainHeight: constrain }));
  };

  const setShowErrorDetails = (show: boolean): void => {
    store.setState((prev) => ({ ...prev, showErrorDetails: show }));
  };

  const setShowToolDescriptions = (show: boolean): void => {
    store.setState((prev) => ({ ...prev, showToolDescriptions: show }));
  };

  return {
    store,
    commands: {
      setDimensions,
      setMainAreaWidth,
      setNarrow,
      setFooterHeight,
      setAvailableTerminalHeight,
      setFocus,
      setInputActive,
      setCapabilities,
      setCopyModeEnabled,
      setConstrainHeight,
      setShowErrorDetails,
      setShowToolDescriptions,
    },
  };
}
