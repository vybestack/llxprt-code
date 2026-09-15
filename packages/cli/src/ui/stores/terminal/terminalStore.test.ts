/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createTerminalStore, type TerminalState } from './terminalStore.js';

describe('createTerminalStore', () => {
  it('starts with the documented defaults', () => {
    const { store } = createTerminalStore();
    expect(store.getState()).toStrictEqual({
      terminalWidth: 80,
      terminalHeight: 24,
      mainAreaWidth: 80,
      inputWidth: 66,
      suggestionsWidth: 64,
      isNarrow: false,
      footerHeight: 0,
      availableTerminalHeight: 21,
      isFocused: true,
      isInputActive: false,
      useAlternateBuffer: false,
      screenReaderEnabled: false,
      copyModeEnabled: false,
      constrainHeight: true,
      showErrorDetails: false,
      showToolDescriptions: false,
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
    } satisfies TerminalState);
  });

  it('setDimensions replaces the four terminal-derived widths and heights', () => {
    const { store, commands } = createTerminalStore();
    commands.setDimensions({
      terminalWidth: 120,
      terminalHeight: 40,
      inputWidth: 102,
      suggestionsWidth: 96,
    });
    const state = store.getState();
    expect(state.terminalWidth).toBe(120);
    expect(state.terminalHeight).toBe(40);
    expect(state.inputWidth).toBe(102);
    expect(state.suggestionsWidth).toBe(96);
    // Unrelated fields survive the resize write.
    expect(state.mainAreaWidth).toBe(80);
    expect(state.isFocused).toBe(true);
  });

  it('setDimensions applies each write independently (no batching required)', () => {
    const { store, commands } = createTerminalStore();
    commands.setDimensions({
      terminalWidth: 100,
      terminalHeight: 30,
      inputWidth: 84,
      suggestionsWidth: 80,
    });
    commands.setDimensions({
      terminalWidth: 100,
      terminalHeight: 31,
      inputWidth: 84,
      suggestionsWidth: 80,
    });
    expect(store.getState().terminalHeight).toBe(31);
  });

  it('setCapabilities writes both capability flags in one state change', () => {
    const { store, commands } = createTerminalStore();
    commands.setCapabilities({
      useAlternateBuffer: true,
      screenReaderEnabled: true,
    });
    expect(store.getState().useAlternateBuffer).toBe(true);
    expect(store.getState().screenReaderEnabled).toBe(true);
    commands.setCapabilities({
      useAlternateBuffer: false,
      screenReaderEnabled: true,
    });
    expect(store.getState().useAlternateBuffer).toBe(false);
    expect(store.getState().screenReaderEnabled).toBe(true);
  });

  describe('field setters', () => {
    it('hands focus back and forth using the current focus value', () => {
      const { store, commands } = createTerminalStore();
      commands.setEmbeddedShellFocused(true);
      expect(store.getState().embeddedShellFocused).toBe(true);
      commands.setEmbeddedShellFocused((focused) => !focused);
      expect(store.getState().embeddedShellFocused).toBe(false);
      commands.setEmbeddedShellFocused((focused) => !focused);
      expect(store.getState().embeddedShellFocused).toBe(true);
      commands.setEmbeddedShellFocused(false);
      expect(store.getState().embeddedShellFocused).toBe(false);
    });

    it('writes and clears queue errors', () => {
      const { store, commands } = createTerminalStore();
      commands.setQueueErrorMessage('Queue is busy');
      expect(store.getState().queueErrorMessage).toBe('Queue is busy');
      commands.setQueueErrorMessage(null);
      expect(store.getState().queueErrorMessage).toBeNull();
    });

    it('enters and leaves shell mode, escape prompting and the active PTY', () => {
      const { store, commands } = createTerminalStore();
      commands.setShellModeActive(true);
      commands.setShowEscapePrompt(true);
      commands.setActiveShellPtyId(42);
      expect(store.getState()).toMatchObject({
        shellModeActive: true,
        showEscapePrompt: true,
        activeShellPtyId: 42,
      });
      commands.setShellModeActive(false);
      commands.setShowEscapePrompt(false);
      commands.setActiveShellPtyId(null);
      expect(store.getState()).toMatchObject({
        shellModeActive: false,
        showEscapePrompt: false,
        activeShellPtyId: null,
      });
    });

    it('setMainAreaWidth', () => {
      const { store, commands } = createTerminalStore();
      commands.setMainAreaWidth(110);
      expect(store.getState().mainAreaWidth).toBe(110);
    });

    it('setNarrow', () => {
      const { store, commands } = createTerminalStore();
      commands.setNarrow(true);
      expect(store.getState().isNarrow).toBe(true);
    });

    it('setFooterHeight', () => {
      const { store, commands } = createTerminalStore();
      commands.setFooterHeight(7);
      expect(store.getState().footerHeight).toBe(7);
    });

    it('setAvailableTerminalHeight', () => {
      const { store, commands } = createTerminalStore();
      commands.setAvailableTerminalHeight(33);
      expect(store.getState().availableTerminalHeight).toBe(33);
    });

    it('setFocus', () => {
      const { store, commands } = createTerminalStore();
      commands.setFocus(false);
      expect(store.getState().isFocused).toBe(false);
      commands.setFocus(true);
      expect(store.getState().isFocused).toBe(true);
    });

    it('setInputActive', () => {
      const { store, commands } = createTerminalStore();
      commands.setInputActive(true);
      expect(store.getState().isInputActive).toBe(true);
    });

    it('setCopyModeEnabled', () => {
      const { store, commands } = createTerminalStore();
      commands.setCopyModeEnabled(true);
      expect(store.getState().copyModeEnabled).toBe(true);
    });

    it('setConstrainHeight', () => {
      const { store, commands } = createTerminalStore();
      commands.setConstrainHeight(false);
      expect(store.getState().constrainHeight).toBe(false);
    });

    it('setShowErrorDetails', () => {
      const { store, commands } = createTerminalStore();
      commands.setShowErrorDetails(true);
      expect(store.getState().showErrorDetails).toBe(true);
    });

    it('setShowToolDescriptions', () => {
      const { store, commands } = createTerminalStore();
      commands.setShowToolDescriptions(true);
      expect(store.getState().showToolDescriptions).toBe(true);
    });
  });

  describe('subscription semantics', () => {
    it('notifies a subscriber exactly once per command', () => {
      const { store, commands } = createTerminalStore();
      let calls = 0;
      store.subscribe(() => {
        calls += 1;
      });
      commands.setFocus(false);
      expect(calls).toBe(1);
      commands.setConstrainHeight(false);
      expect(calls).toBe(2);
    });

    it('unsubscribe stops terminal notifications', () => {
      const { store, commands } = createTerminalStore();
      let calls = 0;
      const unsubscribe = store.subscribe(() => {
        calls += 1;
      });
      commands.setInputActive(true);
      unsubscribe();
      commands.setInputActive(false);
      expect(calls).toBe(1);
    });

    it('a resize storm of sequential writes ends at the final dimensions', () => {
      const { store, commands } = createTerminalStore();
      let notifications = 0;
      store.subscribe(() => {
        notifications += 1;
      });
      for (let width = 81; width <= 100; width++) {
        commands.setDimensions({
          terminalWidth: width,
          terminalHeight: 24,
          inputWidth: Math.max(20, Math.floor(width * 0.9) - 6),
          suggestionsWidth: Math.max(60, Math.floor(width * 0.8)),
        });
      }
      expect(notifications).toBe(20);
      expect(store.getState().terminalWidth).toBe(100);
      expect(store.getState().inputWidth).toBe(84);
      expect(store.getState().suggestionsWidth).toBe(80);
    });

    it('setDimensions writes a fresh state reference so cached selectors re-run', () => {
      const { store, commands } = createTerminalStore();
      const before = store.getState();
      commands.setDimensions({
        terminalWidth: 80,
        terminalHeight: 24,
        inputWidth: 66,
        suggestionsWidth: 64,
      });
      // Same values, new reference: selector caches must not short-circuit.
      expect(store.getState()).not.toBe(before);
      expect(store.getState()).toStrictEqual(before);
    });
  });
});

describe('store migration regressions', () => {
  it('preserves equal focus, color and placeholder references while notifying', () => {
    const { store, commands } = createTerminalStore();
    const initial = store.getState();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });
    const equalWrites = [
      () => commands.setEmbeddedShellFocused(initial.embeddedShellFocused),
      () => commands.setEmbeddedShellFocused((focused) => focused),
      () =>
        commands.setTerminalBackgroundColor(initial.terminalBackgroundColor),
      () => commands.setPlaceholder(initial.placeholder),
    ];
    for (const [index, write] of equalWrites.entries()) {
      write();
      expect(store.getState()).toBe(initial);
      expect(notifications).toBe(index + 1);
    }
    commands.setEmbeddedShellFocused((focused) => !focused);
    expect(store.getState().embeddedShellFocused).toBe(
      !initial.embeddedShellFocused,
    );
  });
});
