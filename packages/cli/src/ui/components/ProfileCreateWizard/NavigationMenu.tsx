/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback } from 'react';
import { Box } from 'ink';
import {
  RadioButtonSelect,
  type RadioSelectItem,
} from '../shared/RadioButtonSelect.js';

interface NavigationMenuProps {
  onContinue?: () => void;
  onBack?: () => void;
  onCancel: () => void;
  continueDisabled?: boolean;
  continueLabel?: string;
  showBack?: boolean;
  isFocused?: boolean;
}

export const NavigationMenu: React.FC<NavigationMenuProps> = ({
  onContinue,
  onBack,
  onCancel,
  continueDisabled = false,
  continueLabel = 'Continue',
  showBack = true,
  isFocused = true,
}) => {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const handleSelect = useCallback(
    (value: string) => {
      if (value === 'continue' && onContinue && !continueDisabled) {
        onContinue();
      } else if (value === 'back' && onBack) {
        onBack();
      } else if (value === 'cancel') {
        setShowCancelConfirm(true);
      }
    },
    [onContinue, onBack, continueDisabled],
  );

  const handleCancelConfirm = useCallback(
    (value: string) => {
      if (value === 'yes') {
        onCancel();
      } else {
        setShowCancelConfirm(false);
      }
    },
    [onCancel],
  );

  if (showCancelConfirm) {
    const confirmItems: Array<RadioSelectItem<string>> = [
      { label: 'No, continue editing', value: 'no', key: 'no' },
      { label: 'Yes, discard and exit', value: 'yes', key: 'yes' },
    ];

    return (
      <Box marginTop={1}>
        <RadioButtonSelect
          items={confirmItems}
          onSelect={handleCancelConfirm}
          isFocused={isFocused}
        />
      </Box>
    );
  }

  const items: Array<RadioSelectItem<string>> = [];

  if (onContinue) {
    items.push({
      label: continueDisabled ? `${continueLabel} (disabled)` : continueLabel,
      value: 'continue',
      key: 'continue',
    });
  }

  if (onBack && showBack) {
    items.push({ label: 'Back', value: 'back', key: 'back' });
  }

  items.push({ label: 'Cancel', value: 'cancel', key: 'cancel' });

  return (
    <Box marginTop={1}>
      <RadioButtonSelect
        items={items}
        onSelect={handleSelect}
        isFocused={isFocused}
      />
    </Box>
  );
};
