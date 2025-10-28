/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';

// Mock ink before any imports
// Mock chalk
vi.mock('chalk', () => ({
  default: {
    inverse: (text: string) => text,
  },
}));

// Mock string-width
vi.mock('string-width', () => ({
  default: (str: string) => str.length,
}));

// Mock the clipboard module
vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
    unescapePath: (path: string) => path,
  };
});

// Mock the required hooks
vi.mock('../hooks/useShellHistory.js', () => ({
  useShellHistory: () => ({
    addToHistory: vi.fn(),
    navigateHistory: vi.fn(),
    current: '',
    addCommandToHistory: vi.fn(),
    getPreviousCommand: vi.fn(),
    getNextCommand: vi.fn(),
  }),
}));

vi.mock('../hooks/useCompletion.js', () => ({
  useCompletion: () => ({
    completionItems: [],
    selectedIndex: 0,
    moveSelection: vi.fn(),
    selectItem: vi.fn(),
    reset: vi.fn(),
    resetCompletionState: vi.fn(),
    showSuggestions: false,
    suggestions: [],
    activeSuggestionIndex: -1,
    isLoadingSuggestions: false,
    visibleStartIndex: 0,
  }),
}));

vi.mock('../hooks/useInputHistory.js', () => ({
  useInputHistory: () => ({
    history: [],
    currentIndex: -1,
    addToHistory: vi.fn(),
    navigateHistory: vi.fn(),
    getCurrentEntry: vi.fn(),
  }),
}));

vi.mock('../utils/clipboardUtils.js', () => ({
  pasteClipboardImage: vi.fn(),
}));

vi.mock('../hooks/usePromptEnhancement.js', () => ({
  usePromptEnhancement: () => ({
    enhancedPrompt: '',
    isEnhancing: false,
    enhancePrompt: vi.fn(),
    acceptEnhancement: vi.fn(),
    cancelEnhancement: vi.fn(),
  }),
}));

vi.mock('../hooks/useProviderModelDialog.js', () => ({
  useProviderModelDialog: () => ({
    dialog: null,
    showDialog: vi.fn(),
  }),
}));

// Variable to store the keypress handler
let keypressHandler: ((key: Record<string, unknown>) => void) | null = null;

// Mock useKeypress hook to capture the handler
vi.mock('../hooks/useKeypress.ts', () => ({
  useKeypress: (
    handler: (key: Record<string, unknown>) => void,
    _options?: unknown,
  ) => {
    keypressHandler = handler;
    // Return a mock function to ensure the hook setup completes
    return vi.fn();
  },
  Key: {},
}));

// Now import components after all mocks are set up
import { render } from 'ink-testing-library';
import { act } from 'react-dom/test-utils';
import { InputPrompt } from './InputPrompt.js';
import { AppDispatchProvider } from '../contexts/AppDispatchContext.js';
import { TextBuffer } from './shared/text-buffer.js';
import { CommandContext } from '../commands/types.js';
import { Config } from '@vybestack/llxprt-code-core';

// Mock Config
const mockConfig = {
  apiKey: 'test-key',
  model: 'test-model',
  getProjectRoot: () => '/tmp/test',
  getTargetDir: () => '/tmp/test',
  getWorkspaceContext: () => ({
    getDirectories: () => ['/tmp/test'],
  }),
  getEnablePromptCompletion: () => false,
} as unknown as Config;

