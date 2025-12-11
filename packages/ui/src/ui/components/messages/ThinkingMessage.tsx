import React from 'react';
import type { ThinkingMessageProps } from './types';

export function ThinkingMessage(
  props: Readonly<ThinkingMessageProps>,
): React.ReactNode {
  return (
    <i key={props.id}>
      <text fg={props.theme.colors.text.thinking}>{props.text}</text>
    </i>
  );
}

ThinkingMessage.displayName = 'ThinkingMessage';
