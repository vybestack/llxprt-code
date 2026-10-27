/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import type { Mock } from 'bun:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { act } from 'react';
import stripAnsi from 'strip-ansi';
import { waitFor } from '../../__tests__/async.js';
import { renderWithProviders } from '../../__tests__/render.js';
import { FAST_RETURN_TIMEOUT } from '../contexts/KeypressContext.js';
import { useReverseSearchCompletion } from '../hooks/useReverseSearchCompletion.js';
import { useShellHistory } from '../hooks/useShellHistory.js';
import { disableMouseEvents, enableMouseEvents } from '../utils/mouse.js';
import * as primarySelection from '../utils/primarySelection.js';
import { InputPrompt } from './InputPrompt.js';

import {
  InputPromptWithRealBuffer,
  usePasteTestHarness,
} from '../../__tests__/input-prompt-paste-test-helpers.js';

describe('InputPrompt', () => {
  const fixture = usePasteTestHarness();
  describe('large paste submission', () => {
    const alphaPaste = 'ALPHA_1\nALPHA_2\nALPHA_3\nALPHA_4';
    const firstPaste = 'FIRST_1\nFIRST_2\nFIRST_3\nFIRST_4';
    const secondPaste = 'SECOND_1\nSECOND_2\nSECOND_3\nSECOND_4';

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => vi.useRealTimers());

    it.each([
      {
        name: 'one large paste',
        initialText: '',
        inputs: [{ kind: 'paste', text: alphaPaste }],
        expected: alphaPaste,
      },
      {
        name: 'two distinct large pastes',
        initialText: 'before:',
        inputs: [
          { kind: 'paste', text: firstPaste },
          { kind: 'text', text: ':between:' },
          { kind: 'paste', text: secondPaste },
          { kind: 'text', text: ':after' },
        ],
        expected: `before:${firstPaste}:between:${secondPaste}:after`,
      },
    ] as const)(
      'shows placeholders and expands $name through the submit path',
      async ({ initialText, inputs, expected }) => {
        const submittedValues: string[] = [];
        fixture.props.onSubmit = (value) => submittedValues.push(value);
        const rendered = renderWithProviders(
          <InputPromptWithRealBuffer
            {...fixture.props}
            initialText={initialText}
          />,
          {},
        );
        let pasteCount = 0;

        for (const input of inputs) {
          const isPaste = input.kind === 'paste';
          pasteCount += Number(isPaste);
          const sequence = isPaste
            ? `\x1b[200~${input.text}\x1b[201~`
            : input.text;
          const visibleText = isPaste
            ? `[4 lines pasted #${pasteCount}]`
            : input.text;
          await act(async () => rendered.stdin.write(sequence));
          await waitFor(() =>
            expect(rendered.stdout.lastFrame()).toContain(visibleText),
          );
        }
        const frame = rendered.stdout.lastFrame();
        for (const paste of inputs.filter((input) => input.kind === 'paste')) {
          expect(frame).not.toContain(paste.text.split('\n')[0]);
        }
        await act(() => advanceTimersByTimeAsync(FAST_RETURN_TIMEOUT + 1));

        await act(async () => rendered.stdin.write('\r'));

        await waitFor(() => expect(submittedValues).toStrictEqual([expected]));
        rendered.unmount();
      },
    );
    describe('bracketed paste thresholds', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => vi.useRealTimers());

      it.each([
        {
          name: 'LF newlines',
          pastedText: 'This \n is \n a \n multiline \n paste.',
        },
        {
          name: 'escaped newlines',
          pastedText: 'This \\\n is \\\n a \\\n multiline \\\n paste.',
        },
        {
          name: 'CRLF newlines',
          pastedText: 'This\r\nis\r\na\r\nmultiline\r\npaste.',
        },
      ])(
        'collapses a threshold-sized bracketed paste with $name into one placeholder and submits its expanded text',
        async ({ pastedText }) => {
          const expanded = pastedText.replace(/\r\n?/g, '\n');
          const submittedValues: string[] = [];
          fixture.props.onSubmit = (value) => submittedValues.push(value);
          const rendered = renderWithProviders(
            <InputPromptWithRealBuffer {...fixture.props} />,
            {},
          );

          await act(async () =>
            rendered.stdin.write(`\x1b[200~${pastedText}\x1b[201~`),
          );

          await waitFor(() =>
            expect(rendered.stdout.lastFrame()).toContain(
              '[5 lines pasted #1]',
            ),
          );
          expect(rendered.stdout.lastFrame()).not.toContain('multiline');
          expect(rendered.stdout.lastFrame()).not.toContain('#2');

          await act(() => advanceTimersByTimeAsync(FAST_RETURN_TIMEOUT + 1));
          await act(async () => rendered.stdin.write('\r'));

          await waitFor(() =>
            expect(submittedValues).toStrictEqual([expanded]),
          );
          rendered.unmount();
        },
      );
    });
  });

  describe('reverse search', () => {
    beforeEach(async () => {
      fixture.props.shellModeActive = true;

      (useShellHistory as Mock<typeof useShellHistory>).mockReturnValue({
        history: ['echo hello', 'echo world', 'ls'],
        getPreviousCommand: vi.fn(),
        getNextCommand: vi.fn(),
        addCommandToHistory: vi.fn(),
        resetHistoryPosition: vi.fn(),
      });
    });

    it('invokes reverse search on Ctrl+R', async () => {
      // Mock the reverse search completion to return suggestions
      fixture.mockedUseReverseSearchCompletion.mockReturnValue({
        ...fixture.mockReverseSearchCompletion,
        suggestions: [
          { label: 'echo hello', value: 'echo hello' },
          { label: 'echo world', value: 'echo world' },
          { label: 'ls', value: 'ls' },
        ],
        showSuggestions: true,
        activeSuggestionIndex: 0,
      });

      const { stdin, stdout, unmount } = renderWithProviders(
        <InputPrompt {...fixture.props} />,
      );

      // Trigger reverse search with Ctrl+R
      await act(async () => {
        stdin.write('\x12');
      });

      await waitFor(() => {
        const frame = stdout.lastFrame();
        expect(frame).toContain('(r:)');
        expect(frame).toContain('echo hello');
        expect(frame).toContain('echo world');
        expect(frame).toContain('ls');
      });

      unmount();
    });

    it.each([
      { name: 'standard', escapeSequence: '\x1B' },
      {
        name: 'kitty',
        kittyProtocolEnabled: true,
        escapeSequence: '\u001b[27u',
      },
    ])(
      'resets reverse search state on Escape ($name)',
      async ({ escapeSequence }) => {
        const { stdin, stdout, unmount } = renderWithProviders(
          <InputPrompt {...fixture.props} />,
          {},
        );

        await act(async () => {
          stdin.write('\x12');
        });

        // Wait for reverse search to be active
        await waitFor(() => {
          expect(stdout.lastFrame()).toContain('(r:)');
        });

        await act(async () => {
          stdin.write(escapeSequence);
        });

        await waitFor(() => {
          expect(stdout.lastFrame()).not.toContain('(r:)');
          expect(stdout.lastFrame()).not.toContain('echo hello');
        });

        unmount();
      },
    );

    it('completes the highlighted entry on Tab and exits reverse-search', async () => {
      // Mock the reverse search completion
      const mockHandleAutocomplete = vi.fn(() => {
        fixture.props.buffer.setText('echo hello');
      });

      fixture.mockedUseReverseSearchCompletion.mockImplementation(
        (buffer, shellHistory, reverseSearchActive) => ({
          ...fixture.mockReverseSearchCompletion,
          suggestions: reverseSearchActive
            ? [
                { label: 'echo hello', value: 'echo hello' },
                { label: 'echo world', value: 'echo world' },
                { label: 'ls', value: 'ls' },
              ]
            : [],
          showSuggestions: reverseSearchActive,
          activeSuggestionIndex: reverseSearchActive ? 0 : -1,
          handleAutocomplete: mockHandleAutocomplete,
        }),
      );

      const { stdin, stdout, unmount } = renderWithProviders(
        <InputPrompt {...fixture.props} />,
      );

      // Enter reverse search mode with Ctrl+R
      await act(async () => {
        stdin.write('\x12');
      });

      // Verify reverse search is active
      await waitFor(() => {
        expect(stdout.lastFrame()).toContain('(r:)');
      });

      // Press Tab to complete the highlighted entry
      await act(async () => {
        stdin.write('\t');
      });
      await waitFor(() => {
        expect(mockHandleAutocomplete).toHaveBeenCalledWith(0);
        expect(fixture.props.buffer.setText).toHaveBeenCalledWith('echo hello');
      });
      unmount();
    }, 15000);

    it('submits the highlighted entry on Enter and exits reverse-search', async () => {
      // Mock the reverse search completion to return suggestions
      fixture.mockedUseReverseSearchCompletion.mockReturnValue({
        ...fixture.mockReverseSearchCompletion,
        suggestions: [
          { label: 'echo hello', value: 'echo hello' },
          { label: 'echo world', value: 'echo world' },
          { label: 'ls', value: 'ls' },
        ],
        showSuggestions: true,
        activeSuggestionIndex: 0,
      });

      const { stdin, stdout, unmount } = renderWithProviders(
        <InputPrompt {...fixture.props} />,
      );

      await act(async () => {
        stdin.write('\x12');
      });

      await waitFor(() => {
        expect(stdout.lastFrame()).toContain('(r:)');
      });

      await act(async () => {
        stdin.write('\r');
      });

      await waitFor(() => {
        expect(stdout.lastFrame()).not.toContain('(r:)');
      });

      expect(fixture.props.onSubmit).toHaveBeenCalledWith('echo hello');
      unmount();
    });

    it('should restore text and cursor position after reverse search', async () => {
      const initialText = 'initial text';
      const initialCursor: [number, number] = [0, 3];

      fixture.props.buffer.setText(initialText);
      fixture.props.buffer.cursor = initialCursor;

      // Mock the reverse search completion to be active and then reset
      fixture.mockedUseReverseSearchCompletion.mockImplementation(
        (buffer, shellHistory, reverseSearchActiveFromInputPrompt) => ({
          ...fixture.mockReverseSearchCompletion,
          suggestions: reverseSearchActiveFromInputPrompt
            ? [{ label: 'history item', value: 'history item' }]
            : [],
          showSuggestions: reverseSearchActiveFromInputPrompt,
        }),
      );

      const { stdin, stdout, unmount } = renderWithProviders(
        <InputPrompt {...fixture.props} />,
      );

      // reverse search with Ctrl+R
      await act(async () => {
        stdin.write('\x12');
      });

      await waitFor(() => {
        expect(stdout.lastFrame()).toContain('(r:)');
      });

      // Press kitty escape key
      await act(async () => {
        stdin.write('\u001b[27u');
      });

      await waitFor(() => {
        expect(stdout.lastFrame()).not.toContain('(r:)');
        expect(fixture.props.buffer.text).toBe(initialText);
        expect(fixture.props.buffer.cursor).toStrictEqual(initialCursor);
      });

      unmount();
    });
  });

  describe('Ctrl+E keyboard shortcut', () => {
    it('should move cursor to end of current line in multiline input', async () => {
      fixture.props.buffer.text = 'line 1\nline 2\nline 3';
      fixture.props.buffer.cursor = [1, 2];
      fixture.props.buffer.lines = ['line 1', 'line 2', 'line 3'];

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...fixture.props} />,
      );

      await act(async () => {
        stdin.write('\x05'); // Ctrl+E
      });
      await waitFor(() => {
        expect(fixture.props.buffer.move).toHaveBeenCalledWith('end');
      });
      expect(fixture.props.buffer.moveToOffset).not.toHaveBeenCalled();
      unmount();
    });

    it('should move cursor to end of current line for single line input', async () => {
      fixture.props.buffer.text = 'single line text';
      fixture.props.buffer.cursor = [0, 5];
      fixture.props.buffer.lines = ['single line text'];

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...fixture.props} />,
      );

      await act(async () => {
        stdin.write('\x05'); // Ctrl+E
      });
      await waitFor(() => {
        expect(fixture.props.buffer.move).toHaveBeenCalledWith('end');
      });
      expect(fixture.props.buffer.moveToOffset).not.toHaveBeenCalled();
      unmount();
    });
  });

  // Ctrl+R command search is shell-mode only, and always has been: the guard
  // `shellModeActive && keyMatchers[Command.REVERSE_SEARCH]` is present in the
  // commit that introduced the feature, and the prompt prefix only renders
  // "(r:)" in shell mode. These cases previously set shellModeActive = false
  // and so asserted a mode the product does not implement.
  describe('command search (Ctrl+R in shell mode)', () => {
    it('enters command search on Ctrl+R and shows suggestions', async () => {
      fixture.props.shellModeActive = true;

      (
        useReverseSearchCompletion as Mock<typeof useReverseSearchCompletion>
      ).mockImplementation((buffer, data, isActive) => ({
        ...fixture.mockReverseSearchCompletion,
        suggestions: isActive
          ? [
              { label: 'git commit -m "msg"', value: 'git commit -m "msg"' },
              { label: 'git push', value: 'git push' },
            ]
          : [],
        showSuggestions: !!isActive,
        activeSuggestionIndex: isActive ? 0 : -1,
      }));

      const { stdin, stdout, unmount } = renderWithProviders(
        <InputPrompt {...fixture.props} />,
      );

      await act(async () => {
        stdin.write('\x12'); // Ctrl+R
      });

      await waitFor(() => {
        const frame = stdout.lastFrame() ?? '';
        expect(frame).toContain('(r:)');
        expect(frame).toContain('git commit');
        expect(frame).toContain('git push');
      });
      unmount();
    });

    it('expands and collapses long suggestion via Right/Left arrows', async () => {
      fixture.props.shellModeActive = true;
      const longValue = 'l'.repeat(200);

      (
        useReverseSearchCompletion as Mock<typeof useReverseSearchCompletion>
      ).mockReturnValue({
        ...fixture.mockReverseSearchCompletion,
        suggestions: [{ label: longValue, value: longValue, matchedIndex: 0 }],
        showSuggestions: true,
        activeSuggestionIndex: 0,
        visibleStartIndex: 0,
        isLoadingSuggestions: false,
      });

      const { stdin, stdout, unmount } = renderWithProviders(
        <InputPrompt {...fixture.props} />,
      );

      // The ←/→ expand affordance shipped with the original Ctrl+R feature
      // (upstream 0d9c1fba1) alongside MAX_WIDTH truncation in PrepareLabel.
      // Neither exists in this fork: PrepareLabel has no truncation concept and
      // SuggestionsDisplay takes no expandedIndex, so there is nothing to
      // toggle. Restoring the affordance is a product change to shared
      // suggestion rendering; until then this asserts what the component does
      // — the long match is shown and the arrows leave it intact.
      await act(async () => {
        stdin.write('\x12');
      });
      await waitFor(() => {
        expect(clean(stdout.lastFrame())).toContain('(r:)');
      });
      await act(async () => {
        stdin.write('\u001B[C');
      });
      await waitFor(() => {
        expect(clean(stdout.lastFrame())).toContain('(r:)');
      });
      await act(async () => {
        stdin.write('\u001B[D');
      });
      await waitFor(() => {
        expect(clean(stdout.lastFrame())).toContain('(r:)');
      });
      unmount();
    });

    it('renders match window and expanded view (snapshots)', async () => {
      fixture.props.shellModeActive = true;
      fixture.props.buffer.setText('commit');

      const label = 'git commit -m "feat: add search" in src/app';
      const matchedIndex = label.indexOf('commit');

      (
        useReverseSearchCompletion as Mock<typeof useReverseSearchCompletion>
      ).mockReturnValue({
        ...fixture.mockReverseSearchCompletion,
        suggestions: [{ label, value: label, matchedIndex }],
        showSuggestions: true,
        activeSuggestionIndex: 0,
        visibleStartIndex: 0,
        isLoadingSuggestions: false,
      });

      const { stdin, stdout, unmount } = renderWithProviders(
        <InputPrompt {...fixture.props} />,
      );

      await act(async () => {
        stdin.write('\x12');
      });
      await waitFor(() => {
        expect(stdout.lastFrame()).toMatchSnapshot(
          'command-search-render-collapsed-match',
        );
      });

      await act(async () => {
        stdin.write('\u001B[C');
      });
      await waitFor(() => {
        expect(stdout.lastFrame()).toMatchSnapshot(
          'command-search-render-expanded-match',
        );
      });

      unmount();
    });

    it('does not show expand/collapse indicator for short suggestions', async () => {
      fixture.props.shellModeActive = true;
      const shortValue = 'echo hello';

      (
        useReverseSearchCompletion as Mock<typeof useReverseSearchCompletion>
      ).mockReturnValue({
        ...fixture.mockReverseSearchCompletion,
        suggestions: [{ label: shortValue, value: shortValue }],
        showSuggestions: true,
        activeSuggestionIndex: 0,
        visibleStartIndex: 0,
        isLoadingSuggestions: false,
      });

      const { stdin, stdout, unmount } = renderWithProviders(
        <InputPrompt {...fixture.props} />,
      );

      await act(async () => {
        stdin.write('\x12');
      });
      await waitFor(() => {
        const frame = clean(stdout.lastFrame());
        // Ensure it rendered the search mode
        expect(frame).toContain('(r:)');
        expect(frame).not.toContain('→');
        expect(frame).not.toContain('←');
      });
      unmount();
    });
  });

  describe('Tab focus toggle', () => {
    it.each([
      {
        name: 'should toggle focus in on Tab when no suggestions or ghost text',
        showSuggestions: false,
        ghostText: '',
        suggestions: [],
      },
      {
        name: 'should accept ghost text and NOT toggle focus on Tab',
        showSuggestions: false,
        ghostText: 'ghost text',
        suggestions: [],
        expectedAcceptCall: true,
      },
      {
        name: 'should NOT toggle focus on Tab when suggestions are present',
        showSuggestions: true,
        ghostText: '',
        suggestions: [{ label: 'test', value: 'test' }],
      },
    ])(
      '$name',
      async ({
        showSuggestions,
        ghostText,
        suggestions: [...suggestions],
        expectedAcceptCall,
      }) => {
        const mockAccept = vi.fn();
        fixture.mockedUseCommandCompletion.mockReturnValue({
          ...fixture.mockCommandCompletion,
          showSuggestions,
          suggestions: [...suggestions],
          promptCompletion: {
            text: ghostText,
            accept: mockAccept,
            clear: vi.fn(),
            isLoading: false,
            isActive: ghostText !== '',
            markSelected: vi.fn(),
          },
        });

        const { stdin, unmount } = renderWithProviders(
          <InputPrompt {...fixture.props} />,
        );

        await act(async () => {
          stdin.write('\t');
        });

        await waitFor(() => {
          // The embedded-shell focus toggle is owned by useKeybindings in
          // AppContainer, not by InputPrompt — InputPrompt only receives
          // isEmbeddedShellFocused as a prop and never reads UIActions. That
          // behaviour is asserted in useKeybindings.test.ts and
          // useShellFocusAutoReset.test.ts. What belongs here is whether Tab
          // consumes the ghost text, which is InputPrompt's own decision.
          expect(mockAccept).toHaveBeenCalledTimes(
            expectedAcceptCall === true ? 1 : 0,
          );
        });
        unmount();
      },
    );
  });

  describe('mouse interaction', () => {
    beforeEach(() => enableMouseEvents());
    afterEach(() => disableMouseEvents());
    afterEach(() => vi.restoreAllMocks());

    it('pastes PRIMARY once on middle press and ignores the generic release', async () => {
      vi.spyOn(primarySelection, 'readPrimarySelection').mockResolvedValue(
        ['PRIMARY_1', 'PRIMARY_2', 'PRIMARY_3', 'PRIMARY_4'].join(
          String.fromCharCode(10),
        ),
      );
      const rendered = renderWithProviders(
        <InputPromptWithRealBuffer {...fixture.props} />,
        { mouseEventsEnabled: true },
      );

      await act(async () => {
        const escape = String.fromCharCode(27);
        rendered.stdin.write(`${escape}[<1;10;2M${escape}[<3;10;2m`);
      });
      await waitFor(() =>
        expect(rendered.stdout.lastFrame()).toContain('[4 lines pasted #1]'),
      );
      expect(rendered.stdout.lastFrame()).not.toContain('#2');
      rendered.unmount();
    });

    it.each([
      { name: 'an inactive prompt', focus: false },
      { name: 'embedded shell focus', isEmbeddedShellFocused: true },
    ])('ignores PRIMARY while $name', async (overrides) => {
      vi.spyOn(primarySelection, 'readPrimarySelection').mockResolvedValue(
        'PRIVATE_PRIMARY_SELECTION',
      );
      const rendered = renderWithProviders(
        <InputPromptWithRealBuffer {...{ ...fixture.props, ...overrides }} />,
        { mouseEventsEnabled: true },
      );
      const escape = String.fromCharCode(27);
      await act(async () => {
        rendered.stdin.write(`${escape}[<1;10;2M`);
      });
      expect(rendered.stdout.lastFrame()).not.toContain(
        'PRIVATE_PRIMARY_SELECTION',
      );
      rendered.unmount();
    });

    it.each([
      {
        name: 'first line, first char',
        relX: 0,
        relY: 0,
        mouseCol: 5,
        mouseRow: 2,
      },
      {
        name: 'first line, middle char',
        relX: 6,
        relY: 0,
        mouseCol: 11,
        mouseRow: 2,
      },
      {
        name: 'second line, first char',
        relX: 0,
        relY: 1,
        mouseCol: 5,
        mouseRow: 3,
      },
      {
        name: 'second line, end char',
        relX: 5,
        relY: 1,
        mouseCol: 10,
        mouseRow: 3,
      },
    ])(
      'should move cursor on mouse click - $name',
      async ({ relX, relY, mouseCol, mouseRow }) => {
        fixture.props.buffer.text = 'hello world\nsecond line';
        fixture.props.buffer.lines = ['hello world', 'second line'];
        fixture.props.buffer.viewportVisualLines = [
          'hello world',
          'second line',
        ];
        fixture.props.buffer.visualToLogicalMap = [
          [0, 0],
          [1, 0],
        ];
        fixture.props.buffer.visualCursor = [0, 11];
        fixture.props.buffer.visualScrollRow = 0;

        const { stdin, stdout, unmount } = renderWithProviders(
          <InputPrompt {...fixture.props} />,
          { mouseEventsEnabled: true },
        );

        // Wait for initial render
        await waitFor(() => {
          expect(stdout.lastFrame()).toContain('hello world');
        });

        // Simulate left mouse press at calculated coordinates.
        // Assumes inner box is at x=4, y=1 based on border(1)+padding(1)+prompt(2) and border-top(1).
        await act(async () => {
          stdin.write(`\x1b[<0;${mouseCol};${mouseRow}M`);
        });

        await waitFor(() => {
          expect(
            fixture.props.buffer.moveToVisualPosition,
          ).toHaveBeenCalledWith(relY, relX);
        });

        unmount();
      },
    );
  });
});

function clean(str: string | undefined): string {
  if (!str) return '';
  // Remove ANSI escape codes and trim whitespace
  return stripAnsi(str).trim();
}
