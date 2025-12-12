import React from 'react';
import { useKeyboard } from '@vybestack/opentui-react';
import type { ThemeDefinition } from '../../features/theme';
import { useListNavigation } from '../../hooks/useListNavigation';

export interface RadioSelectOption<T> {
  readonly label: string;
  readonly value: T;
  readonly key: string;
}

export interface RadioSelectProps<T> {
  readonly options: RadioSelectOption<T>[];
  readonly onSelect: (value: T) => void;
  readonly theme?: ThemeDefinition;
  readonly isFocused?: boolean;
  readonly initialIndex?: number;
}

export function RadioSelect<T>(props: RadioSelectProps<T>): React.ReactNode {
  const {
    options,
    onSelect,
    theme,
    isFocused = true,
    initialIndex = 0,
  } = props;
  const { selectedIndex, moveSelection, setSelectedIndex } = useListNavigation(
    options.length,
  );

  // Initialize to initialIndex on first render
  if (
    selectedIndex === 0 &&
    initialIndex !== 0 &&
    initialIndex < options.length
  ) {
    setSelectedIndex(initialIndex);
  }

  useKeyboard((key) => {
    if (!isFocused) return;

    if (key.eventType === 'press') {
      if (key.name === 'up' || key.name === 'k') {
        key.preventDefault();
        moveSelection(-1);
      } else if (key.name === 'down' || key.name === 'j') {
        key.preventDefault();
        moveSelection(1);
      } else if (key.name === 'return') {
        key.preventDefault();
        const selected = options.at(selectedIndex);
        if (selected != null) {
          onSelect(selected.value);
        }
      } else if (key.name >= '1' && key.name <= '9') {
        const index = parseInt(key.name, 10) - 1;
        if (index < options.length) {
          key.preventDefault();
          const selected = options.at(index);
          if (selected != null) {
            onSelect(selected.value);
          }
        }
      }
    }
  });

  return (
    <box flexDirection="column" style={{ gap: 0 }}>
      {options.map((option, index): React.ReactNode => {
        const isSelected = index === selectedIndex;
        const bullet = isSelected ? '●' : '○';
        const number = index + 1;
        const fg = isSelected
          ? theme?.colors.accent.primary
          : theme?.colors.text.primary;

        return (
          <text key={option.key} fg={fg}>
            {`${number}. ${bullet} ${option.label}`}
          </text>
        );
      })}
    </box>
  );
}
