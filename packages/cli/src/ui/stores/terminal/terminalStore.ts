/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  computeInputWidth,
  computeSuggestionsWidth,
  STATIC_EXTRA_HEIGHT,
} from '../../utils/ui-sizing.js';
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
  /** Alt+M markdown rendering toggle for message bodies. */
  renderMarkdown: boolean;
  isTodoPanelCollapsed: boolean;
  isQueuedMessagesPanelCollapsed: boolean;
  showDebugProfiler: boolean;

  /**
   * Composer/input plane: mode flags and readouts owned by the input surface.
   * The terminal store already carries focus/capabilities, and these share its
   * subscriber set (the composer), so they live here instead of a data store.
   */
  terminalBackgroundColor?: string;
  shellModeActive: boolean;
  showEscapePrompt: boolean;
  queueErrorMessage: string | null;
  embeddedShellFocused: boolean;
  activeShellPtyId: number | null;
  placeholder: string;
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
  setRenderMarkdown: (render: boolean) => void;
  setIsTodoPanelCollapsed: (collapsed: boolean) => void;
  setIsQueuedMessagesPanelCollapsed: (collapsed: boolean) => void;
  toggleDebugProfiler: () => void;
  setTerminalBackgroundColor: (color: string | undefined) => void;
  setShellModeActive: (active: boolean) => void;
  setShowEscapePrompt: (show: boolean) => void;
  setQueueErrorMessage: (message: string | null) => void;
  /**
   * Accepts the React-style updater form because the Ctrl+F focus handoff
   * toggles from the previous value inside the keypress handler.
   */
  setEmbeddedShellFocused: (
    focused: boolean | ((prev: boolean) => boolean),
  ) => void;
  setActiveShellPtyId: (ptyId: number | null) => void;
  setPlaceholder: (placeholder: string) => void;
}

export interface TerminalStore {
  store: Store<TerminalState>;
  commands: TerminalCommands;
}

const DEFAULT_TERMINAL_WIDTH = 80;
const DEFAULT_TERMINAL_HEIGHT = 24;

function initialTerminalState(): TerminalState {
  return {
    terminalWidth: DEFAULT_TERMINAL_WIDTH,
    terminalHeight: DEFAULT_TERMINAL_HEIGHT,
    mainAreaWidth: DEFAULT_TERMINAL_WIDTH,
    inputWidth: computeInputWidth(DEFAULT_TERMINAL_WIDTH),
    suggestionsWidth: computeSuggestionsWidth(DEFAULT_TERMINAL_WIDTH),
    isNarrow: false,
    footerHeight: 0,
    availableTerminalHeight: DEFAULT_TERMINAL_HEIGHT - STATIC_EXTRA_HEIGHT,
    isFocused: true,
    isInputActive: false,
    useAlternateBuffer: false,
    screenReaderEnabled: false,
    copyModeEnabled: false,
    constrainHeight: true,
    showErrorDetails: false,
    showToolDescriptions: false,
    // Matches the shipped default. Message components fall back to plain-text
    // rendering when this is false, so tests must seed it deliberately.
    renderMarkdown: true,
    isTodoPanelCollapsed: false,
    isQueuedMessagesPanelCollapsed: false,
    showDebugProfiler: false,
    terminalBackgroundColor: undefined,
    shellModeActive: false,
    showEscapePrompt: false,
    queueErrorMessage: null,
    embeddedShellFocused: false,
    activeShellPtyId: null,
    placeholder: '',
  };
}

type TerminalDimensionCommands = Pick<
  TerminalCommands,
  | 'setDimensions'
  | 'setMainAreaWidth'
  | 'setNarrow'
  | 'setFooterHeight'
  | 'setAvailableTerminalHeight'
>;

type TerminalFocusCommands = Pick<
  TerminalCommands,
  | 'setFocus'
  | 'setInputActive'
  | 'setEmbeddedShellFocused'
  | 'setActiveShellPtyId'
>;

type TerminalDisplayCommands = Pick<
  TerminalCommands,
  | 'setCapabilities'
  | 'setCopyModeEnabled'
  | 'setConstrainHeight'
  | 'setShowErrorDetails'
  | 'setShowToolDescriptions'
  | 'setRenderMarkdown'
  | 'setIsTodoPanelCollapsed'
  | 'setIsQueuedMessagesPanelCollapsed'
  | 'toggleDebugProfiler'
  | 'setTerminalBackgroundColor'
>;

type TerminalInputCommands = Pick<
  TerminalCommands,
  | 'setShellModeActive'
  | 'setShowEscapePrompt'
  | 'setQueueErrorMessage'
  | 'setPlaceholder'
