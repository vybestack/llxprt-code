/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, type Mock } from 'bun:test';

// Mock ink before any imports
// chalk is deliberately NOT mocked. Ink's colorize calls chalk.hex for hex
// colours, and a stub exposing only `inverse` made every render in this file
// throw before the component could register its keypress handler.

// Mock string-width
void vi.mock('string-width', () => ({
  default: (str: string) => str.length,
}));

// Mock the clipboard module
const actual = { ...(await import('@vybestack/llxprt-code-core')) };
void vi.mock('@vybestack/llxprt-code-core', () => ({
  ...actual,
  unescapePath: (path: string) => path,
}));

// Mock clipboardy
void vi.mock('clipboardy', () => ({
  default: {
    read: vi.fn(),
  },
}));

// Mock the required hooks
void vi.mock('../hooks/useShellHistory.js', () => ({
  useShellHistory: () => ({
    addToHistory: vi.fn(),
    navigateHistory: vi.fn(),
    current: '',
    addCommandToHistory: vi.fn(),
    getPreviousCommand: vi.fn(),
    getNextCommand: vi.fn(),
  }),
}));

void vi.mock('../hooks/useCompletion.js', () => ({
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

void vi.mock('../hooks/useInputHistory.js', () => ({
  useInputHistory: () => ({
    history: [],
    currentIndex: -1,
    addToHistory: vi.fn(),
    navigateHistory: vi.fn(),
    getCurrentEntry: vi.fn(),
  }),
}));

void vi.mock('../utils/clipboardUtils.js', () => ({
  pasteClipboardImage: vi.fn(),
  clipboardHasImage: vi.fn(),
}));

// Mocks for '../hooks/usePromptEnhancement.js' and
// '../hooks/useProviderModelDialog.js' were removed: neither module exists
// anywhere in the workspace any more, so both mocks targeted nothing.

// Variable to store the keypress handler
let keypressHandler: ((key: Record<string, unknown>) => void) | null = null;

// Mock useKeypress hook to capture the handler
// Must match the specifier the consumer imports ('.js'), not the file on disk:
// Bun's mock.module keys on the specifier string.
void vi.mock('../hooks/useKeypress.js', () => ({
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

// Mock useMouse hook
void vi.mock('../hooks/useMouse.js', () => ({
  useMouse: vi.fn(),
}));

// Now import components after all mocks are set up
import { render } from 'ink-testing-library';
import { act } from 'react-dom/test-utils';
import { InputPrompt } from './InputPrompt.js';
import { AppDispatchProvider } from '../contexts/AppDispatchContext.js';
import type { TextBuffer } from './shared/text-buffer.js';
import type { CommandContext } from '../commands/types.js';
import type { Config } from '@vybestack/llxprt-code-core';
import clipboardy from 'clipboardy';
import * as clipboardUtils from '../utils/clipboardUtils.js';
import { useMouse, type MouseEvent } from '../hooks/useMouse.js';
import { assertDefined } from '../../test-utils/assertions.js';
import { testRegex } from '../../test-utils/regex.js';

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
      transformationsByLine: [[]],
      visualToTransformedMap: [0],
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
      assertDefined(handler);
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
    (
      mockBuffer.setText as unknown as Mock<(...args: never[]) => unknown>
    ).mockClear();
    (
      mockBuffer.insert as unknown as Mock<(...args: never[]) => unknown>
    ).mockClear();

    await sendKey({
      name: 'paste',
      ctrl: false,
      meta: false,
      shift: false,
      sequence: multiLineContent,
    });

    // The buffer should have been updated with the paste content through handleInput
    expect(mockBuffer.handleInput).toHaveBeenCalledWith(
      expect.objectContaining({
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
      name: 'paste',
      ctrl: false,
      meta: false,
      shift: false,
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
      name: 'paste',
      ctrl: false,
      meta: false,
      shift: false,
      sequence: multiLineContent,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    await sendKey({
      name: 'return',
      ctrl: false,
      meta: false,
      shift: false,
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
    (
      mockBuffer.setText as unknown as Mock<(...args: never[]) => unknown>
    ).mockClear();
    (
      mockBuffer.insert as unknown as Mock<(...args: never[]) => unknown>
    ).mockClear();
    (
      mockBuffer.handleInput as unknown as Mock<(...args: never[]) => unknown>
    ).mockClear();

    await sendKey({
      name: 'paste',
      ctrl: false,
      meta: false,
      shift: false,
      sequence: singleLineContent,
    });

    expect(mockBuffer.handleInput).toHaveBeenCalledWith(
      expect.objectContaining({
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
      name: 'paste',
      ctrl: false,
      meta: false,
      shift: false,
      sequence: firstPaste,
    });

    await sendKey({
      name: 'paste',
      ctrl: false,
      meta: false,
      shift: false,
      sequence: secondPaste,
    });

    const placeholderMatches = mockBuffer.text.match(
      testRegex('\\[4 lines pasted #\\d+\\]', 'g'),
    );
    expect(placeholderMatches).not.toBeNull();
    expect(placeholderMatches?.length).toBe(2);

    await new Promise((resolve) => setTimeout(resolve, 0));

    await sendKey({
      name: 'return',
      ctrl: false,
      meta: false,
      shift: false,
      sequence: '\r',
    });

    expect(mockOnSubmit).toHaveBeenCalledWith(firstPaste + secondPaste);
  });

  it('should paste clipboard text on right-click release (mouse event)', async () => {
    const mockDispatch = vi.fn();

    // Mock clipboardUtils to return false for image check
    (
      clipboardUtils.clipboardHasImage as Mock<
        typeof clipboardUtils.clipboardHasImage
      >
    ).mockResolvedValue(false);
    // Mock clipboardy to return test text
    (clipboardy.read as Mock<typeof clipboardy.read>).mockResolvedValue(
      'pasted text from mouse',
    );

    // Set up useMouse to capture the handler and allow us to trigger it
    let mouseHandler: ((event: MouseEvent) => void) | null = null;
    (useMouse as Mock<typeof useMouse>).mockImplementation((handler) => {
      mouseHandler = handler;
    });

    mockBuffer.text = 'hello';
    mockBuffer.lines = ['hello'];

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

    // Wait for component to mount and useMouse to be called
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Clear any initial calls
    (
      mockBuffer.replaceRangeByOffset as unknown as Mock<
        (...args: never[]) => unknown
      >
    ).mockClear();

    // Verify useMouse was set up
    expect(mouseHandler).not.toBeNull();

    // Simulate right mouse release event
    await act(async () => {
      mouseHandler!({
        name: 'right-release',
        col: 5,
        row: 2,
        shift: false,
        meta: false,
        ctrl: false,
        button: 'right',
      });
    });

    // Wait for async clipboard operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify clipboard functions were called
    expect(clipboardUtils.clipboardHasImage).toHaveBeenCalled();
    expect(clipboardy.read).toHaveBeenCalled();

    // Verify paste was inserted into buffer
    expect(mockBuffer.replaceRangeByOffset).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      'pasted text from mouse',
    );
  });

  it('should expand a single large paste before steering', async () => {
    const mockDispatch = vi.fn();
    const mockOnSteer = vi.fn(() => true);

    const multiLineContent = 'Line 1\nLine 2\nLine 3\nLine 4';

    render(
      <AppDispatchProvider value={mockDispatch}>
        <InputPrompt
          buffer={mockBuffer}
          onSubmit={mockOnSubmit}
          onSteer={mockOnSteer}
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
      name: 'paste',
      ctrl: false,
      meta: false,
      shift: false,
      sequence: multiLineContent,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    await sendKey({
      name: 'return',
      ctrl: true,
      meta: false,
      shift: false,
      sequence: '\r',
    });

    expect(mockOnSteer).toHaveBeenCalledWith(multiLineContent);
  });

  it('should steer original content for a single-line 1000-code-point paste', async () => {
    const mockDispatch = vi.fn();
    const mockOnSteer = vi.fn(() => true);

    // Exactly 1000 Unicode code points (998 ASCII + 2 astral-plane emoji).
    // This crosses LARGE_PASTE_CHAR_THRESHOLD while staying on one line, so
    // the buffer shows the character-count placeholder form rather than the
    // line-count form.
    const singleLinePaste = 'a'.repeat(998) + '\u{1F600}' + '\u{1F601}';

    render(
      <AppDispatchProvider value={mockDispatch}>
        <InputPrompt
          buffer={mockBuffer}
          onSubmit={mockOnSubmit}
          onSteer={mockOnSteer}
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
      name: 'paste',
      ctrl: false,
      meta: false,
      shift: false,
      sequence: singleLinePaste,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Single-line paste at the char threshold produces the character-count
    // placeholder form, not the line-count form.
    expect(mockBuffer.text).toMatch(/\[1000 characters pasted #\d+\]/);

    await sendKey({
      name: 'return',
      ctrl: true,
      meta: false,
      shift: false,
      sequence: '\r',
    });

    // onSteer receives the exact original content, not the display label.
    expect(mockOnSteer).toHaveBeenCalledWith(singleLinePaste);
  });

  it('should preserve surrounding text when steering a large paste', async () => {
    const mockDispatch = vi.fn();
    const mockOnSteer = vi.fn(() => true);

    const pasteContent = 'Pasted 1\nPasted 2\nPasted 3\nPasted 4';

    render(
      <AppDispatchProvider value={mockDispatch}>
        <InputPrompt
          buffer={mockBuffer}
          onSubmit={mockOnSubmit}
          onSteer={mockOnSteer}
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
      name: 'paste',
      ctrl: false,
      meta: false,
      shift: false,
      sequence: pasteContent,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    mockBuffer.text = `before ${mockBuffer.text} after`;
    mockBuffer.lines = mockBuffer.text.split('\n');

    await sendKey({
      name: 'return',
      ctrl: true,
      meta: false,
      shift: false,
      sequence: '\r',
    });

    expect(mockOnSteer).toHaveBeenCalledWith(`before ${pasteContent} after`);
  });

  it('should expand multiple large pastes in order before steering', async () => {
    const mockDispatch = vi.fn();
    const mockOnSteer = vi.fn(() => true);

    const firstPaste =
      'Block 1 line 1\nBlock 1 line 2\nBlock 1 line 3\nBlock 1 line 4';
    const secondPaste =
      'Block 2 line 1\nBlock 2 line 2\nBlock 2 line 3\nBlock 2 line 4';

    render(
      <AppDispatchProvider value={mockDispatch}>
        <InputPrompt
          buffer={mockBuffer}
          onSubmit={mockOnSubmit}
          onSteer={mockOnSteer}
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
      name: 'paste',
      ctrl: false,
      meta: false,
      shift: false,
      sequence: firstPaste,
    });

    await sendKey({
      name: 'paste',
      ctrl: false,
      meta: false,
      shift: false,
      sequence: secondPaste,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    await sendKey({
      name: 'return',
      ctrl: true,
      meta: false,
      shift: false,
      sequence: '\r',
    });

    expect(mockOnSteer).toHaveBeenCalledWith(firstPaste + secondPaste);
  });

  it('should keep paste state usable when steer is declined then submit full paste', async () => {
    const mockDispatch = vi.fn();
    const mockOnSteer = vi.fn(() => false);

    const multiLineContent = 'Line 1\nLine 2\nLine 3\nLine 4';

    render(
      <AppDispatchProvider value={mockDispatch}>
        <InputPrompt
          buffer={mockBuffer}
          onSubmit={mockOnSubmit}
          onSteer={mockOnSteer}
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
      name: 'paste',
      ctrl: false,
      meta: false,
      shift: false,
      sequence: multiLineContent,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Model the production newline behaviour in the declined scenario only:
    // after the paste the cursor sits at the end of the placeholder, so
    // newline appends \n and advances the cursor one row — matching what a
    // real buffer would show after Ctrl+Enter falls through from declined steer.
    (
      mockBuffer.newline as unknown as Mock<(...args: never[]) => unknown>
    ).mockImplementation(() => {
      mockBuffer.text += '\n';
      mockBuffer.lines = mockBuffer.text.split('\n');
      mockBuffer.cursor = [mockBuffer.cursor[0] + 1, 0];
    });

    await sendKey({
      name: 'return',
      ctrl: true,
      meta: false,
      shift: false,
      sequence: '\r',
    });

    // Steer receives the expanded multi-line content even though it declines.
    expect(mockOnSteer).toHaveBeenCalledWith(multiLineContent);

    // Declined steer falls through to NEWLINE: the buffer now holds the
    // tracked placeholder followed by the inserted newline and was not cleared.
    expect(mockBuffer.text).toMatch(/\[4 lines pasted #\d+\]\n$/);
    expect(mockBuffer.text).not.toBe('');

    await sendKey({
      name: 'return',
      ctrl: false,
      meta: false,
      shift: false,
      sequence: '\r',
    });

    // Normal Enter trims the fallback newline before expansion, so the
    // original full paste content is submitted.
    expect(mockOnSubmit).toHaveBeenCalledWith(multiLineContent);
  });

  it('should pass plain text unchanged when steering', async () => {
    const mockDispatch = vi.fn();
    const mockOnSteer = vi.fn(() => true);

    render(
      <AppDispatchProvider value={mockDispatch}>
        <InputPrompt
          buffer={mockBuffer}
          onSubmit={mockOnSubmit}
          onSteer={mockOnSteer}
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

    mockBuffer.text = 'just plain text';
    mockBuffer.lines = ['just plain text'];

    await sendKey({
      name: 'return',
      ctrl: true,
      meta: false,
      shift: false,
      sequence: '\r',
    });

    expect(mockOnSteer).toHaveBeenCalledWith('just plain text');
  });

  it('should steer exact unchanged content after a sub-threshold paste', async () => {
    const mockDispatch = vi.fn();
    const mockOnSteer = vi.fn(() => true);

    // Sub-threshold: single line, well under the 4-line/1000-char limits.
    // No placeholder is created — the sequence flows through handleInput.
    const pasteContent = 'sub threshold single line paste';

    render(
      <AppDispatchProvider value={mockDispatch}>
        <InputPrompt
          buffer={mockBuffer}
          onSubmit={mockOnSubmit}
          onSteer={mockOnSteer}
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

    // Give the fake handleInput enough behavior to place the pasted
    // sequence into observable buffer state (sub-threshold pastes bypass
    // the placeholder mechanism and delegate to buffer.handleInput).
    (
      mockBuffer.handleInput as unknown as Mock<(...args: never[]) => unknown>
    ).mockImplementation((key: { sequence: string }) => {
      mockBuffer.text += key.sequence;
      mockBuffer.lines = mockBuffer.text.split('\n');
    });

    await sendKey({
      name: 'paste',
      ctrl: false,
      meta: false,
      shift: false,
      sequence: pasteContent,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    await sendKey({
      name: 'return',
      ctrl: true,
      meta: false,
      shift: false,
      sequence: '\r',
    });

    expect(mockOnSteer).toHaveBeenCalledWith(pasteContent);
  });

  it('should steer all queued submissions on Ctrl+Enter with empty buffer', async () => {
    const mockDispatch = vi.fn();
    const mockOnSteer = vi.fn(() => true);
    const mockSteerAllQueuedSubmissions = vi.fn();

    render(
      <AppDispatchProvider value={mockDispatch}>
        <InputPrompt
          buffer={mockBuffer}
          onSubmit={mockOnSubmit}
          onSteer={mockOnSteer}
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
          queuedSubmissionCount={3}
          steerAllQueuedSubmissions={mockSteerAllQueuedSubmissions}
        />
      </AppDispatchProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    await sendKey({
      name: 'return',
      ctrl: true,
      meta: false,
      shift: false,
      sequence: '\r',
    });

    expect(mockSteerAllQueuedSubmissions).toHaveBeenCalled();
    expect(mockOnSteer).not.toHaveBeenCalled();
  });
});
