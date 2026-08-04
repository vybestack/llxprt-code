/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared behavioural fixtures for the Windows Ctrl+Enter steering tests
 * (issue #2951). These fixtures intentionally use only `import type` for the
 * production interfaces so that importing this helper does NOT load the
 * key-matcher module graph — the platform must be pinned in the test process
 * before `inputPromptKeyHandlers` (and transitively `keyMatchers`) is loaded.
 */

import type { TextBuffer } from '../src/ui/components/shared/text-buffer.js';
import type { Key } from '../src/ui/contexts/KeypressContext.js';
import type { InputHandlerDeps } from '../src/ui/components/inputPromptKeyHandlers.js';
import type { UseCommandCompletionReturn } from '../src/ui/hooks/useCommandCompletion.js';
import type { UseReverseSearchCompletionReturn } from '../src/ui/hooks/useReverseSearchCompletion.js';
import type { UseShellPathCompletionReturn } from '../src/ui/hooks/useShellPathCompletion.js';

/**
 * Load `inputPromptKeyHandlers` (and transitively `keyMatchers` ->
 * `resolveKeyBindings`) with `process.platform` pinned to `platform`.
 *
 * `keyMatchers` resolves the platform ONCE, at module-evaluation time, so the
 * pin only has to span the import itself. It is restored in `finally`, which
 * means the process-global mutation is scoped to a single `await` and survives
 * neither a successful import nor a module-initialisation throw. That removes
 * any dependence on test ordering, runner process reuse, or `afterAll` running.
 */
export async function loadKeyHandlerForPlatform(
  platform: NodeJS.Platform,
): Promise<
  typeof import('../src/ui/components/inputPromptKeyHandlers.js').handleInputKey
> {
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
  try {
    const { handleInputKey } = await import(
      '../src/ui/components/inputPromptKeyHandlers.js'
    );
    return handleInputKey;
  } finally {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
  }
}

/**
 * Any TextBuffer method the steering dispatch path is not expected to touch
 * throws instead of silently succeeding, so a future change that starts
 * calling it fails loudly rather than producing a false positive.
 */
function unexpectedCall(method: string): never {
  throw new Error(
    `FakeTextBuffer.${method}() was called, but the steering dispatch path is ` +
      `not expected to use it. If this is now legitimate, implement real ` +
      `behaviour for it in steerKey.fixture.ts.`,
  );
}

/**
 * A minimal TextBuffer with REAL behaviour for the state and actions the
 * steering dispatch path observes (`text`, `setText`, `newline`,
 * `backspace`, `lines`, `cursor`, visual-layout reads); every other method
 * throws (see {@link unexpectedCall}). Tests assert on the resulting buffer
 * STATE (`text` / `lines`) rather than on which methods were invoked.
 */
export class FakeTextBuffer implements TextBuffer {
  private _lines: string[];

  constructor(initialText = '') {
    this._lines = initialText.length === 0 ? [''] : initialText.split('\n');
  }

  get lines(): string[] {
    return this._lines;
  }

  get text(): string {
    return this._lines.join('\n');
  }

  get cursor(): [number, number] {
    const row = this._lines.length - 1;
    return [row, this._lines[row].length];
  }

  preferredCol: number | null = null;
  selectionAnchor: [number, number] | null = null;
  readonly allVisualLines: string[] = [''];
  readonly viewportVisualLines: string[] = [''];
  readonly visualCursor: [number, number] = [0, 0];
  readonly visualScrollRow = 0;
  readonly visualToLogicalMap: Array<[number, number]> = [[0, 0]];
  readonly transformationsByLine = [];
  readonly visualToTransformedMap: number[] = [0];

  setText(text: string): void {
    this._lines = text.length === 0 ? [''] : text.split('\n');
  }

  insert(): void {
    unexpectedCall('insert');
  }

  newline(): void {
    this._lines = [...this._lines, ''];
  }

  backspace(): void {
    const row = this._lines.length - 1;
    const line = this._lines[row];
    if (line.length > 0) {
      this._lines[row] = line.slice(0, -1);
    } else if (this._lines.length > 1) {
      this._lines = this._lines.slice(0, -1);
    }
  }

  del(): void {
    unexpectedCall('del');
  }
  move(): void {
    unexpectedCall('move');
  }
  undo(): void {
    unexpectedCall('undo');
  }
  redo(): void {
    unexpectedCall('redo');
  }
  replaceRange(): void {
    unexpectedCall('replaceRange');
  }
  deleteWordLeft(): void {
    unexpectedCall('deleteWordLeft');
  }
  deleteWordRight(): void {
    unexpectedCall('deleteWordRight');
  }
  killLineRight(): void {
    unexpectedCall('killLineRight');
  }
  killLineLeft(): void {
    unexpectedCall('killLineLeft');
  }
  handleInput(): void {
    unexpectedCall('handleInput');
  }
  openInExternalEditor(): Promise<void> {
    unexpectedCall('openInExternalEditor');
  }
  replaceRangeByOffset(): void {
    unexpectedCall('replaceRangeByOffset');
  }
  getOffset(): number {
    unexpectedCall('getOffset');
  }
  moveToOffset(): void {
    unexpectedCall('moveToOffset');
  }
  moveToVisualPosition(): void {
    unexpectedCall('moveToVisualPosition');
  }

  vimDeleteWordForward(): void {
    unexpectedCall('vimDeleteWordForward');
  }
  vimDeleteWordBackward(): void {
    unexpectedCall('vimDeleteWordBackward');
  }
  vimDeleteWordEnd(): void {
    unexpectedCall('vimDeleteWordEnd');
  }
  vimChangeWordForward(): void {
    unexpectedCall('vimChangeWordForward');
  }
  vimChangeWordBackward(): void {
    unexpectedCall('vimChangeWordBackward');
  }
  vimChangeWordEnd(): void {
    unexpectedCall('vimChangeWordEnd');
  }
  vimDeleteLine(): void {
    unexpectedCall('vimDeleteLine');
  }
  vimChangeLine(): void {
    unexpectedCall('vimChangeLine');
  }
  vimDeleteToEndOfLine(): void {
    unexpectedCall('vimDeleteToEndOfLine');
  }
  vimChangeToEndOfLine(): void {
    unexpectedCall('vimChangeToEndOfLine');
  }
  vimChangeMovement(): void {
    unexpectedCall('vimChangeMovement');
  }
  vimMoveLeft(): void {
    unexpectedCall('vimMoveLeft');
  }
  vimMoveRight(): void {
    unexpectedCall('vimMoveRight');
  }
  vimMoveUp(): void {
    unexpectedCall('vimMoveUp');
  }
  vimMoveDown(): void {
    unexpectedCall('vimMoveDown');
  }
  vimMoveWordForward(): void {
    unexpectedCall('vimMoveWordForward');
  }
  vimMoveWordBackward(): void {
    unexpectedCall('vimMoveWordBackward');
  }
  vimMoveWordEnd(): void {
    unexpectedCall('vimMoveWordEnd');
  }
  vimDeleteChar(): void {
    unexpectedCall('vimDeleteChar');
  }
  vimInsertAtCursor(): void {
    unexpectedCall('vimInsertAtCursor');
  }
  vimAppendAtCursor(): void {
    unexpectedCall('vimAppendAtCursor');
  }
  vimOpenLineBelow(): void {
    unexpectedCall('vimOpenLineBelow');
  }
  vimOpenLineAbove(): void {
    unexpectedCall('vimOpenLineAbove');
  }
  vimAppendAtLineEnd(): void {
    unexpectedCall('vimAppendAtLineEnd');
  }
  vimInsertAtLineStart(): void {
    unexpectedCall('vimInsertAtLineStart');
  }
  vimMoveToLineStart(): void {
    unexpectedCall('vimMoveToLineStart');
  }
  vimMoveToLineEnd(): void {
    unexpectedCall('vimMoveToLineEnd');
  }
  vimMoveToFirstNonWhitespace(): void {
    unexpectedCall('vimMoveToFirstNonWhitespace');
  }
  vimMoveToFirstLine(): void {
    unexpectedCall('vimMoveToFirstLine');
  }
  vimMoveToLastLine(): void {
    unexpectedCall('vimMoveToLastLine');
  }
  vimMoveToLine(): void {
    unexpectedCall('vimMoveToLine');
  }
  vimEscapeInsertMode(): void {
    unexpectedCall('vimEscapeInsertMode');
  }
}

/**
 * The complete keypress object that `parseNonEscapeKey` actually produces for
 * the bare line feed (0x0A) a Windows console emits for Ctrl+Enter: the name
 * is normalised to `'j'` with `ctrl: true`, while `sequence` still carries the
 * raw `'
'` byte. Both are reproduced here so the fixture stays aligned with
 * production behaviour if downstream code ever reads `sequence`.
 */
export const windowsCtrlEnterKey: Key = {
  name: 'j',
  ctrl: true,
  meta: false,
  shift: false,
  sequence: '\n',
};

/** A plain Enter key (no modifiers) used to prove SUBMIT is undisturbed. */
export const plainEnterKey: Key = {
  name: 'return',
  ctrl: false,
  meta: false,
  shift: false,
  sequence: '\r',
};

function makeCompletion(): UseCommandCompletionReturn {
  return {
    suggestions: [],
    activeSuggestionIndex: -1,
    visibleStartIndex: 0,
    showSuggestions: false,
    isLoadingSuggestions: false,
    isPerfectMatch: false,
    activeHint: '',
    setActiveSuggestionIndex: () => {},
    setShowSuggestions: () => {},
    resetCompletionState: () => {},
    navigateUp: () => {},
    navigateDown: () => {},
    handleAutocomplete: () => undefined,
    promptCompletion: {
      text: '',
      isLoading: false,
      isActive: false,
      accept: () => {},
      clear: () => {},
      markSelected: () => {},
    },
    getCommandFromSuggestion: () => null,
    isArgumentCompletion: false,
    leafCommand: null,
  };
}

function makeReverseSearchCompletion(): UseReverseSearchCompletionReturn {
  return {
    suggestions: [],
    activeSuggestionIndex: -1,
    visibleStartIndex: 0,
    showSuggestions: false,
    isLoadingSuggestions: false,
    navigateUp: () => {},
    navigateDown: () => {},
    handleAutocomplete: () => {},
    resetCompletionState: () => {},
  };
}

function makeShellPathCompletion(): UseShellPathCompletionReturn {
  return {
    suggestions: [],
    activeSuggestionIndex: -1,
    visibleStartIndex: 0,
    showSuggestions: false,
    isLoadingSuggestions: false,
    navigateUp: () => {},
    navigateDown: () => {},
    handleAutocomplete: () => {},
    resetCompletionState: () => {},
  };
}

export interface FixtureCallbacks {
  handleSubmit?: (value: string) => void;
  handleSteer?: (text: string) => boolean;
  steerAllQueuedSubmissions?: () => void;
  sendAllQueuedSubmissions?: () => void;
  queuedSubmissionCount?: number;
}

/**
 * Build a complete `InputHandlerDeps` wired to recording callbacks. The buffer
 * is the real `FakeTextBuffer`; completion/reverse-search/shell-path objects
 * are inert shapes with `showSuggestions: false` so the dispatch reaches the
 * submit/steer/newline branches.
 */
export function makeDeps(
  buffer: FakeTextBuffer,
  callbacks: FixtureCallbacks = {},
): InputHandlerDeps {
  return {
    focus: true,
    buffer,
    completion: makeCompletion(),
    shellModeActive: false,
    setShellModeActive: () => {},
    onClearScreen: () => {},
    inputHistory: { navigateUp: () => {}, navigateDown: () => {} },
    handleSubmitAndClear: () => {},
    handleSubmit:
      callbacks.handleSubmit ??
      (() => {
        /* no-op by default */
      }),
    handleSteer: callbacks.handleSteer,
    shellHistory: {
      getPreviousCommand: () => null,
      getNextCommand: () => null,
    },
    reverseSearchCompletion: makeReverseSearchCompletion(),
    shellPathCompletion: makeShellPathCompletion(),
    handleClipboardPaste: () => Promise.resolve(),
    resetCompletionState: () => {},
    escPressCount: { current: 0 },
    showEscapePrompt: false,
    setShowEscapePrompt: () => {},
    escapeTimerRef: { current: null },
    resetEscapeState: () => {},
    vimHandleInput: undefined,
    reverseSearchActive: false,
    setReverseSearchActive: () => {},
    setTextBeforeReverseSearch: () => {},
    textBeforeReverseSearch: '',
    setCursorPosition: () => {},
    cursorPosition: [0, 0],
    nextPlaceholderIdRef: { current: 0 },
    pendingLargePastesRef: { current: new Map<string, string>() },
    queuedSubmissionCount: callbacks.queuedSubmissionCount,
    sendAllQueuedSubmissions: callbacks.sendAllQueuedSubmissions,
    steerAllQueuedSubmissions: callbacks.steerAllQueuedSubmissions,
  };
}
