import React from 'react';
import type { ThinkingMessageProps } from './types';

export function ThinkingMessage(
  props: Readonly<ThinkingMessageProps>,
): React.ReactNode {
  return (
    <text key={props.id} fg={props.theme.colors.text.thinking}>
      <i>{props.text}</i>
    </text>
  );
}

ThinkingMessage.displayName = 'ThinkingMessage';
