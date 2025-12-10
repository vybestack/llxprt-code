import type { KeyEvent, TextareaRenderable } from '@opentui/core';
import type { RefObject } from 'react';
import { useKeyboard } from '@opentui/react';
import { useCallback, useEffect, useRef } from 'react';
import { getLogger } from '../lib/logger';

const logger = getLogger('nui:keyboard');

function isEnterKey(key: KeyEvent): boolean {
  // Don't match linefeed (\n / shift+enter) - let textarea handle it as newline
  return (
    key.name === 'return' ||
    key.name === 'enter' ||
    key.name === 'kpenter' ||
    key.name === 'kpplus' ||
    key.sequence === '\r'
  );
}

export function useEnterSubmit(onSubmit: () => void, isBlocked: boolean): void {
  useKeyboard((key) => {
    if (!isEnterKey(key) || isBlocked) return;
    const hasModifier =
      key.shift === true ||
      key.ctrl === true ||
      key.meta === true ||
      key.option === true ||
      key.super === true;
    if (!hasModifier) {
      key.preventDefault();
      onSubmit();
    }
  });
}

export function useFocusAndMount(
  textareaRef: RefObject<TextareaRenderable | null>,
  mountedRef: RefObject<boolean>,
): void {
  useEffect(() => {
    textareaRef.current?.focus();
    return () => {
      mountedRef.current = false;
    };
  }, [mountedRef, textareaRef]);
}

export function useSuggestionKeybindings(
  suggestionCount: number,
  moveSelection: (delta: number) => void,
  handleTabComplete: () => void,
  cancelAll: () => void,
  clearInput: () => Promise<void>,
  isBusy: () => boolean,
  isInputEmpty: () => boolean,
): void {
  const hasSuggestions = suggestionCount > 0;

  // Use refs to avoid stale closures
  const cancelAllRef = useRef(cancelAll);
  const clearInputRef = useRef(clearInput);
  const isBusyRef = useRef(isBusy);
  const isInputEmptyRef = useRef(isInputEmpty);

  useEffect(() => {
    cancelAllRef.current = cancelAll;
  }, [cancelAll]);
  useEffect(() => {
    clearInputRef.current = clearInput;
  }, [clearInput]);
  useEffect(() => {
    isBusyRef.current = isBusy;
  }, [isBusy]);
  useEffect(() => {
    isInputEmptyRef.current = isInputEmpty;
  }, [isInputEmpty]);

  useKeyboard((key) => {
    if (hasSuggestions && key.name === 'down') {
      key.preventDefault();
      moveSelection(1);
    } else if (hasSuggestions && key.name === 'up') {
      key.preventDefault();
      moveSelection(-1);
    } else if (hasSuggestions && key.name === 'tab') {
      key.preventDefault();
      handleTabComplete();
    } else if (key.name === 'escape') {
      const empty = isInputEmptyRef.current();
      const busy = isBusyRef.current();
      logger.debug('Escape pressed', 'inputEmpty:', empty, 'busy:', busy);

      // First Esc clears input if it has text
      // Second Esc (or first if input empty) cancels streaming/tools
      if (!empty) {
        logger.debug('Clearing input');
        void clearInputRef.current();
      } else if (busy) {
        logger.debug('Cancelling all');
        cancelAllRef.current();
      }
    }
  });
}

export function useLineIdGenerator(): () => string {
  const nextLineId = useRef(0);
  return useCallback((): string => {
    nextLineId.current += 1;
    return `line-${nextLineId.current}`;
  }, []);
}

export function useHistoryNavigation(
  modalOpen: boolean,
  suggestionCount: number,
  handleHistoryKey: (direction: 'up' | 'down') => boolean,
): void {
  useKeyboard((key) => {
    if (modalOpen || suggestionCount > 0 || key.eventType !== 'press') {
      return;
    }
    if (key.name === 'up' || key.name === 'down') {
      const handled = handleHistoryKey(key.name);
      if (handled) {
        key.preventDefault();
      }
    }
  });
}
