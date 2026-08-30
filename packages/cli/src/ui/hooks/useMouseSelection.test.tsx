/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useEffect, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import { Box, Text, useApp, type DOMElement, type Selection } from 'ink';
import { EventEmitter } from 'node:events';
import { render } from '../../test-utils/render.js';
import { Colors } from '../colors.js';
import { MouseProvider } from '../contexts/MouseContext.js';
import { ScrollProvider } from '../contexts/ScrollProvider.js';

const actualInk = { ...(await import('ink')) };
const mockUseStdin = vi.fn();
void vi.mock('ink', () => ({
  ...actualInk,
  useStdin: mockUseStdin,
}));

void vi.mock('../utils/clipboard.js', () => ({
  copyTextToClipboard: async (): Promise<{
    success: true;
    text: string;
  }> => ({ success: true, text: '' }),
}));

const { useMouseSelection } = await import('./useMouseSelection.js');

const SELECTABLE_TEXT = 'selection target';
const activeRenders = new Set<ReturnType<typeof render>>();

function unmountActiveHarnesses(): void {
  for (const rendered of activeRenders) {
    rendered.unmount();
  }
  activeRenders.clear();
}

class MockStdin extends EventEmitter {
  write(text: string): void {
    this.emit('data', text);
  }
}

interface SelectionSurfaceProps {
  readonly enabled: boolean;
  readonly hasSelectableText: boolean;
  readonly onCopiedText: (text: string) => void;
  readonly captureSelection: (selection: Selection | undefined) => void;
}

function SelectionSurface({
  enabled,
  hasSelectableText,
  onCopiedText,
  captureSelection,
}: SelectionSurfaceProps): React.ReactElement {
  const rootRef = useRef<DOMElement | null>(null);
  const { selection } = useApp();

  useMouseSelection({ enabled, rootRef, onCopiedText });
  useEffect(() => {
    captureSelection(selection);
  }, [captureSelection, selection]);

  return (
    <Box ref={rootRef}>
      {hasSelectableText ? (
        <Text color={Colors.Foreground}>{SELECTABLE_TEXT}</Text>
      ) : null}
    </Box>
  );
}

interface SelectionHarness {
  readonly stdin: MockStdin;
  readonly copiedTexts: string[];
  readonly getSelection: () => Selection;
  readonly setEnabled: (enabled: boolean) => void;
}

function renderSelectionHarness({
  enabled = true,
  hasSelectableText = true,
}: {
  readonly enabled?: boolean;
  readonly hasSelectableText?: boolean;
} = {}): SelectionHarness {
  // Only one harness may be mounted at a time. `useStdin` is a single shared
  // mock, so a second harness would repoint it while the first tree is still
  // live, and any re-render of that tree would hand its MouseProvider the
  // wrong stdin — cross-wiring the two harnesses' event subscriptions.
  unmountActiveHarnesses();

  const copiedTexts: string[] = [];
  const stdin = new MockStdin();
  let selection: Selection | undefined;
  mockUseStdin.mockReturnValue({
    stdin,
    setRawMode: vi.fn(),
  });

  const captureSelection = (current: Selection | undefined): void => {
    selection = current;
  };
  const onCopiedText = (text: string): void => {
    copiedTexts.push(text);
  };
  const tree = (currentEnabled: boolean): React.ReactElement => (
    <MouseProvider mouseEventsEnabled={true}>
      <ScrollProvider>
        <SelectionSurface
          enabled={currentEnabled}
          hasSelectableText={hasSelectableText}
          onCopiedText={onCopiedText}
          captureSelection={captureSelection}
        />
      </ScrollProvider>
    </MouseProvider>
  );

  const rendered = render(tree(enabled));
  activeRenders.add(rendered);

  return {
    stdin,
    copiedTexts,
    getSelection: (): Selection => {
      if (!selection) {
        throw new Error('Ink did not provide its Selection instance');
      }
      return selection;
    },
    setEnabled: (nextEnabled: boolean): void => {
      rendered.rerender(tree(nextEnabled));
    },
  };
}

function sgrSequence(
  buttonCode: number,
  col: number,
  row: number,
  action: 'M' | 'm' = 'M',
): string {
  return `\x1b[<${buttonCode};${col};${row}${action}`;
}

function dragAcrossText(
  stdin: SelectionHarness['stdin'],
  startCol: number,
  endCol: number,
): void {
  stdin.write(sgrSequence(0, startCol, 1));
  stdin.write(sgrSequence(32, endCol, 1));
  stdin.write(sgrSequence(0, endCol, 1, 'm'));
}

afterEach(() => {
  unmountActiveHarnesses();
  vi.clearAllMocks();
});

describe('useMouseSelection', () => {
  it('copies the characters spanned by a press, move, and release drag (AC6.9)', () => {
    const harness = renderSelectionHarness();

    dragAcrossText(harness.stdin, 2, 7);

    expect(harness.getSelection().toString()).toBe('elect');
    expect(harness.copiedTexts).toStrictEqual(['elect']);
  });

  it('leaves selection unchanged when move arrives without a preceding press (AC6.10)', () => {
    const control = renderSelectionHarness();
    dragAcrossText(control.stdin, 2, 7);
    expect(control.getSelection().toString()).toBe('elect');

    const harness = renderSelectionHarness();
    harness.stdin.write(sgrSequence(32, 7, 1));

    expect(harness.getSelection().toString()).toBe('');
    expect(harness.copiedTexts).toStrictEqual([]);
  });

  it('does not copy a drag over a surface with nothing selectable (AC6.11)', () => {
    const control = renderSelectionHarness();
    dragAcrossText(control.stdin, 2, 7);
    expect(control.getSelection().toString()).toBe('elect');

    const harness = renderSelectionHarness({ hasSelectableText: false });
    dragAcrossText(harness.stdin, 2, 7);

    expect(harness.getSelection().toString()).toBe('');
    expect(harness.copiedTexts).toStrictEqual([]);
  });

  it('does not copy a collapsed drag that selects no characters (AC6.11)', () => {
    const harness = renderSelectionHarness();

    // Press and release on the same cell over real text. A range exists, so
    // the copy path runs to completion and the empty-text guard — not an
    // early return on a missing selection point — is what suppresses the copy.
    harness.stdin.write(sgrSequence(0, 2, 1));
    harness.stdin.write(sgrSequence(0, 2, 1, 'm'));

    expect(harness.getSelection().rangeCount).toBe(1);
    expect(harness.getSelection().toString()).toBe('');
    expect(harness.copiedTexts).toStrictEqual([]);
  });

  it('clears selection when disabled and ignores subsequent mouse events (AC6.12)', () => {
    const harness = renderSelectionHarness();
    dragAcrossText(harness.stdin, 2, 7);
    expect(harness.getSelection().toString()).toBe('elect');
    expect(harness.copiedTexts).toStrictEqual(['elect']);

    harness.setEnabled(false);
    expect(harness.getSelection().toString()).toBe('');

    dragAcrossText(harness.stdin, 3, 8);
    expect(harness.getSelection().toString()).toBe('');
    expect(harness.copiedTexts).toStrictEqual(['elect']);
  });
});
