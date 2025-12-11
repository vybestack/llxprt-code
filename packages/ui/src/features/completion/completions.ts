import type { TextareaRenderable } from '@vybestack/opentui-core';
import { useCallback, useState, useRef, type RefObject } from 'react';
import {
  extractMentionQuery,
  findMentionRange,
  getSuggestions,
  MAX_SUGGESTION_COUNT,
} from './suggestions';
import { extractSlashContext, getSlashSuggestions } from './slash';

type CompletionMode = 'none' | 'mention' | 'slash';

export interface CompletionSuggestion {
  value: string;
  description?: string;
  insertText: string;
  mode: Exclude<CompletionMode, 'none'>;
  displayPrefix?: boolean;
  hasChildren?: boolean;
}

const SLASH_SUGGESTION_LIMIT = 50;

export function useCompletionManager(
  textareaRef: RefObject<TextareaRenderable | null>,
) {
  const [suggestions, setSuggestions] = useState<CompletionSuggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const slashContext = useRef<{ start: number; end: number } | null>(null);
  const reset = useCallback(() => {
    slashContext.current = null;
    setSuggestions([]);
    setSelectedIndex(0);
  }, []);
  const refresh = useCallback(() => {
    const editor = textareaRef.current;
    if (editor == null) {
      return;
    }
    const text = editor.plainText;
    const cursor = editor.cursorOffset;
    const slash = extractSlashContext(text, cursor);
    if (slash) {
      slashContext.current = { start: slash.start, end: slash.end };
      setSuggestions(buildSlashCompletions(slash.parts));
      setSelectedIndex(0);
      return;
    }
    const mention = extractMentionQuery(text, cursor);
    if (mention !== null) {
      slashContext.current = null;
      setSuggestions(buildMentionCompletions(mention));
      setSelectedIndex(0);
      return;
    }
    reset();
  }, [reset, textareaRef]);
  const moveSelection = useCallback(
    (delta: number) => {
      if (suggestions.length === 0) {
        return;
      }
      setSelectedIndex((prev) => {
        const next = prev + delta;
        if (next < 0) {
          return 0;
        }
        if (next >= suggestions.length) {
          return suggestions.length - 1;
        }
        return next;
      });
    },
    [suggestions.length],
  );
  const applySelection = useCallback(() => {
    const editor = textareaRef.current;
    if (editor == null) {
      return;
    }
    const current = suggestions[selectedIndex];
    if (!current) {
      return;
    }
    if (current.mode === 'mention') {
      applyMentionCompletion(editor, current);
      reset();
      return;
    }
    // current.mode === "slash" at this point
    if (slashContext.current == null) {
      return;
    }
    applySlashCompletion(editor, slashContext.current, current);
    slashContext.current = null;
    if (current.hasChildren ?? false) {
      refresh();
    } else {
      reset();
    }
  }, [refresh, reset, selectedIndex, suggestions, textareaRef]);
  return {
    suggestions,
    selectedIndex,
    refresh,
    clear: reset,
    moveSelection,
    applySelection,
  };
}

function buildSlashCompletions(parts: string[]): CompletionSuggestion[] {
  const isRoot = parts.length <= 1;
  return getSlashSuggestions(parts, SLASH_SUGGESTION_LIMIT).map(
    (suggestion) => ({
      value: suggestion.value,
      description: suggestion.description,
      insertText: suggestion.fullPath,
      mode: 'slash' as const,
      displayPrefix: isRoot,
      hasChildren: suggestion.hasChildren,
    }),
  );
}

function buildMentionCompletions(query: string): CompletionSuggestion[] {
  return getSuggestions(query, MAX_SUGGESTION_COUNT).map((value) => ({
    value,
    insertText: value,
    mode: 'mention' as const,
  }));
}

function applyMentionCompletion(
  editor: TextareaRenderable,
  suggestion: CompletionSuggestion,
): void {
  const range = findMentionRange(editor.plainText, editor.cursorOffset);
  if (!range) {
    return;
  }
  const before = editor.plainText.slice(0, range.start);
  const after = editor.plainText.slice(range.end);
  const completion = `${suggestion.insertText} `;
  const nextText = `${before}${completion}${after}`;
  editor.setText(nextText);
  editor.cursorOffset = (before + completion).length;
}

function applySlashCompletion(
  editor: TextareaRenderable,
  context: { start: number; end: number },
  suggestion: CompletionSuggestion,
): void {
  const before = editor.plainText.slice(0, context.start);
  const after = editor.plainText.slice(context.end);
  const completion = `${suggestion.insertText} `;
  const nextText = `${before}${completion}${after}`;
  editor.setText(nextText);
  editor.cursorOffset = (before + completion).length;
}