>;

/** Dimension writers: the fields a resize storm rewrites together. */
function createTerminalDimensionCommands(
  store: Store<TerminalState>,
): TerminalDimensionCommands {
  const setDimensions = (dimensions: TerminalDimensions): void => {
    store.setState((prev) => ({ ...prev, ...dimensions }));
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

  return {
    setDimensions,
    setMainAreaWidth,
    setNarrow,
    setFooterHeight,
    setAvailableTerminalHeight,
  };
}

/** Focus writers: window focus, composer activity, embedded-shell focus. */
function createTerminalFocusCommands(
  store: Store<TerminalState>,
): TerminalFocusCommands {
  const setFocus = (focused: boolean): void => {
    store.setState((prev) => ({ ...prev, isFocused: focused }));
  };

  const setInputActive = (active: boolean): void => {
    store.setState((prev) => ({ ...prev, isInputActive: active }));
  };

  const setEmbeddedShellFocused = (
    focused: boolean | ((prev: boolean) => boolean),
  ): void => {
    store.setState((prev) => {
      const next =
        typeof focused === 'function'
          ? focused(prev.embeddedShellFocused)
          : focused;
      return prev.embeddedShellFocused === next
        ? prev
        : { ...prev, embeddedShellFocused: next };
    });
  };

  const setActiveShellPtyId = (ptyId: number | null): void => {
    store.setState((prev) => ({ ...prev, activeShellPtyId: ptyId }));
  };

  return {
    setFocus,
    setInputActive,
    setEmbeddedShellFocused,
    setActiveShellPtyId,
  };
}

/** Display-preference and capability writers. */
function createTerminalDisplayCommands(
  store: Store<TerminalState>,
): TerminalDisplayCommands {
  const setCapabilities = (capabilities: TerminalCapabilities): void => {
    store.setState((prev) => ({ ...prev, ...capabilities }));
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

  const setRenderMarkdown = (render: boolean): void => {
    store.setState((prev) => ({ ...prev, renderMarkdown: render }));
  };

  const setIsTodoPanelCollapsed = (collapsed: boolean): void => {
    store.setState((prev) => ({ ...prev, isTodoPanelCollapsed: collapsed }));
  };

  const setIsQueuedMessagesPanelCollapsed = (collapsed: boolean): void => {
    store.setState((prev) => ({
      ...prev,
      isQueuedMessagesPanelCollapsed: collapsed,
    }));
  };

  const toggleDebugProfiler = (): void => {
    store.setState((prev) => ({
      ...prev,
      showDebugProfiler: !prev.showDebugProfiler,
    }));
  };

  const setTerminalBackgroundColor = (color: string | undefined): void => {
    store.setState((prev) =>
      prev.terminalBackgroundColor === color
        ? prev
        : { ...prev, terminalBackgroundColor: color },
    );
  };

  return {
    setCapabilities,
    setCopyModeEnabled,
    setConstrainHeight,
    setShowErrorDetails,
    setShowToolDescriptions,
    setRenderMarkdown,
    setIsTodoPanelCollapsed,
    setIsQueuedMessagesPanelCollapsed,
    toggleDebugProfiler,
    setTerminalBackgroundColor,
  };
}

/** Composer/input-plane writers. */
function createTerminalInputCommands(
  store: Store<TerminalState>,
): TerminalInputCommands {
  const setShellModeActive = (active: boolean): void => {
    store.setState((prev) => ({ ...prev, shellModeActive: active }));
  };

  const setShowEscapePrompt = (show: boolean): void => {
    store.setState((prev) => ({ ...prev, showEscapePrompt: show }));
  };

  const setQueueErrorMessage = (message: string | null): void => {
    store.setState((prev) => ({ ...prev, queueErrorMessage: message }));
  };

  const setPlaceholder = (placeholder: string): void => {
    store.setState((prev) =>
      prev.placeholder === placeholder ? prev : { ...prev, placeholder },
    );
  };

  return {
    setShellModeActive,
    setShowEscapePrompt,
    setQueueErrorMessage,
    setPlaceholder,
  };
}

export function createTerminalStore(
  initial?: Partial<TerminalState>,
): TerminalStore {
  const store = createStore<TerminalState>({
    ...initialTerminalState(),
    ...initial,
  });

  return {
    store,
    commands: {
      ...createTerminalDimensionCommands(store),
      ...createTerminalFocusCommands(store),
      ...createTerminalDisplayCommands(store),
      ...createTerminalInputCommands(store),
    },
  };
}
