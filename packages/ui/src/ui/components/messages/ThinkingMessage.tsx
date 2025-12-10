import type { JSX } from 'react';
import type { ThinkingMessageProps } from './types';

export function ThinkingMessage(
  props: Readonly<ThinkingMessageProps>,
): JSX.Element {
  return (
    <text
      key={props.id}
      fg={props.theme.colors.text.thinking}
      style={{ fontStyle: 'italic' }}
    >
      {props.text}
    </text>
  );
}

ThinkingMessage.displayName = 'ThinkingMessage';