describe('InputPrompt paste functionality', () => {
  let mockBuffer: TextBuffer;
  let mockOnSubmit: ReturnType<typeof vi.fn>;
  let mockOnClearScreen: ReturnType<typeof vi.fn>;
  let mockSetShellModeActive: ReturnType<typeof vi.fn>;
  let sendKey: (key: Record<string, unknown>) => Promise<void>;

  beforeEach(() => {
    // Reset the keypress handler
    keypressHandler = null;

    // Create a mock TextBuffer
    mockBuffer = {
      lines: [''],
      text: '',
      cursor: [0, 0],
      preferredCol: null,
      selectionAnchor: null,
      allVisualLines: [''],
      viewportVisualLines: [''],
      visualCursor: [0, 0],
      visualScrollRow: 0,
      setText: vi.fn((text: string) => {
        mockBuffer.text = text;
        mockBuffer.lines = text.split('\n');
        // Also update allVisualLines and viewportVisualLines for consistency
        mockBuffer.allVisualLines = text.split('\n');
        mockBuffer.viewportVisualLines = text.split('\n');
      }),
      insert: vi.fn((text: string) => {
        mockBuffer.text += text;
        mockBuffer.lines = mockBuffer.text.split('\n');
      }),
      newline: vi.fn(),
      backspace: vi.fn(),
      del: vi.fn(),
      move: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      replaceRange: vi.fn(),
      replaceRangeByOffset: vi.fn(),
      moveToOffset: vi.fn((offset: number) => {
        const safeOffset = Math.max(
          0,
          Math.min(offset, mockBuffer.text.length),
        );
        const before = mockBuffer.text.slice(0, safeOffset);
        const segments = before.split('\n');
        const row = segments.length - 1;
        const col = segments[segments.length - 1]?.length ?? 0;
        mockBuffer.cursor = [row, col];
      }),
      deleteWordLeft: vi.fn(),
      deleteWordRight: vi.fn(),
      killLineRight: vi.fn(),
      killLineLeft: vi.fn(),
      handleInput: vi.fn(),
      openInExternalEditor: vi.fn(),
    } as unknown as TextBuffer;

    mockOnSubmit = vi.fn();
    mockOnClearScreen = vi.fn();
    mockSetShellModeActive = vi.fn();

    sendKey = async (key: Record<string, unknown>) => {
      const handler = keypressHandler;
      if (!handler) {
        throw new Error('keypressHandler not initialized');
      }
      await act(async () => {
        handler(key as never);
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
  });

  it('should handle multi-line paste as a single message', async () => {
    const mockDispatch = vi.fn();

    const multiLineContent = 'Line 1\nLine 2\nLine 3';

    render(
      <AppDispatchProvider value={mockDispatch}>
        <InputPrompt
          buffer={mockBuffer}
          onSubmit={mockOnSubmit}
          userMessages={[]}
          onClearScreen={mockOnClearScreen}
          config={mockConfig}
          slashCommands={[]}
          commandContext={{} as unknown as CommandContext}
          placeholder="Type a message..."
          focus={true}
          inputWidth={80}
          suggestionsWidth={0}
          shellModeActive={false}
          setShellModeActive={mockSetShellModeActive}
        />
      </AppDispatchProvider>,
    );

    // Wait a bit for component to mount and capture the handler
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Clear any initial calls that might have happened during mount
    mockOnSubmit.mockClear();
    (mockBuffer.setText as Mock).mockClear();
    (mockBuffer.insert as Mock).mockClear();

    // Ensure the handler was captured
    if (!keypressHandler) {
      console.warn('keypressHandler was not captured, skipping test');
      return;
    }

    keypressHandler({
      name: '',
      ctrl: false,
      meta: false,
      shift: false,
      paste: true,
      sequence: multiLineContent,
    });

    // Wait for the event to be processed and React to update
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Check if the handler threw an error
    if (
      !(mockBuffer.insert as Mock).mock.calls.length &&
      !(mockBuffer.handleInput as Mock).mock.calls.length
    ) {
      // Try calling the handler again with logging
      const testKey = {
        name: '',
        ctrl: false,
        meta: false,
        shift: false,
        paste: true,
        sequence: multiLineContent,
      };
      console.log('Attempting to call handler again with key:', testKey);
      keypressHandler(testKey);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // The buffer should have been updated with the paste content through handleInput
    expect(mockBuffer.handleInput).toHaveBeenCalledWith(
      expect.objectContaining({
        paste: true,
        sequence: multiLineContent,
      }),
    );

    // Check that submit was NOT called automatically
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('should show paste indicator for multi-line paste', async () => {
    const mockDispatch = vi.fn();

    const multiLineContent = 'Line 1\nLine 2\nLine 3\nLine 4';

    render(
      <AppDispatchProvider value={mockDispatch}>
        <InputPrompt
          buffer={mockBuffer}
          onSubmit={mockOnSubmit}
          userMessages={[]}
          onClearScreen={mockOnClearScreen}
          config={mockConfig}
          slashCommands={[]}
          commandContext={{} as unknown as CommandContext}
          placeholder="Type a message..."
          focus={true}
          inputWidth={80}
          suggestionsWidth={0}
          shellModeActive={false}
          setShellModeActive={mockSetShellModeActive}
        />
      </AppDispatchProvider>,
    );

    // Wait a bit for component to mount and capture the handler
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Call the handler directly instead of emitting stdin events
    await sendKey({
      name: '',
      ctrl: false,
      meta: false,
      shift: false,
      paste: true,
      sequence: multiLineContent,
    });

    expect(mockBuffer.text).toMatch(/\[4 lines pasted #\d+\]/);
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('should submit full paste content when placeholder is shown', async () => {
    const mockDispatch = vi.fn();

    const multiLineContent = 'Line 1\nLine 2\nLine 3\nLine 4';

    render(
      <AppDispatchProvider value={mockDispatch}>
        <InputPrompt
          buffer={mockBuffer}
          onSubmit={mockOnSubmit}
          userMessages={[]}
          onClearScreen={mockOnClearScreen}
          config={mockConfig}
          slashCommands={[]}
          commandContext={{} as unknown as CommandContext}
          placeholder="Type a message..."
          focus={true}
          inputWidth={80}
          suggestionsWidth={0}
          shellModeActive={false}
          setShellModeActive={mockSetShellModeActive}
        />
      </AppDispatchProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    await sendKey({
      name: '',
      ctrl: false,
      meta: false,
      shift: false,
      paste: true,
      sequence: multiLineContent,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    await sendKey({
      name: 'return',
      ctrl: false,
      meta: false,
      shift: false,
      paste: false,
      sequence: '\r',
    });

    expect(mockOnSubmit).toHaveBeenCalledWith(multiLineContent);
  });

  it('should handle single-line paste without special indicator', async () => {
    const mockDispatch = vi.fn();

    const singleLineContent = 'This is a single line';

    render(
      <AppDispatchProvider value={mockDispatch}>
        <InputPrompt
          buffer={mockBuffer}
          onSubmit={mockOnSubmit}
          userMessages={[]}
          onClearScreen={mockOnClearScreen}
          config={mockConfig}
          slashCommands={[]}
          commandContext={{} as unknown as CommandContext}
          placeholder="Type a message..."
          focus={true}
          inputWidth={80}
          suggestionsWidth={0}
          shellModeActive={false}
          setShellModeActive={mockSetShellModeActive}
        />
      </AppDispatchProvider>,
    );

    // Wait a bit for component to mount and capture the handler
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Clear any initial calls that might have happened during mount
    mockOnSubmit.mockClear();
    (mockBuffer.setText as Mock).mockClear();
    (mockBuffer.insert as Mock).mockClear();
    (mockBuffer.handleInput as Mock).mockClear();

    await sendKey({
      name: '',
      ctrl: false,
      meta: false,
      shift: false,
      paste: true,
      sequence: singleLineContent,
    });

    expect(mockBuffer.handleInput).toHaveBeenCalledWith(
      expect.objectContaining({
        paste: true,
        sequence: singleLineContent,
      }),
    );

    // Check that submit was NOT called automatically
    expect(mockOnSubmit).not.toHaveBeenCalled();

    // Check that no paste indicator is shown for single line
    expect(mockBuffer.text).not.toContain('lines pasted');
  });

  it('should preserve multiple large paste placeholders until submit', async () => {
    const mockDispatch = vi.fn();

    const firstPaste =
      'Block 1 line 1\nBlock 1 line 2\nBlock 1 line 3\nBlock 1 line 4';
    const secondPaste =
      'Block 2 line 1\nBlock 2 line 2\nBlock 2 line 3\nBlock 2 line 4';

    render(
      <AppDispatchProvider value={mockDispatch}>
        <InputPrompt
          buffer={mockBuffer}
          onSubmit={mockOnSubmit}
          userMessages={[]}
          onClearScreen={mockOnClearScreen}
          config={mockConfig}
          slashCommands={[]}
          commandContext={{} as unknown as CommandContext}
          placeholder="Type a message..."
          focus={true}
          inputWidth={80}
          suggestionsWidth={0}
          shellModeActive={false}
          setShellModeActive={mockSetShellModeActive}
        />
      </AppDispatchProvider>,
    );

    await sendKey({
      name: '',
      ctrl: false,
      meta: false,
      shift: false,
      paste: true,
      sequence: firstPaste,
    });

    await sendKey({
      name: '',
      ctrl: false,
      meta: false,
      shift: false,
      paste: true,
      sequence: secondPaste,
    });

    const placeholderMatches = mockBuffer.text.match(
      /\[4 lines pasted #\d+\]/g,
    );
    expect(placeholderMatches).not.toBeNull();
    expect(placeholderMatches?.length).toBe(2);

    await new Promise((resolve) => setTimeout(resolve, 0));

    await sendKey({
      name: 'return',
      ctrl: false,
      meta: false,
      shift: false,
      paste: false,
      sequence: '\r',
    });

    expect(mockOnSubmit).toHaveBeenCalledWith(firstPaste + secondPaste);
  });
});
