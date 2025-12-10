import type { TextareaRenderable } from '@opentui/core';
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { PersistentHistoryService } from './persistentHistory';

type Direction = 'up' | 'down';

export interface UsePromptHistoryOptions {
  /** Optional persistent history service for cross-session history */
  persistentHistory?: PersistentHistoryService | null;
}

/**
 * Calculate which line the cursor is on (0-indexed) based on cursor offset
 */
function getCursorLine(text: string, cursorOffset: number): number {
  const textBeforeCursor = text.slice(0, cursorOffset);
  const newlineMatches = textBeforeCursor.match(/\n/g);
  return newlineMatches ? newlineMatches.length : 0;
}

/**
 * Get the total number of lines in text (1-indexed count)
 */
function getLineCount(text: string): number {
  const newlineMatches = text.match(/\n/g);
  return (newlineMatches ? newlineMatches.length : 0) + 1;
}

export function usePromptHistory(
  textareaRef: RefObject<TextareaRenderable | null>,
  options?: UsePromptHistoryOptions,
): {
  record: (prompt: string) => void;
  handleHistoryKey: (direction: Direction) => boolean;
} {
  // Session entries are stored oldest-first for easy navigation
  const sessionEntries = useRef<string[]>([]);
  // Combined history: persistent (newest-first reversed) + session entries
  const combinedEntries = useRef<string[]>([]);
  const index = useRef<number>(0);
  const lastKey = useRef<{ direction: Direction; time: number } | null>(null);
  const persistentHistoryRef = useRef(options?.persistentHistory);
  // Draft text saved when user starts navigating history
  const draft = useRef<string | null>(null);
  // Track if we're currently navigating history
  const isNavigating = useRef<boolean>(false);

  // Keep ref in sync
  useEffect(() => {
    persistentHistoryRef.current = options?.persistentHistory;
  }, [options?.persistentHistory]);

  // Load persistent history on mount or when service changes
  useEffect(() => {
    const persistent = options?.persistentHistory;
    if (persistent) {
      // Persistent history is newest-first, reverse it for our oldest-first array
      const persistentEntries = [...persistent.getHistory()].reverse();
      combinedEntries.current = [
        ...persistentEntries,
        ...sessionEntries.current,
      ];
      index.current = combinedEntries.current.length;
    } else {
      combinedEntries.current = [...sessionEntries.current];
      index.current = combinedEntries.current.length;
    }
  }, [options?.persistentHistory]);

  const record = useCallback((prompt: string) => {
    // Add to session entries
    sessionEntries.current.push(prompt);

    // Update combined entries
    const persistent = persistentHistoryRef.current;
    if (persistent) {
      const persistentEntries = [...persistent.getHistory()].reverse();
      combinedEntries.current = [
        ...persistentEntries,
        ...sessionEntries.current,
      ];
    } else {
      combinedEntries.current = [...sessionEntries.current];
    }
    index.current = combinedEntries.current.length;

    // Reset navigation state
    draft.current = null;
    isNavigating.current = false;

    // Record to persistent storage (async, fire-and-forget)
    if (persistent) {
      void persistent.record(prompt);
    }
  }, []);

  const applyEntry = useCallback(
    (direction: Direction) => {
      if (combinedEntries.current.length === 0) {
        return false;
      }
      if (textareaRef.current == null) {
        return false;
      }

      const currentText = textareaRef.current.plainText;
      const cursorOffset = textareaRef.current.cursorOffset;
      const cursorLine = getCursorLine(currentText, cursorOffset);
      const totalLines = getLineCount(currentText);

      // Check cursor position requirement:
      // - For "up": cursor must be on the first line (line 0)
      // - For "down": cursor must be on the last line
      if (direction === 'up' && cursorLine !== 0) {
        return false;
      }
      if (direction === 'down' && cursorLine !== totalLines - 1) {
        return false;
      }

      // Save draft when starting to navigate up
      if (!isNavigating.current && direction === 'up') {
        draft.current = currentText;
        isNavigating.current = true;
      }

      if (direction === 'up') {
        index.current = Math.max(0, index.current - 1);
      } else {
        index.current = Math.min(
          combinedEntries.current.length,
          index.current + 1,
        );
      }

      // When navigating down past the end, restore the draft
      if (index.current >= combinedEntries.current.length) {
        const value = draft.current ?? '';
        textareaRef.current.setText(value);
        textareaRef.current.cursorOffset = value.length;
        // Reset navigation state when back at draft
        isNavigating.current = false;
        return true;
      }

      const value = combinedEntries.current[index.current] ?? '';
      textareaRef.current.setText(value);
      textareaRef.current.cursorOffset = value.length;
      return true;
    },
    [textareaRef],
  );

  const handleHistoryKey = useCallback(
    (direction: Direction): boolean => {
      // Down arrow: single press when navigating (on last line)
      if (direction === 'down' && isNavigating.current) {
        return applyEntry(direction);
      }

      // Up arrow: requires double-tap
      const now = Date.now();
      if (
        lastKey.current?.direction === direction &&
        now - lastKey.current.time < 400
      ) {
        const applied = applyEntry(direction);
        lastKey.current = null;
        return applied;
      }
      lastKey.current = { direction, time: now };
      return false;
    },
    [applyEntry],
  );

  return { record, handleHistoryKey };
}
