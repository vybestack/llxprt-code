import { useEffect, useRef, useState } from 'react';
import { useKeyboard } from '@vybestack/opentui-react';
import type { ToolApprovalOutcome } from '../ui/components/ChatLayout';
import { getLogger } from '../lib/logger';

const logger = getLogger('nui:approval-keyboard');

/** Approval options in order */
const APPROVAL_OPTIONS: ToolApprovalOutcome[] = [
  'allow_once',
  'allow_always',
  'cancel',
];

interface UseApprovalKeyboardOptions {
  /** Whether approval is currently active */
  isActive: boolean;
  /** Whether "allow always" option is available */
  canAllowAlways: boolean;
  /** Callback when user selects an option */
  onSelect: (outcome: ToolApprovalOutcome) => void;
  /** Callback when user cancels (Esc) */
  onCancel: () => void;
}

interface UseApprovalKeyboardResult {
  /** Currently selected index */
  selectedIndex: number;
  /** Total number of options */
  optionCount: number;
}

/**
 * Hook to handle keyboard navigation for inline tool approval.
 * Captures arrow keys and enter when approval is active.
 */
export function useApprovalKeyboard(
  options: UseApprovalKeyboardOptions,
): UseApprovalKeyboardResult {
  const { isActive, canAllowAlways, onSelect, onCancel } = options;
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Use refs to avoid stale closures in keyboard handler
  const isActiveRef = useRef(isActive);
  const canAllowAlwaysRef = useRef(canAllowAlways);
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
    onSelectRef.current = onSelect;
  }, [onSelect]);
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);
  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  // Get available options based on canAllowAlways
  const availableOptions = canAllowAlways
    ? APPROVAL_OPTIONS
    : APPROVAL_OPTIONS.filter((o) => o !== 'allow_always');

  const optionCount = availableOptions.length;

  // Reset selection when approval becomes active
  useEffect(() => {
    if (isActive) {
      setSelectedIndex(0);
    }
  }, [isActive]);

  // Use useKeyboard hook to intercept keys when approval is active
  useKeyboard((key) => {
    logger.debug('key received', key.name, 'isActive:', isActiveRef.current);
    if (!isActiveRef.current) return;

    const currentCanAllowAlways = canAllowAlwaysRef.current;
    const currentOptions = currentCanAllowAlways
      ? APPROVAL_OPTIONS
      : APPROVAL_OPTIONS.filter((o) => o !== 'allow_always');
    const currentOptionCount = currentOptions.length;

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
        if (outcome) {
          onSelectRef.current(outcome);
        }
        handled = true;
        break;
      }
      case 'escape':
        logger.debug('Escape pressed, calling onCancel');
        onCancelRef.current();
        handled = true;
        break;
      case '1':
        logger.debug('1 pressed, selecting allow_once');
        onSelectRef.current('allow_once');
        handled = true;
        break;
      case '2':
        if (currentCanAllowAlways) {
          onSelectRef.current('allow_always');
        } else {
          onSelectRef.current('cancel');
        }
        handled = true;
        break;
      case '3':
        if (currentCanAllowAlways) {
          onSelectRef.current('cancel');
          handled = true;
        }
        break;
    }

    if (handled) {
      key.preventDefault();
    }
  });

  return {
    selectedIndex,
    optionCount,
  };
}
