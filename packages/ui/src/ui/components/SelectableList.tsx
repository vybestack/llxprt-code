import React from 'react';
import type { ThemeDefinition } from '../../features/theme';

export interface SelectableListItemProps {
  readonly label: string;
  readonly isSelected: boolean;
  readonly isActive?: boolean;
  readonly activeTag?: string;
  readonly theme?: ThemeDefinition;
  readonly width?: number;
}

export function SelectableListItem(
  props: SelectableListItemProps,
): React.ReactNode {
  const bullet = props.isSelected ? '●' : '○';
  const activeTag =
    props.isActive === true && props.activeTag ? props.activeTag : '';
  const labelText = `${bullet} ${props.label}${activeTag}`;
  const finalText =
    props.width != null ? labelText.padEnd(props.width, ' ') : labelText;

  return (
    <text
      fg={
        props.isSelected
          ? props.theme?.colors.accent.primary
          : props.theme?.colors.text.primary
      }
      style={{ paddingLeft: 1, paddingRight: 1 }}
    >
      {finalText}
    </text>
  );
}
