import { useEffect, useRef, useState } from 'react';
import { useKeyboard } from '@vybestack/opentui-react';
import type { ToolApprovalOutcome } from '../ui/components/ChatLayout';
import { getLogger } from '../lib/logger';

const logger = getLogger('nui:approval-keyboard');

function isPrintableKeyName(keyName: string): boolean {
  return keyName.length === 1;
}

function shouldHandleEditedCommandInput(
  keyName: string,
  keySequence?: string,
): boolean {
  return (
    isPrintableKeyName(keyName) ||
    keySequence === ' ' ||
    keyName === 'backspace' ||
    keyName === 'delete'
  );
}

function applyEditedCommandKey(
  keyName: string,
  keySequence: string | undefined,
  currentValue: string,
): string {
  if (keyName === 'backspace' || keyName === 'delete') {
    return currentValue.slice(0, -1);
  }
  if (isPrintableKeyName(keyName)) {
    return currentValue + keyName;
  }
  if (keySequence === ' ') {
    return currentValue + ' ';
  }
  return currentValue;
}

/** Approval options in order */
const APPROVAL_OPTIONS: ToolApprovalOutcome[] = [
  'allow_once',
  'allow_always',
  'suggest_edit',
  'cancel',
];

interface UseApprovalKeyboardOptions {
  /** Whether approval is currently active */
  isActive: boolean;
  /** Whether "allow always" option is available */
  canAllowAlways: boolean;
  /** Whether "suggest edit" option is available */
  canSuggestEdit: boolean;
  /** Current edited command text for suggest-edit */
  editedCommand?: string;
  /** Callback when edited command changes */
  onEditedCommandChange?: (command: string) => void;
  /** Callback when user selects an option */
  onSelect: (outcome: ToolApprovalOutcome) => void;
  /** Callback when user cancels (Esc) */
  onCancel: () => void;
}

interface UseApprovalKeyboardResult {
  /** Currently selected index */
  selectedIndex: number;
  /** Currently selected outcome */
  selectedOutcome: ToolApprovalOutcome | undefined;
}

/**
 * Hook to handle keyboard navigation for inline tool approval.
 * Captures arrow keys and enter when approval is active.
 */
export function useApprovalKeyboard(
  options: UseApprovalKeyboardOptions,
): UseApprovalKeyboardResult {
  const {
    isActive,
    canAllowAlways,
    canSuggestEdit,
    editedCommand,
    onEditedCommandChange,
    onSelect,
    onCancel,
  } = options;
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Use refs to avoid stale closures in keyboard handler
  const isActiveRef = useRef(isActive);
  const canAllowAlwaysRef = useRef(canAllowAlways);
  const canSuggestEditRef = useRef(canSuggestEdit);
  const editedCommandRef = useRef(editedCommand);
  const onEditedCommandChangeRef = useRef(onEditedCommandChange);
  const onSelectRef = useRef(onSelect);
  const onCancelRef = useRef(onCancel);
  const selectedIndexRef = useRef(selectedIndex);

  // Keep refs in sync
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);
  useEffect(() => {
    canAllowAlwaysRef.current = canAllowAlways;
  }, [canAllowAlways]);
  useEffect(() => {
    canSuggestEditRef.current = canSuggestEdit;
  }, [canSuggestEdit]);
  useEffect(() => {
    editedCommandRef.current = editedCommand;
  }, [editedCommand]);
  useEffect(() => {
    onEditedCommandChangeRef.current = onEditedCommandChange;
  }, [onEditedCommandChange]);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);
  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  // Get available options based on confirmation capabilities
  const availableOptions = APPROVAL_OPTIONS.filter((option) => {
    if (option === 'allow_always') {
      return canAllowAlways;
    }
    if (option === 'suggest_edit') {
      return canSuggestEdit;
    }
    return true;
  });

  const optionCount = availableOptions.length;

  // Reset selection when approval becomes active
  useEffect(() => {
    if (isActive) {
      setSelectedIndex(0);
    }
  }, [isActive]);

  // Clamp selection when available options change
  useEffect(() => {
    if (selectedIndex >= optionCount) {
      setSelectedIndex(optionCount > 0 ? optionCount - 1 : 0);
    }
  }, [optionCount, selectedIndex]);

  // Use useKeyboard hook to intercept keys when approval is active
  useKeyboard((key) => {
    logger.debug('key received', key.name, 'isActive:', isActiveRef.current);
    if (!isActiveRef.current || key.eventType !== 'press') {
      return;
    }

    const currentCanAllowAlways = canAllowAlwaysRef.current;
    const currentCanSuggestEdit = canSuggestEditRef.current;
    const currentOptions = APPROVAL_OPTIONS.filter((option) => {
      if (option === 'allow_always') {
        return currentCanAllowAlways;
      }
      if (option === 'suggest_edit') {
        return currentCanSuggestEdit;
      }
      return true;
    });
    const currentOptionCount = currentOptions.length;

    if (currentOptionCount === 0) {
      return;
    }

    const currentSelectedOutcome = currentOptions[selectedIndexRef.current];
    if (
      currentSelectedOutcome === 'suggest_edit' &&
      shouldHandleEditedCommandInput(key.name, key.sequence)
    ) {
      const nextValue = applyEditedCommandKey(
        key.name,
        key.sequence,
        editedCommandRef.current ?? '',
      );
      editedCommandRef.current = nextValue;
      onEditedCommandChangeRef.current?.(nextValue);
      key.preventDefault();
      return;
    }

    let handled = false;

    switch (key.name) {
      case 'up':
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : currentOptionCount - 1,
        );
        handled = true;
        break;
      case 'down':
        setSelectedIndex((prev) =>
          prev < currentOptionCount - 1 ? prev + 1 : 0,
        );
        handled = true;
        break;
      case 'return':
      case 'kpenter': {
        const outcome = currentOptions[selectedIndexRef.current];
        logger.debug(
          'Enter pressed',
          'selectedIndex:',
          selectedIndexRef.current,
          'outcome:',
          outcome,
        );
        onSelectRef.current(outcome);
        handled = true;
        break;
      }
      case 'escape':
        logger.debug('Escape pressed, calling onCancel');
        onCancelRef.current();
        handled = true;
        break;
      case '1':
      case '2':
      case '3':
      case '4': {
        const numericIndex = parseInt(key.name, 10) - 1;
        if (numericIndex >= 0 && numericIndex < currentOptionCount) {
          const outcome = currentOptions[numericIndex];
          logger.debug(key.name + ' pressed, selecting', outcome);
          onSelectRef.current(outcome);
          handled = true;
        }
        break;
      }
    }

    if (handled) {
      key.preventDefault();
    }
  });

  return {
    selectedIndex,
    selectedOutcome: availableOptions[selectedIndex],
  };
}
